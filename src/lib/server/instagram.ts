import { instagramCookie, queryHash } from "./config";
import { PAGE_SIZE, type Relation } from "$lib/constants";

/**
 * Instagram serves different payloads to clients that look automated, so every
 * request goes out with a real browser's headers. Single source of truth.
 */
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 15_000;

export class InstagramError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = "InstagramError";
	}
}

function headers(): HeadersInit {
	const cookie = instagramCookie();
	if (!cookie) {
		throw new InstagramError("No Instagram session configured. Set IG_COOKIE in the environment.");
	}
	return {
		Cookie: cookie,
		"User-Agent": USER_AGENT,
		Accept: "*/*",
		"Accept-Language": "en-US,en;q=0.9",
		"X-IG-App-ID": "936619743392459",
		"X-Requested-With": "XMLHttpRequest",
		Referer: "https://www.instagram.com/"
	};
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

	const response = await fetch(url, { headers: headers(), signal: combined });

	if (response.status === 401 || response.status === 403) {
		throw new InstagramError(
			"Instagram rejected the session. The cookies are likely expired.",
			response.status
		);
	}
	if (response.status === 429) {
		throw new InstagramError("Instagram is rate limiting this session.", 429);
	}
	if (!response.ok) {
		throw new InstagramError(`Instagram returned HTTP ${response.status}.`, response.status);
	}

	const text = await response.text();
	try {
		return JSON.parse(text) as unknown;
	} catch {
		// A login wall answers 200 with HTML, which JSON.parse would blow up on.
		throw new InstagramError("Instagram returned a non-JSON response (likely a login wall).");
	}
}

export interface SearchResult {
	id: string;
	username: string;
	fullName: string;
	profilePicUrl: string;
	isPrivate: boolean;
	isVerified: boolean;
}

interface TopSearchResponse {
	users?: {
		user?: {
			pk?: string;
			username?: string;
			full_name?: string;
			profile_pic_url?: string;
			is_private?: boolean;
			is_verified?: boolean;
		};
	}[];
}

export async function searchUsers(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
	const url = `https://www.instagram.com/web/search/topsearch/?context=blended&query=${encodeURIComponent(query)}`;
	const data = (await getJson(url, signal)) as TopSearchResponse;

	// The original code assumed `data.users` was always an array and read
	// `.length` off it, which threw whenever Instagram answered without it.
	return (data.users ?? [])
		.map((entry) => entry.user)
		.filter((user): user is NonNullable<typeof user> => Boolean(user?.pk && user.username))
		.map((user) => ({
			id: String(user.pk),
			username: String(user.username),
			fullName: user.full_name ?? "",
			profilePicUrl: user.profile_pic_url ?? "",
			isPrivate: Boolean(user.is_private),
			isVerified: Boolean(user.is_verified)
		}));
}

export interface EdgeNode {
	id: string;
	username: string;
	full_name?: string;
	profile_pic_url?: string;
	is_private?: boolean;
	is_verified?: boolean;
	followed_by_viewer?: boolean;
	follows_viewer?: boolean;
	requested_by_viewer?: boolean;
}

export interface EdgePage {
	/** Total Instagram claims the list holds. A snapshot, and often stale. */
	total: number;
	nodes: EdgeNode[];
	hasNextPage: boolean;
	endCursor: string | null;
}

interface GraphqlResponse {
	data?: {
		user?: Record<
			string,
			| {
					count?: number;
					page_info?: { has_next_page?: boolean; end_cursor?: string | null };
					edges?: { node?: EdgeNode }[];
			  }
			| undefined
		>;
	};
}

export async function fetchEdgePage(options: {
	userId: string;
	relation: Relation;
	after?: string | null;
	signal?: AbortSignal;
}): Promise<EdgePage> {
	const { userId, relation, after, signal } = options;
	const edgeKey = relation === "followers" ? "edge_followed_by" : "edge_follow";

	const variables: Record<string, unknown> = {
		id: userId,
		include_reel: false,
		fetch_mutual: false,
		first: PAGE_SIZE
	};
	if (after) variables.after = after;

	const url =
		`https://www.instagram.com/graphql/query/?query_hash=${queryHash(relation)}` +
		`&variables=${encodeURIComponent(JSON.stringify(variables))}`;

	const data = (await getJson(url, signal)) as GraphqlResponse;
	const edge = data.data?.user?.[edgeKey];

	if (!edge) {
		throw new InstagramError(
			"Instagram's response had no follower data. The profile may be private or the query hash stale."
		);
	}

	return {
		total: typeof edge.count === "number" ? edge.count : 0,
		nodes: (edge.edges ?? [])
			.map((e) => e.node)
			.filter((node): node is EdgeNode => Boolean(node?.id && node.username)),
		hasNextPage: Boolean(edge.page_info?.has_next_page),
		endCursor: edge.page_info?.end_cursor ?? null
	};
}
