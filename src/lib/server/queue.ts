import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { instagramUsers, scans } from "./db/schema";
import { runScan, type ScanProgress } from "./scan";
import type { ListKind } from "$lib/constants";

/**
 * Every user shares a single Instagram session, and that session is what gets
 * rate limited or banned. Running two scans at once would double the request
 * rate against it, so the whole process runs exactly one scan at a time and
 * everyone else waits in line.
 *
 * The queue lives in the database rather than in memory: a redeploy in the
 * middle of a busy queue must not silently drop everybody's place.
 */

export interface QueueEntry {
	scanId: number;
	userId: string;
	username: string;
	/** 1-based position among waiting scans; null once it is running. */
	position: number | null;
	status: "queued" | "running";
}

export interface QueueState {
	entries: QueueEntry[];
	running: {
		scanId: number;
		userId: string;
		username: string;
		progress: ScanProgress;
	} | null;
}

type Listener = (state: QueueState) => void;

const listeners = new Set<Listener>();

let current: { scanId: number; userId: string; username: string; progress: ScanProgress } | null =
	null;
let working = false;

export function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export async function getQueueState(): Promise<QueueState> {
	const waiting = await db
		.select({
			scanId: scans.id,
			userId: scans.userId,
			username: scans.username,
			status: scans.status
		})
		.from(scans)
		.where(inArray(scans.status, ["queued", "running"]))
		.orderBy(asc(scans.createdAt), asc(scans.id));

	let position = 0;
	const entries: QueueEntry[] = waiting.map((row) => ({
		scanId: row.scanId,
		userId: row.userId,
		username: row.username,
		status: row.status === "running" ? "running" : "queued",
		position: row.status === "running" ? null : ++position
	}));

	return { entries, running: current };
}

async function broadcast(): Promise<void> {
	if (listeners.size === 0) return;
	const state = await getQueueState();
	for (const listener of listeners) listener(state);
}

/** Fire-and-forget broadcast used from inside the scan's progress callback. */
function broadcastSoon(): void {
	void broadcast().catch((error) => console.error("Queue broadcast failed:", error));
}

/**
 * Adds a scan to the queue and wakes the worker.
 * Returns immediately — the caller does not wait for its turn.
 */
export async function enqueue(options: {
	userId: string;
	username: string;
	instagramUserId: string;
	lists: ListKind[];
}): Promise<number> {
	const [scan] = await db
		.insert(scans)
		.values({
			userId: options.userId,
			instagramUserId: options.instagramUserId,
			username: options.username,
			status: "queued",
			capturedFollowing: options.lists.includes("following"),
			capturedFollowers: options.lists.includes("followers")
		})
		.returning({ id: scans.id });

	if (!scan) throw new Error("Failed to create scan record");

	broadcastSoon();
	void pump();
	return scan.id;
}

/** Removes a waiting scan. A scan already running cannot be pulled out. */
export async function cancelQueued(scanId: number, userId: string): Promise<boolean> {
	const result = await db
		.delete(scans)
		.where(and(eq(scans.id, scanId), eq(scans.userId, userId), eq(scans.status, "queued")))
		.run();

	if (result.changes > 0) broadcastSoon();
	return result.changes > 0;
}

/** Drains the queue one scan at a time. Safe to call whenever work may exist. */
async function pump(): Promise<void> {
	if (working) return;
	working = true;

	try {
		while (true) {
			const [next] = await db
				.select()
				.from(scans)
				.where(eq(scans.status, "queued"))
				.orderBy(asc(scans.createdAt), asc(scans.id))
				.limit(1);

			if (!next) return;

			const lists: ListKind[] = [];
			if (next.capturedFollowing) lists.push("following");
			if (next.capturedFollowers) lists.push("followers");

			await db.update(scans).set({ status: "running" }).where(eq(scans.id, next.id));

			current = {
				scanId: next.id,
				userId: next.userId,
				username: next.username,
				progress: { list: lists[0] ?? "following", current: 0, total: 0, percentage: 0, log: [] }
			};
			await broadcast();

			await runScan({
				scanId: next.id,
				instagramUserId: next.instagramUserId,
				username: next.username,
				lists,
				onProgress: (progress) => {
					if (current?.scanId === next.id) {
						current = { ...current, progress };
						broadcastSoon();
					}
				}
			});

			current = null;
			await broadcast();
		}
	} catch (error) {
		console.error("Scan queue worker crashed:", error);
		current = null;
		await broadcast().catch(() => {});
	} finally {
		working = false;
	}
}

/**
 * Recovers the queue after a restart.
 *
 * A scan caught mid-flight is put back at the front rather than failed, but its
 * partial rows are cleared first: the final tallies are derived from the table,
 * so leftovers from an abandoned pass would inflate them.
 */
export async function resumeQueue(): Promise<void> {
	const interrupted = await db
		.select({ id: scans.id })
		.from(scans)
		.where(eq(scans.status, "running"));

	for (const scan of interrupted) {
		await db.delete(instagramUsers).where(eq(instagramUsers.scanId, scan.id));
	}

	if (interrupted.length > 0) {
		await db
			.update(scans)
			.set({ status: "queued" })
			.where(
				inArray(
					scans.id,
					interrupted.map((scan) => scan.id)
				)
			);
	}

	void pump();
}
