import { env } from "$env/dynamic/private";
import type { Relation } from "$lib/constants";

/**
 * Runtime env, not `$env/static/private`.
 *
 * Static env is inlined at build time, so a container built once and then given
 * fresh Instagram cookies through Coolify would keep using the baked-in values.
 * Reading dynamically means rotating a session cookie is a restart, not a rebuild.
 */

const COOKIE_KEYS = [
	"csrftoken",
	"datr",
	"ds_user_id",
	"ig_did",
	"ig_direct_region_hint",
	"mid",
	"ps_l",
	"ps_n",
	"rur",
	"sessionid",
	"wd"
] as const;

/**
 * Instagram's private endpoints need an authenticated session.
 *
 * Preferred: paste the whole `Cookie:` header into IG_COOKIE. The per-key
 * variables are still honoured so existing deployments keep working.
 */
export function instagramCookie(): string {
	const whole = env.IG_COOKIE?.trim();
	if (whole) return whole;

	return COOKIE_KEYS.flatMap((key) => {
		const value = env[key.toUpperCase()]?.trim();
		return value ? [`${key}=${value}`] : [];
	}).join("; ");
}

export function hasInstagramCredentials(): boolean {
	return instagramCookie().length > 0;
}

/**
 * GraphQL query hashes, one per edge list. Instagram rotates these without
 * notice, so both are overridable without a code change.
 */
export function queryHash(relation: Relation): string {
	if (relation === "followers") {
		return env.IG_QUERY_HASH_FOLLOWERS?.trim() || "c76146de99bb02f6415203be841dd25a";
	}
	return env.IG_QUERY_HASH_FOLLOWING?.trim() || "3dec7e2c57367ef3da3d987d89f9dbc8";
}
