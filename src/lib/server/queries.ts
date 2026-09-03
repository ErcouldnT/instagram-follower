import { and, count, desc, eq, like, ne, notExists, or, sql } from "drizzle-orm";
import { db } from "./db";
import { instagramUsers, scans, type InstagramUser, type Scan } from "./db/schema";
import { USERS_PER_PAGE } from "$lib/constants";

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

export async function getScanUsers(options: {
	scanId: number;
	page: number;
	search: string;
}): Promise<{ users: InstagramUser[]; total: number; totalPages: number }> {
	const term = options.search.trim();
	const filter = term
		? and(
				eq(instagramUsers.scanId, options.scanId),
				or(like(instagramUsers.username, `%${term}%`), like(instagramUsers.fullName, `%${term}%`))
			)
		: eq(instagramUsers.scanId, options.scanId);

	const [totals] = await db.select({ value: count() }).from(instagramUsers).where(filter);
	const total = totals?.value ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / USERS_PER_PAGE));
	const page = Math.min(Math.max(1, options.page), totalPages);

	const users = await db
		.select()
		.from(instagramUsers)
		.where(filter)
		.orderBy(
			desc(instagramUsers.followedByViewer),
			desc(instagramUsers.isVerified),
			instagramUsers.username
		)
		.limit(USERS_PER_PAGE)
		.offset((page - 1) * USERS_PER_PAGE);

	return { users, total, totalPages };
}

export interface ComparisonUser {
	instagramUserId: string;
	username: string;
	fullName: string;
}

export interface Comparison {
	older: Scan;
	newer: Scan;
	gained: ComparisonUser[];
	lost: ComparisonUser[];
}

/**
 * Set difference between two scans, evaluated in SQLite.
 *
 * The previous implementation pulled every row of both scans into the browser
 * and diffed them in JavaScript, which meant shipping tens of thousands of
 * records over the wire to compute two small lists.
 */
export async function compareScans(idA: number, idB: number): Promise<Comparison> {
	const [a, b] = await Promise.all([getScan(idA), getScan(idB)]);
	if (!a || !b) throw new Error("One of the scans no longer exists.");

	// Diffing two different accounts produces a meaningless result: every entry
	// looks "gained" and every entry "lost". The original UI happily allowed it.
	if (a.instagramUserId !== b.instagramUserId) {
		throw new Error("Both scans must belong to the same Instagram account.");
	}
	if (a.relation !== b.relation) {
		throw new Error("Both scans must cover the same list (following vs followers).");
	}

	const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a];

	const missingFrom = (presentIn: number, absentFrom: number) => {
		const other = sql`(select 1 from ${instagramUsers} as other
			where other.scan_id = ${absentFrom}
			  and other.instagram_user_id = ${instagramUsers.instagramUserId})`;

		return db
			.select({
				instagramUserId: instagramUsers.instagramUserId,
				username: instagramUsers.username,
				fullName: instagramUsers.fullName
			})
			.from(instagramUsers)
			.where(and(eq(instagramUsers.scanId, presentIn), notExists(other)))
			.orderBy(instagramUsers.username);
	};

	const [gained, lost] = await Promise.all([
		missingFrom(newer.id, older.id),
		missingFrom(older.id, newer.id)
	]);

	return { older, newer, gained, lost };
}

export async function deleteScan(id: number): Promise<void> {
	// instagram_users rows go with it via ON DELETE CASCADE.
	await db.delete(scans).where(eq(scans.id, id));
}

/** Per-account time series for the growth chart. */
export async function growthSeries(): Promise<
	{ username: string; points: { at: number; count: number }[] }[]
> {
	const rows = await db
		.select({
			username: scans.username,
			instagramUserId: scans.instagramUserId,
			createdAt: scans.createdAt,
			count: scans.count
		})
		.from(scans)
		.where(and(eq(scans.status, "completed"), ne(scans.count, 0)))
		.orderBy(scans.createdAt);

	const byAccount = new Map<
		string,
		{ username: string; points: { at: number; count: number }[] }
	>();
	for (const row of rows) {
		const entry = byAccount.get(row.instagramUserId) ?? { username: row.username, points: [] };
		// Keyed on the full timestamp, not a formatted date. Grouping by day
		// silently collapsed two scans run on the same day into one point.
		entry.points.push({ at: row.createdAt.getTime(), count: row.count });
		byAccount.set(row.instagramUserId, entry);
	}

	return [...byAccount.values()].filter((series) => series.points.length > 0);
}
