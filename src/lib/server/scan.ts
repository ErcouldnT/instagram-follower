import { and, count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { instagramUsers, scans } from "./db/schema";
import { fetchEdgePage, InstagramError, type EdgeNode } from "./instagram";
import {
	DELAY_BETWEEN_PAGES_MS,
	LONG_PAUSE_MS,
	MAX_PAGES,
	PAGES_BEFORE_LONG_PAUSE,
	type Relation
} from "$lib/constants";

export type ScanEvent =
	| { type: "started"; scanId: number }
	| { type: "progress"; scanId: number; current: number; total: number; percentage: number }
	| { type: "log"; message: string }
	| { type: "done"; scanId: number; count: number; verifiedCount: number; privateCount: number }
	| { type: "error"; message: string };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason as Error);
			},
			{ once: true }
		);
	});
}

/** Randomised pause so request spacing does not look metronomic. */
function jitter(base: number): number {
	return Math.round(base * (0.85 + Math.random() * 0.45));
}

function toRow(scanId: number, node: EdgeNode) {
	return {
		scanId,
		instagramUserId: node.id,
		username: node.username,
		fullName: node.full_name ?? "",
		profilePicUrl: node.profile_pic_url ?? null,
		isPrivate: Boolean(node.is_private),
		isVerified: Boolean(node.is_verified),
		followedByViewer: Boolean(node.followed_by_viewer),
		followsViewer: Boolean(node.follows_viewer),
		requestedByViewer: Boolean(node.requested_by_viewer)
	};
}

/**
 * A scan in flight. The work is deliberately detached from any HTTP response:
 * closing the browser tab must not abandon a half-written scan, so subscribers
 * come and go while the loop keeps running to completion.
 */
class ScanRun {
	private readonly listeners = new Set<(event: ScanEvent) => void>();
	private readonly history: ScanEvent[] = [];
	private finished = false;

	constructor(readonly scanId: number) {}

	private emit(event: ScanEvent): void {
		this.history.push(event);
		for (const listener of this.listeners) listener(event);
	}

	private close(): void {
		this.finished = true;
		for (const listener of this.listeners) listener({ type: "log", message: "__end__" });
		this.listeners.clear();
	}

	/** Replays what has happened so far, then streams the rest live. */
	async *subscribe(): AsyncGenerator<ScanEvent> {
		const queue: ScanEvent[] = [...this.history];
		let notify: (() => void) | null = null;
		let done = this.finished;

		const listener = (event: ScanEvent) => {
			if (event.type === "log" && event.message === "__end__") {
				done = true;
			} else {
				queue.push(event);
			}
			notify?.();
		};

		this.listeners.add(listener);
		try {
			while (true) {
				while (queue.length > 0) yield queue.shift()!;
				if (done) return;
				await new Promise<void>((resolve) => {
					notify = resolve;
				});
				notify = null;
			}
		} finally {
			this.listeners.delete(listener);
		}
	}

	async run(userId: string, relation: Relation): Promise<void> {
		const scanId = this.scanId;
		this.emit({ type: "started", scanId });

		try {
			let cursor: string | null = null;
			const seenCursors = new Set<string>();
			let stored = 0;
			let reportedTotal = 0;
			let pages = 0;

			while (pages < MAX_PAGES) {
				const page = await fetchEdgePage({ userId, relation, after: cursor });
				pages++;

				if (pages === 1) {
					// Instagram's own total, recorded verbatim. The original code
					// subtracted 1 here to paper over drift, which just made every
					// stored total wrong by one.
					reportedTotal = page.total;
					await db.update(scans).set({ reportedCount: reportedTotal }).where(eq(scans.id, scanId));
				}

				if (page.nodes.length > 0) {
					const rows = page.nodes.map((node) => toRow(scanId, node));
					// One statement per page instead of one round trip per account,
					// and the unique index drops accounts repeated across pages.
					const inserted = db.insert(instagramUsers).values(rows).onConflictDoNothing().run();
					stored += inserted.changes;
				}

				const total = Math.max(reportedTotal, stored);
				this.emit({
					type: "progress",
					scanId,
					current: stored,
					total,
					// Instagram's total is a stale snapshot, so the ratio can exceed
					// 1. Clamping keeps the progress bar inside its track.
					percentage: total > 0 ? Math.min(100, Math.floor((stored / total) * 100)) : 0
				});

				if (!page.hasNextPage || !page.endCursor) break;

				// A cursor that repeats means Instagram is looping us. Without this
				// guard the original `while (hasNext)` never terminated.
				if (seenCursors.has(page.endCursor)) {
					this.emit({ type: "log", message: "Instagram repeated a cursor; stopping early." });
					break;
				}
				seenCursors.add(page.endCursor);
				cursor = page.endCursor;

				await sleep(jitter(DELAY_BETWEEN_PAGES_MS));

				if (pages % PAGES_BEFORE_LONG_PAUSE === 0) {
					this.emit({
						type: "log",
						message: `Pausing ${LONG_PAUSE_MS / 1000}s to stay under Instagram's rate limit...`
					});
					await sleep(LONG_PAUSE_MS);
				}
			}

			if (pages >= MAX_PAGES) {
				this.emit({ type: "log", message: `Stopped at the ${MAX_PAGES}-page ceiling.` });
			}

			await this.finalize("completed", null);
		} catch (error) {
			const message =
				error instanceof InstagramError
					? error.message
					: error instanceof Error
						? error.message
						: "Unknown error";
			console.error(`Scan ${scanId} failed:`, error);
			// A failed scan is marked as such rather than left indistinguishable
			// from a successful one that happened to find nothing.
			await this.finalize("failed", message);
			this.emit({ type: "error", message });
		} finally {
			this.close();
			runs.delete(scanId);
		}
	}

	/** Derives the final tallies from what is actually in the table. */
	private async finalize(status: "completed" | "failed", error: string | null): Promise<void> {
		const [totals] = await db
			.select({
				total: count(),
				verified: sql<number>`sum(case when ${instagramUsers.isVerified} then 1 else 0 end)`,
				private: sql<number>`sum(case when ${instagramUsers.isPrivate} then 1 else 0 end)`
			})
			.from(instagramUsers)
			.where(eq(instagramUsers.scanId, this.scanId));

		const finalCount = totals?.total ?? 0;
		const verifiedCount = Number(totals?.verified ?? 0);
		const privateCount = Number(totals?.private ?? 0);

		await db
			.update(scans)
			.set({
				status,
				error,
				count: finalCount,
				verifiedCount,
				privateCount,
				finishedAt: new Date()
			})
			.where(eq(scans.id, this.scanId));

		if (status === "completed") {
			this.emit({
				type: "done",
				scanId: this.scanId,
				count: finalCount,
				verifiedCount,
				privateCount
			});
		}
	}
}

const runs = new Map<number, ScanRun>();

export function getRun(scanId: number): ScanRun | undefined {
	return runs.get(scanId);
}

export async function startScan(options: {
	userId: string;
	username: string;
	relation: Relation;
}): Promise<ScanRun> {
	const [scan] = await db
		.insert(scans)
		.values({
			instagramUserId: options.userId,
			username: options.username,
			relation: options.relation,
			status: "running"
		})
		.returning({ id: scans.id });

	if (!scan) throw new Error("Failed to create scan record");

	const run = new ScanRun(scan.id);
	runs.set(scan.id, run);
	// Intentionally not awaited: the scan outlives the request that began it.
	void run.run(options.userId, options.relation);
	return run;
}

/**
 * Scans left mid-flight by a crash or redeploy would otherwise sit at
 * "running" forever, since nothing is left to finish them.
 */
export async function reconcileInterruptedScans(): Promise<void> {
	await db
		.update(scans)
		.set({ status: "failed", error: "Interrupted by a server restart.", finishedAt: new Date() })
		.where(and(eq(scans.status, "running")));
}
