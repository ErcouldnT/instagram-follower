import { env } from "$env/dynamic/private";

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
	"mid",
	"rur",
	"sessionid"
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
