import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth-schema";

// Better Auth owns these tables; re-exported so one drizzle-kit run covers both
// halves of the schema and the adapter can find them.
export * from "./auth-schema";

/**
 * A scan is one capture of a profile's social graph.
 *
 * Both edge lists are captured in a single scan rather than as two separate
 * ones, because the questions worth asking span them: "follows them but is not
 * followed back" cannot be answered from either list alone.
 *
 * `capturedFollowing` / `capturedFollowers` record which lists were actually
 * walked, so absence from a list can be told apart from never having looked.
 */
export const scans = sqliteTable(
	"scans",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** Owner. Scans are private to the account that started them. */
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** Instagram's numeric account id for the scanned profile. */
		instagramUserId: text("instagram_user_id").notNull(),
		username: text("username").notNull(),
		/**
		 * Every user shares one Instagram session, so scans run one at a time.
		 * `queued` is the waiting state; position is the creation order among
		 * queued rows.
		 */
		status: text("status", { enum: ["queued", "running", "completed", "failed"] })
			.notNull()
			.default("queued"),

		capturedFollowing: integer("captured_following", { mode: "boolean" }).notNull().default(false),
		capturedFollowers: integer("captured_followers", { mode: "boolean" }).notNull().default(false),

		/** Rows actually persisted per list. Authoritative. */
		followingCount: integer("following_count").notNull().default(0),
		followersCount: integer("followers_count").notNull().default(0),

		/** What Instagram claimed up front. Kept for drift diagnostics only. */
		reportedFollowingCount: integer("reported_following_count"),
		reportedFollowersCount: integer("reported_followers_count"),

		/** Over the union of both lists, so an account is counted once. */
		verifiedCount: integer("verified_count").notNull().default(0),
		privateCount: integer("private_count").notNull().default(0),

		error: text("error"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		finishedAt: integer("finished_at", { mode: "timestamp_ms" })
	},
	(table) => [
		index("scans_user_id_idx").on(table.userId),
		index("scans_instagram_user_id_idx").on(table.instagramUserId),
		index("scans_created_at_idx").on(table.createdAt),
		index("scans_status_idx").on(table.status)
	]
);

/**
 * One row per account per scan, carrying which of the scanned profile's lists
 * it appeared in.
 *
 * These flags are relative to the *scanned profile*. The fields they replace
 * (`followed_by_viewer`, `follows_viewer`) were relative to whichever session
 * cookie happened to be configured, which made them meaningless for scanning
 * anyone else's profile.
 */
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

		/** The scanned profile follows this account. */
		inFollowing: integer("in_following", { mode: "boolean" }).notNull().default(false),
		/** This account follows the scanned profile. */
		inFollowers: integer("in_followers", { mode: "boolean" }).notNull().default(false)
	},
	(table) => [
		// One row per account per scan. Instagram's pagination hands back
		// overlapping pages, and the same account legitimately appears in both
		// lists — either would double-count without this.
		uniqueIndex("instagram_users_scan_user_idx").on(table.scanId, table.instagramUserId),
		index("instagram_users_scan_idx").on(table.scanId),
		index("instagram_users_username_idx").on(table.username)
	]
);

export const scansRelations = relations(scans, ({ many, one }) => ({
	users: many(instagramUsers),
	owner: one(user, { fields: [scans.userId], references: [user.id] })
}));

export const instagramUsersRelations = relations(instagramUsers, ({ one }) => ({
	scan: one(scans, { fields: [instagramUsers.scanId], references: [scans.id] })
}));

export type Scan = typeof scans.$inferSelect;
export type NewScan = typeof scans.$inferInsert;
export type InstagramUser = typeof instagramUsers.$inferSelect;
export type NewInstagramUser = typeof instagramUsers.$inferInsert;
