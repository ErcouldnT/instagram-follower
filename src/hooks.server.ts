import { building } from "$app/environment";
import { redirect, type Handle } from "@sveltejs/kit";
import { auth } from "$lib/server/auth";
import { runMigrations } from "$lib/server/db";
import { resumeQueue } from "$lib/server/queue";

// Migrations are applied on boot, so a fresh container comes up with a schema
// without a manual step. drizzle-kit only ever *generates* them.
runMigrations();

// Anything left mid-scan by a restart goes back to the front of the queue.
if (!building) await resumeQueue();

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ["/login", "/signup"];

function isPublic(pathname: string): boolean {
	return pathname.startsWith("/api/auth") || PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

export const handle: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	event.locals.session = session?.session ?? null;
	event.locals.user = session?.user ?? null;

	// Guarding centrally means a new route is private by default; forgetting a
	// check in a loader cannot silently expose one user's scans to another.
	if (!event.locals.user && !isPublic(event.url.pathname)) {
		if (event.url.pathname.startsWith("/api")) {
			return new Response(JSON.stringify({ message: "Authentication required" }), {
				status: 401,
				headers: { "Content-Type": "application/json" }
			});
		}
		const target = event.url.pathname + event.url.search;
		redirect(303, `/login?redirectTo=${encodeURIComponent(target)}`);
	}

	// A signed-in user has no business on the login or signup pages.
	if (event.locals.user && PUBLIC_PATHS.some((path) => event.url.pathname.startsWith(path))) {
		redirect(303, "/");
	}

	return resolve(event);
};
