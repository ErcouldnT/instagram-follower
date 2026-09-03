import { instagramCookie } from "./config";
import { PAGE_SIZE, type ListKind } from "$lib/constants";

/**
 * Instagram serves different payloads to clients that look automated, so every
 * request goes out with a real browser's headers. Single source of truth.
 */
const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * The web client's public app id. Constant across sessions, and what the
 * /api/v1 endpoints authenticate the caller as.
 *
 * This replaces the old `query_hash` scheme: those hashes were build artefacts
 * of Instagram's GraphQL bundle and rotated without notice, which is why the
 * previous version needed environment overrides for them. The /api/v1 routes
 * take no such parameter, so there is nothing left to rotate.
 */
const APP_ID = "936619743392459";

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
		"X-IG-App-ID": APP_ID,
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
	if (response.status === 404) {
		throw new InstagramError("Instagram has no such profile.", 404);
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

/** Instagram spells the numeric id `pk` in some payloads and `pk_id` in others. */
interface RawUser {
	pk?: string | number;
	pk_id?: string | number;
	id?: string | number;
	username?: string;
	full_name?: string;
	profile_pic_url?: string;
	is_private?: boolean;
	is_verified?: boolean;
}

export interface Account {
	id: string;
	username: string;
	fullName: string;
	profilePicUrl: string;
	isPrivate: boolean;
	isVerified: boolean;
}

function toAccount(user: RawUser): Account | null {
	const id = user.pk ?? user.pk_id ?? user.id;
	if (id === undefined || !user.username) return null;
	return {
		id: String(id),
		username: String(user.username),
		fullName: user.full_name ?? "",
		profilePicUrl: user.profile_pic_url ?? "",
		isPrivate: Boolean(user.is_private),
		isVerified: Boolean(user.is_verified)
	};
}

export async function searchUsers(query: string, signal?: AbortSignal): Promise<Account[]> {
	const url = `https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(query)}`;
	const data = (await getJson(url, signal)) as { users?: { user?: RawUser }[] };

	// The original code assumed `data.users` was always an array and read
	// `.length` off it, which threw whenever Instagram answered without it.
	return (data.users ?? [])
		.map((entry) => (entry.user ? toAccount(entry.user) : null))
		.filter((account): account is Account => account !== null);
}

export interface ProfileTotals {
	followingTotal: number;
	followersTotal: number;
}

/**
 * The list endpoints do not report a total, so the progress bar's denominator
 * comes from the profile page's own counters.
 */
export async function fetchProfileTotals(
	username: string,
	signal?: AbortSignal
): Promise<ProfileTotals> {
	const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
	const data = (await getJson(url, signal)) as {
		data?: {
			user?: {
				edge_follow?: { count?: number };
				edge_followed_by?: { count?: number };
			};
		};
	};

	const user = data.data?.user;
	return {
		followingTotal: user?.edge_follow?.count ?? 0,
		followersTotal: user?.edge_followed_by?.count ?? 0
	};
}

export interface ListPage {
	accounts: Account[];
	/** Cursor for the next page, or null when the list is exhausted. */
	nextCursor: string | null;
}

/**
 * One page of a profile's following or followers list.
 *
 * Uses `/api/v1/friendships/{id}/…`, which paginates with an opaque `max_id`
 * cursor and needs no query hash.
 */
export async function fetchListPage(options: {
	userId: string;
	list: ListKind;
	cursor?: string | null;
	signal?: AbortSignal;
}): Promise<ListPage> {
	const { userId, list, cursor, signal } = options;

	const params = new URLSearchParams({ count: String(PAGE_SIZE) });
	if (cursor) params.set("max_id", cursor);

	const url = `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(userId)}/${list}/?${params}`;
	const data = (await getJson(url, signal)) as {
		users?: RawUser[];
		next_max_id?: string | number | null;
		more_available?: boolean;
		status?: string;
		message?: string;
	};

	if (data.status && data.status !== "ok") {
		throw new InstagramError(data.message ?? `Instagram reported status "${data.status}".`);
	}
	if (!Array.isArray(data.users)) {
		throw new InstagramError(
			"Instagram's response had no user list. The profile may be private or the session lacks access."
		);
	}

	const accounts = data.users
		.map(toAccount)
		.filter((account): account is Account => account !== null);

	// `more_available: false` is authoritative when present; otherwise the
	// absence of a cursor ends the walk.
	const exhausted =
		data.more_available === false ||
		data.next_max_id === null ||
		data.next_max_id === undefined ||
		data.next_max_id === "";

	return { accounts, nextCursor: exhausted ? null : String(data.next_max_id) };
}
