import { runMigrations } from "$lib/server/db";
import { reconcileInterruptedScans } from "$lib/server/scan";

// Migrations are applied on boot, so a fresh container comes up with a schema
// without a manual step. drizzle-kit only ever *generates* them.
runMigrations();
await reconcileInterruptedScans();
