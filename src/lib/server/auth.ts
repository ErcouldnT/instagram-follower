import { building } from "$app/environment";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { env } from "$env/dynamic/private";
import { db } from "./db";
import * as schema from "./db/schema";

/**
 * Sessions are signed with BETTER_AUTH_SECRET. A missing secret in production
 * would silently fall back to an ephemeral one, invalidating every session on
 * each restart, so it is required rather than defaulted.
 */
function secret(): string {
	const value = env.BETTER_AUTH_SECRET?.trim();
	if (value) return value;

	// `building` excludes SvelteKit's build-time analysis pass, which imports
	// this module with NODE_ENV=production but no runtime environment. The check
	// still fires on the first real import at container start.
	if (!building && env.NODE_ENV === "production") {
		throw new Error(
			"BETTER_AUTH_SECRET is required in production. Generate one with `openssl rand -base64 32`."
		);
	}
	return "dev-only-insecure-secret-do-not-use-in-production";
}

export const auth = betterAuth({
	appName: "Instagram Follower",
	secret: secret(),
	baseURL: env.ORIGIN?.trim() || undefined,
	database: drizzleAdapter(db, { provider: "sqlite", schema }),
	emailAndPassword: {
		enabled: true,
		// No mail transport is configured, so requiring verification would lock
		// every new account out. Enable this once SMTP exists.
		requireEmailVerification: false,
		minPasswordLength: 8
	},
	rateLimit: {
		/**
		 * Left on in production: it is what stops credential stuffing against
		 * sign-in. Disabled only by the end-to-end suite, which creates several
		 * accounts in seconds from one address. Deliberately absent from
		 * .env.example and docker-compose.yml so it cannot be copied into a
		 * deployment by accident.
		 */
		enabled: env.DISABLE_RATE_LIMIT !== "1"
	},
	session: {
		expiresIn: 60 * 60 * 24 * 30,
		updateAge: 60 * 60 * 24
	},
	advanced: {
		// Behind Coolify's TLS-terminating proxy the app itself speaks HTTP;
		// without this the secure cookie flag would be dropped.
		useSecureCookies: env.NODE_ENV === "production",
		ipAddress: {
			// Every request arrives from the proxy, so without a forwarded header
			// Better Auth cannot tell clients apart and rate limits them all
			// through one shared bucket — one noisy client locks everyone out.
			ipAddressHeaders: ["x-forwarded-for", "x-real-ip"]
		}
	}
});

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;
