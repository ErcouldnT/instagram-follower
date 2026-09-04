import { error, json } from "@sveltejs/kit";
import { LISTS, type ListKind } from "$lib/constants";
import { hasInstagramCredentials } from "$lib/server/config";
import { cancelQueued, enqueue } from "$lib/server/queue";
import type { RequestHandler } from "./$types";

/**
 * Queues a scan and returns straight away.
 *
 * The request no longer streams progress: with a shared runner a caller can be
 * behind others in line, and holding an HTTP request open for the wait would
 * tie a browser connection to somebody else's scan. Progress arrives over SSE.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = locals.user;
	if (!user) error(401, "Authentication required");

	if (!hasInstagramCredentials()) {
		error(503, "No Instagram session is configured on the server.");
	}

	const body = (await request.json().catch(() => null)) as {
		userId?: unknown;
		username?: unknown;
		lists?: unknown;
	} | null;

	const instagramUserId = typeof body?.userId === "string" ? body.userId.trim() : "";
	const username = typeof body?.username === "string" ? body.username.trim() : "";
	const lists = Array.isArray(body?.lists)
		? LISTS.filter((list) => (body.lists as unknown[]).includes(list))
		: ([...LISTS] as ListKind[]);

	if (!/^\d+$/.test(instagramUserId)) error(400, "userId must be an Instagram numeric id");
	if (!username) error(400, "username is required");
	if (lists.length === 0) error(400, "Select at least one list to capture");

	const scanId = await enqueue({ userId: user.id, username, instagramUserId, lists });
	return json({ scanId });
};

/** Leaves the queue. A scan already running cannot be pulled out. */
export const DELETE: RequestHandler = async ({ url, locals }) => {
	const user = locals.user;
	if (!user) error(401, "Authentication required");

	const scanId = Number(url.searchParams.get("scanId"));
	if (!Number.isInteger(scanId)) error(400, "scanId must be an integer");

	const cancelled = await cancelQueued(scanId, user.id);
	if (!cancelled) error(409, "That scan is not waiting in the queue.");

	return json({ cancelled: true });
};
