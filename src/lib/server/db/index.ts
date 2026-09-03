import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "$env/dynamic/private";
import * as schema from "./schema";

const databasePath = resolve(env.DATABASE_PATH ?? "./data/app.db");
const migrationsFolder = resolve(env.MIGRATIONS_PATH ?? "./drizzle");

mkdirSync(dirname(databasePath), { recursive: true });

const sqlite = new Database(databasePath);

// WAL keeps the streaming scan's writes from blocking dashboard reads.
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");
// Off by default in SQLite. Without it the scans -> instagram_users cascade
// is silently ignored and deleting a scan orphans every one of its rows.
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

let migrated = false;

/** Applies any pending drizzle-kit migrations. Safe to call repeatedly. */
export function runMigrations(): void {
	if (migrated) return;
	migrate(db, { migrationsFolder });
	migrated = true;
}

export { schema };
