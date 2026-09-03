import { count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { instagramUsers, scans } from "./db/schema";
import { fetchListPage, fetchProfileTotals, InstagramError, type Account } from "./instagram";
import {
	DELAY_BETWEEN_PAGES_MS,
	LIST_LABELS,
	LONG_PAUSE_MS,
	MAX_PAGES,
	PAGES_BEFORE_LONG_PAUSE,
	type ListKind
} from "$lib/constants";

export type ScanEvent =
	| { type: "started"; scanId: number }
	| {
			type: "progress";
			scanId: number;
			list: ListKind;
			current: number;
			total: number;
			percentage: number;
	  }
	| { type: "log"; message: string }
	| {
			type: "done";
			scanId: number;
			followingCount: number;
			followersCount: number;
	  }
	| { type: "error"; message: string };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Randomised pause so request spacing does not look metronomic. */
function jitter(base: number): number {
	return Math.round(base * (0.85 + Math.random() * 0.45));
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

	/**
	 * Records a page of accounts, setting the membership flag for the list being
	 * walked. An account present in both lists is one row with both flags set,
	 * which is what makes "follows them but is not followed back" a single query.
	 */
	private persist(accounts: Account[], list: ListKind): number {
		if (accounts.length === 0) return 0;

		const flag = list === "following" ? "inFollowing" : "inFollowers";
		const rows = accounts.map((account) => ({
			scanId: this.scanId,
			instagramUserId: account.id,
			username: account.username,
			fullName: account.fullName,
			profilePicUrl: account.profilePicUrl || null,
			isPrivate: account.isPrivate,
			isVerified: account.isVerified,
			inFollowing: list === "following",
			inFollowers: list === "followers"
		}));

		const result = db
			.insert(instagramUsers)
			.values(rows)
			.onConflictDoUpdate({
				target: [instagramUsers.scanId, instagramUsers.instagramUserId],
				set: { [flag]: true }
			})
			.run();

		return result.changes;
	}

	/** Walks one list to exhaustion, emitting progress as it goes. */
	private async walk(userId: string, list: ListKind, reportedTotal: number): Promise<number> {
		const seenCursors = new Set<string>();
		let cursor: string | null = null;
		let stored = 0;
		let pages = 0;

		this.emit({ type: "log", message: `Reading ${LIST_LABELS[list].toLowerCase()}...` });

		while (pages < MAX_PAGES) {
			const page = await fetchListPage({ userId, list, cursor });
			pages++;

			stored += this.persist(page.accounts, list);

			const total = Math.max(reportedTotal, stored);
			this.emit({
				type: "progress",
				scanId: this.scanId,
				list,
				current: stored,
				total,
				// Instagram's total is a stale snapshot, so the ratio can exceed 1.
				percentage: total > 0 ? Math.min(100, Math.floor((stored / total) * 100)) : 0
			});

			if (!page.nextCursor) break;

			// A cursor that repeats means Instagram is looping us. Without this
			// guard the original `while (hasNext)` never terminated.
			if (seenCursors.has(page.nextCursor)) {
				this.emit({ type: "log", message: "Instagram repeated a cursor; stopping this list." });
				break;
			}
			seenCursors.add(page.nextCursor);
			cursor = page.nextCursor;

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

		return stored;
	}

	async run(userId: string, username: string, lists: ListKind[]): Promise<void> {
		this.emit({ type: "started", scanId: this.scanId });

		try {
			// Totals up front, purely for the progress denominator. A failure here
			// must not abort the scan itself.
			let totals = { followingTotal: 0, followersTotal: 0 };
			try {
				totals = await fetchProfileTotals(username);
				await db
					.update(scans)
					.set({
						reportedFollowingCount: totals.followingTotal,
						reportedFollowersCount: totals.followersTotal
					})
					.where(eq(scans.id, this.scanId));
			} catch {
				this.emit({ type: "log", message: "Could not read the profile's totals; continuing." });
			}

			for (const list of lists) {
				const reported = list === "following" ? totals.followingTotal : totals.followersTotal;
				await this.walk(userId, list, reported);
			}

			await this.finalize("completed", null);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			console.error(`Scan ${this.scanId} failed:`, error);
			// A failed scan is marked as such rather than left indistinguishable
			// from a successful one that happened to find nothing.
			await this.finalize("failed", message);
			this.emit({
				type: "error",
				message: error instanceof InstagramError ? message : `Scan failed: ${message}`
			});
		} finally {
			this.close();
			runs.delete(this.scanId);
		}
	}

	/** Derives the final tallies from what is actually in the table. */
	private async finalize(status: "completed" | "failed", error: string | null): Promise<void> {
		const [totals] = await db
			.select({
				following: sql<number>`sum(case when ${instagramUsers.inFollowing} then 1 else 0 end)`,
				followers: sql<number>`sum(case when ${instagramUsers.inFollowers} then 1 else 0 end)`,
				verified: sql<number>`sum(case when ${instagramUsers.isVerified} then 1 else 0 end)`,
				private: sql<number>`sum(case when ${instagramUsers.isPrivate} then 1 else 0 end)`,
				total: count()
			})
			.from(instagramUsers)
			.where(eq(instagramUsers.scanId, this.scanId));

		const followingCount = Number(totals?.following ?? 0);
		const followersCount = Number(totals?.followers ?? 0);

		await db
			.update(scans)
			.set({
				status,
				error,
				followingCount,
				followersCount,
				verifiedCount: Number(totals?.verified ?? 0),
				privateCount: Number(totals?.private ?? 0),
				finishedAt: new Date()
			})
			.where(eq(scans.id, this.scanId));

		if (status === "completed") {
			this.emit({ type: "done", scanId: this.scanId, followingCount, followersCount });
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
	lists: ListKind[];
}): Promise<ScanRun> {
	const [scan] = await db
		.insert(scans)
		.values({
			instagramUserId: options.userId,
			username: options.username,
			status: "running",
			capturedFollowing: options.lists.includes("following"),
			capturedFollowers: options.lists.includes("followers")
		})
		.returning({ id: scans.id });

	if (!scan) throw new Error("Failed to create scan record");

	const run = new ScanRun(scan.id);
	runs.set(scan.id, run);
	// Intentionally not awaited: the scan outlives the request that began it.
	void run.run(options.userId, options.username, options.lists);
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
		.where(eq(scans.status, "running"));
}
