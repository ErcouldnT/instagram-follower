import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * A scan captures one full pagination pass over an Instagram edge list.
 *
 * `relation` records *which* edge was walked. The original code walked
 * `edge_follow` (accounts the target follows) while labelling the result
 * "followers", which are different lists. Storing it removes the ambiguity.
 */
export const scans = sqliteTable(
	"scans",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** Instagram's numeric account id for the scanned profile. */
		instagramUserId: text("instagram_user_id").notNull(),
		username: text("username").notNull(),
		relation: text("relation", { enum: ["following", "followers"] })
			.notNull()
			.default("following"),
		status: text("status", { enum: ["running", "completed", "failed"] })
			.notNull()
			.default("running"),
		/** Rows actually persisted. Authoritative — derived from what we stored. */
		count: integer("count").notNull().default(0),
		/** Total Instagram claimed up front. Kept for drift diagnostics only. */
		reportedCount: integer("reported_count"),
		verifiedCount: integer("verified_count").notNull().default(0),
		privateCount: integer("private_count").notNull().default(0),
		error: text("error"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		finishedAt: integer("finished_at", { mode: "timestamp_ms" })
	},
	(table) => [
		index("scans_instagram_user_id_idx").on(table.instagramUserId),
		index("scans_created_at_idx").on(table.createdAt)
	]
);

export const instagramUsers = sqliteTable(
	"instagram_users",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		scanId: integer("scan_id")
			.notNull()
			.references(() => scans.id, { onDelete: "cascade" }),
		/** Instagram's numeric id for this account — stable across scans. */
		instagramUserId: text("instagram_user_id").notNull(),
		username: text("username").notNull(),
		fullName: text("full_name").notNull().default(""),
		profilePicUrl: text("profile_pic_url"),
		isPrivate: integer("is_private", { mode: "boolean" }).notNull().default(false),
		isVerified: integer("is_verified", { mode: "boolean" }).notNull().default(false),
		followedByViewer: integer("followed_by_viewer", { mode: "boolean" }).notNull().default(false),
		followsViewer: integer("follows_viewer", { mode: "boolean" }).notNull().default(false),
		requestedByViewer: integer("requested_by_viewer", { mode: "boolean" }).notNull().default(false)
	},
	(table) => [
		// Instagram's cursor pagination can hand back overlapping pages. Without
		// this the same account lands in a scan twice and inflates every count.
		uniqueIndex("instagram_users_scan_user_idx").on(table.scanId, table.instagramUserId),
		index("instagram_users_scan_idx").on(table.scanId),
		index("instagram_users_username_idx").on(table.username)
	]
);

export const scansRelations = relations(scans, ({ many }) => ({
	users: many(instagramUsers)
}));

export const instagramUsersRelations = relations(instagramUsers, ({ one }) => ({
	scan: one(scans, { fields: [instagramUsers.scanId], references: [scans.id] })
}));

export type Scan = typeof scans.$inferSelect;
export type NewScan = typeof scans.$inferInsert;
export type InstagramUser = typeof instagramUsers.$inferSelect;
export type NewInstagramUser = typeof instagramUsers.$inferInsert;
