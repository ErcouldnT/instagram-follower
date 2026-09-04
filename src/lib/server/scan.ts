import { count, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { instagramUsers, scans } from "./db/schema";
import { fetchListPage, fetchProfileTotals, type Account } from "./instagram";
import {
	DELAY_BETWEEN_PAGES_MS,
	LIST_LABELS,
	LONG_PAUSE_MS,
	MAX_PAGES,
	PAGES_BEFORE_LONG_PAUSE,
	type ListKind
} from "$lib/constants";

export interface ScanProgress {
	list: ListKind;
	current: number;
	total: number;
	percentage: number;
	/** Most recent lines first consumed by the UI; capped to stay small. */
	log: string[];
}

const MAX_LOG_LINES = 8;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Randomised pause so request spacing does not look metronomic. */
function jitter(base: number): number {
	return Math.round(base * (0.85 + Math.random() * 0.45));
}

/**
 * Records a page of accounts, setting the membership flag for the list being
 * walked. An account present in both lists is one row with both flags set,
 * which is what makes "follows them but is not followed back" a single query.
 */
function persist(scanId: number, accounts: Account[], list: ListKind): number {
	if (accounts.length === 0) return 0;

	const flag = list === "following" ? "inFollowing" : "inFollowers";
	const rows = accounts.map((account) => ({
		scanId,
		instagramUserId: account.id,
		username: account.username,
		fullName: account.fullName,
		profilePicUrl: account.profilePicUrl || null,
		isPrivate: account.isPrivate,
		isVerified: account.isVerified,
		inFollowing: list === "following",
		inFollowers: list === "followers"
	}));

	return db
		.insert(instagramUsers)
		.values(rows)
		.onConflictDoUpdate({
			target: [instagramUsers.scanId, instagramUsers.instagramUserId],
			set: { [flag]: true }
		})
		.run().changes;
}

/** Derives the final tallies from what is actually in the table. */
async function finalize(
	scanId: number,
	status: "completed" | "failed",
	error: string | null
): Promise<void> {
	const [totals] = await db
		.select({
			following: sql<number>`sum(case when ${instagramUsers.inFollowing} then 1 else 0 end)`,
			followers: sql<number>`sum(case when ${instagramUsers.inFollowers} then 1 else 0 end)`,
			verified: sql<number>`sum(case when ${instagramUsers.isVerified} then 1 else 0 end)`,
			private: sql<number>`sum(case when ${instagramUsers.isPrivate} then 1 else 0 end)`,
			total: count()
		})
		.from(instagramUsers)
		.where(eq(instagramUsers.scanId, scanId));

	await db
		.update(scans)
		.set({
			status,
			error,
			followingCount: Number(totals?.following ?? 0),
			followersCount: Number(totals?.followers ?? 0),
			verifiedCount: Number(totals?.verified ?? 0),
			privateCount: Number(totals?.private ?? 0),
			finishedAt: new Date()
		})
		.where(eq(scans.id, scanId));
}

/**
 * Runs one scan to completion. Never throws: a failure is recorded on the scan
 * row so the queue worker can move on to the next person in line.
 */
export async function runScan(options: {
	scanId: number;
	instagramUserId: string;
	username: string;
	lists: ListKind[];
	onProgress: (progress: ScanProgress) => void;
}): Promise<void> {
	const { scanId, instagramUserId, username, lists, onProgress } = options;

	const log: string[] = [];
	let progress: ScanProgress = {
		list: lists[0] ?? "following",
		current: 0,
		total: 0,
		percentage: 0,
		log
	};

	const emit = (patch: Partial<ScanProgress>) => {
		progress = { ...progress, ...patch, log: [...log] };
		onProgress(progress);
	};

	const note = (message: string) => {
		log.push(message);
		if (log.length > MAX_LOG_LINES) log.shift();
		emit({});
	};

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
				.where(eq(scans.id, scanId));
		} catch {
			note("Could not read the profile's totals; continuing without a percentage.");
		}

		for (const list of lists) {
			const reported = list === "following" ? totals.followingTotal : totals.followersTotal;
			const seenCursors = new Set<string>();
			let cursor: string | null = null;
			let stored = 0;
			let pages = 0;

			note(`Reading ${LIST_LABELS[list].toLowerCase()}...`);
			emit({ list, current: 0, total: reported, percentage: 0 });

			while (pages < MAX_PAGES) {
				const page = await fetchListPage({ userId: instagramUserId, list, cursor });
				pages++;

				stored += persist(scanId, page.accounts, list);

				const total = Math.max(reported, stored);
				emit({
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
					note("Instagram repeated a cursor; stopping this list.");
					break;
				}
				seenCursors.add(page.nextCursor);
				cursor = page.nextCursor;

				await sleep(jitter(DELAY_BETWEEN_PAGES_MS));

				if (pages % PAGES_BEFORE_LONG_PAUSE === 0) {
					note(`Pausing ${LONG_PAUSE_MS / 1000}s to stay under Instagram's rate limit...`);
					await sleep(LONG_PAUSE_MS);
				}
			}

			if (pages >= MAX_PAGES) note(`Stopped at the ${MAX_PAGES}-page ceiling.`);
		}

		await finalize(scanId, "completed", null);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		console.error(`Scan ${scanId} failed:`, error);
		// A failed scan is marked as such rather than left indistinguishable
		// from a successful one that happened to find nothing.
		await finalize(scanId, "failed", message);
	}
}
