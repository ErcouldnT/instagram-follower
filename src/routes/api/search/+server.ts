import { error, json } from "@sveltejs/kit";
import { hasInstagramCredentials } from "$lib/server/config";
import { InstagramError, searchUsers } from "$lib/server/instagram";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, request }) => {
	const query = url.searchParams.get("q")?.trim() ?? "";
	if (!query) error(400, "Missing search query");

	if (!hasInstagramCredentials()) {
		error(503, "No Instagram session is configured on the server.");
	}

	try {
		return json({ users: await searchUsers(query, request.signal) });
	} catch (err) {
		if (err instanceof InstagramError) error(502, err.message);
		throw err;
	}
};
