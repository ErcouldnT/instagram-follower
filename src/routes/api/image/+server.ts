import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * Instagram's CDN blocks hotlinking, so avatars are fetched server-side.
 *
 * The host allow-list is the point of this endpoint. Proxying an arbitrary
 * URL — as the original did — turns the server into an open relay: anything
 * that can reach this route can reach the Docker network, the LAN, and any
 * cloud metadata endpoint, using this container as the source address.
 */
const ALLOWED_HOST_SUFFIXES = [".cdninstagram.com", ".fbcdn.net", "instagram.com"];

const MAX_BYTES = 8 * 1024 * 1024;

export const GET: RequestHandler = async ({ url, fetch }) => {
	const target = url.searchParams.get("url");
	if (!target) error(400, "Missing url parameter");

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		error(400, "Malformed url parameter");
	}

	if (parsed.protocol !== "https:") error(400, "Only https URLs are allowed");

	const host = parsed.hostname.toLowerCase();
	const allowed = ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(suffix));
	if (!allowed) error(403, "Host is not an allowed Instagram CDN");

	let response: Response;
	try {
		response = await fetch(parsed, {
			headers: { Referer: "https://www.instagram.com/" },
			signal: AbortSignal.timeout(10_000)
		});
	} catch {
		error(502, "Could not reach the image host");
	}

	if (!response.ok) error(response.status === 404 ? 404 : 502, "Image unavailable");

	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.startsWith("image/")) error(415, "Target is not an image");

	const declared = Number(response.headers.get("content-length") ?? 0);
	if (declared > MAX_BYTES) error(413, "Image too large");

	const buffer = await response.arrayBuffer();
	if (buffer.byteLength > MAX_BYTES) error(413, "Image too large");

	return new Response(buffer, {
		headers: {
			"Content-Type": contentType,
			"Content-Length": String(buffer.byteLength),
			"Cache-Control": "public, max-age=86400, immutable",
			"Content-Security-Policy": "default-src 'none'",
			"X-Content-Type-Options": "nosniff"
		}
	});
};
