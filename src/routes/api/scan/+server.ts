import { error } from "@sveltejs/kit";
import { LISTS, type ListKind } from "$lib/constants";
import { hasInstagramCredentials } from "$lib/server/config";
import { getRun, startScan, type ScanEvent } from "$lib/server/scan";
import type { RequestHandler } from "./$types";

function streamEvents(events: AsyncGenerator<ScanEvent>): Response {
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { value, done } = await events.next();
			if (done) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
		},
		async cancel() {
			// The subscriber goes away; the scan itself keeps running.
			await events.return(undefined);
		}
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "application/x-ndjson",
			"Cache-Control": "no-store",
			"X-Accel-Buffering": "no"
		}
	});
}

/** Starts a scan and streams its progress as newline-delimited JSON. */
export const POST: RequestHandler = async ({ request }) => {
	if (!hasInstagramCredentials()) {
		error(503, "No Instagram session is configured on the server.");
	}

	const body = (await request.json().catch(() => null)) as {
		userId?: unknown;
		username?: unknown;
		lists?: unknown;
	} | null;

	const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
	const username = typeof body?.username === "string" ? body.username.trim() : "";
	const lists = Array.isArray(body?.lists)
		? LISTS.filter((list) => (body.lists as unknown[]).includes(list))
		: ([...LISTS] as ListKind[]);

	if (!/^\d+$/.test(userId)) error(400, "userId must be an Instagram numeric id");
	if (!username) error(400, "username is required");
	if (lists.length === 0) error(400, "Select at least one list to capture");

	const run = await startScan({ userId, username, lists });
	return streamEvents(run.subscribe());
};

/** Re-attaches to a scan already in flight, e.g. after a page reload. */
export const GET: RequestHandler = async ({ url }) => {
	const scanId = Number(url.searchParams.get("scanId"));
	if (!Number.isInteger(scanId)) error(400, "scanId must be an integer");

	const run = getRun(scanId);
	if (!run) error(404, "That scan is not currently running");

	return streamEvents(run.subscribe());
};
