import { and, asc, count, desc, eq, like, notExists, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { instagramUsers, scans, type InstagramUser, type Scan } from "./db/schema";
import { USERS_PER_PAGE, type ListKind, type UserFilter } from "$lib/constants";

export function listScans(): Promise<Scan[]> {
	return db.select().from(scans).orderBy(desc(scans.createdAt));
}

export function getScan(id: number): Promise<Scan | undefined> {
	return db
		.select()
		.from(scans)
		.where(eq(scans.id, id))
		.limit(1)
		.then((rows) => rows[0]);
}

/**
 * The relationship filters. Each is a plain predicate over the two membership
 * flags — the whole point of capturing both lists in one scan.
 */
function filterCondition(filter: UserFilter): SQL | undefined {
	switch (filter) {
		case "not_following_back":
			// The profile follows them; they do not follow back.
			return and(eq(instagramUsers.inFollowing, true), eq(instagramUsers.inFollowers, false));
		case "not_followed_back":
			// They follow the profile; the profile does not follow back.
			return and(eq(instagramUsers.inFollowers, true), eq(instagramUsers.inFollowing, false));
		case "mutual":
			return and(eq(instagramUsers.inFollowing, true), eq(instagramUsers.inFollowers, true));
		case "following":
			return eq(instagramUsers.inFollowing, true);
		case "followers":
			return eq(instagramUsers.inFollowers, true);
		case "all":
			return undefined;
	}
}

export async function getScanUsers(options: {
	scanId: number;
	page: number;
	search: string;
	filter: UserFilter;
}): Promise<{ users: InstagramUser[]; total: number; totalPages: number }> {
	const term = options.search.trim();

	const where = and(
		eq(instagramUsers.scanId, options.scanId),
		filterCondition(options.filter),
		term
			? or(like(instagramUsers.username, `%${term}%`), like(instagramUsers.fullName, `%${term}%`))
			: undefined
	);

	const [totals] = await db.select({ value: count() }).from(instagramUsers).where(where);
	const total = totals?.value ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
	const page = Math.min(Math.max(1, options.page), totalPages);

	const users = await db
		.select()
		.from(instagramUsers)
		.where(where)
		.orderBy(desc(instagramUsers.isVerified), asc(instagramUsers.username))
		.limit(USERS_PER_PAGE)
		.offset((page - 1) * USERS_PER_PAGE);

	return { users, total, totalPages };
}

/** Counts behind the relationship tabs, in one pass over the scan. */
export async function getScanBreakdown(scanId: number): Promise<Record<UserFilter, number>> {
	const flag = (condition: SQL) => sql<number>`sum(case when ${condition} then 1 else 0 end)`;

	const [row] = await db
		.select({
			all: count(),
			following: flag(eq(instagramUsers.inFollowing, true)),
			followers: flag(eq(instagramUsers.inFollowers, true)),
			mutual: flag(
				and(eq(instagramUsers.inFollowing, true), eq(instagramUsers.inFollowers, true))!
			),
			not_following_back: flag(
				and(eq(instagramUsers.inFollowing, true), eq(instagramUsers.inFollowers, false))!
			),
			not_followed_back: flag(
				and(eq(instagramUsers.inFollowers, true), eq(instagramUsers.inFollowing, false))!
			)
		})
		.from(instagramUsers)
		.where(eq(instagramUsers.scanId, scanId));

	return {
		all: Number(row?.all ?? 0),
		following: Number(row?.following ?? 0),
		followers: Number(row?.followers ?? 0),
		mutual: Number(row?.mutual ?? 0),
		not_following_back: Number(row?.not_following_back ?? 0),
		not_followed_back: Number(row?.not_followed_back ?? 0)
	};
}

export interface ComparisonUser {
	instagramUserId: string;
	username: string;
	fullName: string;
}

export interface ListDiff {
	list: ListKind;
	gained: ComparisonUser[];
	lost: ComparisonUser[];
}

export interface Comparison {
	username: string;
	olderAt: number;
	newerAt: number;
	diffs: ListDiff[];
	/** Lists one scan captured and the other did not, so cannot be diffed. */
	skipped: ListKind[];
}

/**
 * Set difference between two scans, evaluated in SQLite.
 *
 * The original implementation pulled every row of both scans into the browser
 * and diffed them in JavaScript, shipping tens of thousands of records to
 * compute two small lists.
 */
export async function compareScans(idA: number, idB: number): Promise<Comparison> {
	const [a, b] = await Promise.all([getScan(idA), getScan(idB)]);
	if (!a || !b) throw new Error("One of the scans no longer exists.");

	// Diffing two different accounts produces a meaningless result: every entry
	// looks "gained" and every entry "lost".
	if (a.instagramUserId !== b.instagramUserId) {
		throw new Error("Both scans must belong to the same Instagram account.");
	}

	const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a];

	const captured = (scan: Scan, list: ListKind) =>
		list === "following" ? scan.capturedFollowing : scan.capturedFollowers;

	const diffs: ListDiff[] = [];
	const skipped: ListKind[] = [];

	for (const list of ["following", "followers"] as const) {
		// A list only one side captured would report its entire contents as
		// gained or lost, which is an artefact of the scan, not a real change.
		if (!captured(older, list) || !captured(newer, list)) {
			if (captured(older, list) || captured(newer, list)) skipped.push(list);
			continue;
		}

		const flag = list === "following" ? instagramUsers.inFollowing : instagramUsers.inFollowers;

		const missingFrom = (presentIn: number, absentFrom: number) => {
			const counterpart = sql`(select 1 from ${instagramUsers} as other
				where other.scan_id = ${absentFrom}
				  and other.instagram_user_id = ${instagramUsers.instagramUserId}
				  and other.${sql.raw(list === "following" ? "in_following" : "in_followers")} = 1)`;

			return db
				.select({
					instagramUserId: instagramUsers.instagramUserId,
					username: instagramUsers.username,
					fullName: instagramUsers.fullName
				})
				.from(instagramUsers)
				.where(and(eq(instagramUsers.scanId, presentIn), eq(flag, true), notExists(counterpart)))
				.orderBy(instagramUsers.username);
		};

		const [gained, lost] = await Promise.all([
			missingFrom(newer.id, older.id),
			missingFrom(older.id, newer.id)
		]);

		diffs.push({ list, gained, lost });
	}

	if (diffs.length === 0) {
		throw new Error("These two scans share no list that both captured.");
	}

	return {
		username: newer.username,
		olderAt: older.createdAt.getTime(),
		newerAt: newer.createdAt.getTime(),
		diffs,
		skipped
	};
}

export async function deleteScan(id: number): Promise<void> {
	// instagram_users rows go with it via ON DELETE CASCADE.
	await db.delete(scans).where(eq(scans.id, id));
}

export interface GrowthSeries {
	label: string;
	points: { at: number; count: number }[];
}

/** Per-account, per-list time series for the growth chart. */
export async function growthSeries(): Promise<GrowthSeries[]> {
	const rows = await db
		.select({
			username: scans.username,
			instagramUserId: scans.instagramUserId,
			createdAt: scans.createdAt,
			capturedFollowing: scans.capturedFollowing,
			capturedFollowers: scans.capturedFollowers,
			followingCount: scans.followingCount,
			followersCount: scans.followersCount
		})
		.from(scans)
		.where(eq(scans.status, "completed"))
		.orderBy(scans.createdAt);

	const series = new Map<string, GrowthSeries>();

	for (const row of rows) {
		for (const list of ["followers", "following"] as const) {
			const captured = list === "following" ? row.capturedFollowing : row.capturedFollowers;
			if (!captured) continue;

			const value = list === "following" ? row.followingCount : row.followersCount;
			if (value === 0) continue;

			const key = `${row.instagramUserId}:${list}`;
			const entry = series.get(key) ?? {
				label: `${row.username} · ${list === "following" ? "Following" : "Followers"}`,
				points: []
			};
			// Keyed on the full timestamp, not a formatted date. Grouping by day
			// silently collapsed two scans run on the same day into one point.
			entry.points.push({ at: row.createdAt.getTime(), count: value });
			series.set(key, entry);
		}
	}

	return [...series.values()].filter((entry) => entry.points.length > 0);
}
