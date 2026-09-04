import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests",
	testMatch: /(.+\.)?(test|spec)\.[jt]s/,
	webServer: {
		command: "npm run build && npm run preview",
		port: 4173,
		reuseExistingServer: !process.env.CI,
		env: {
			// Never point the tests at the real database.
			DATABASE_PATH: "./data/test.db",
			BETTER_AUTH_SECRET: "playwright-test-secret-not-used-in-production",
			// Deliberately invalid: lets scans reach the queue and fail fast at
			// Instagram, so queueing can be tested without a real session.
			IG_COOKIE: "sessionid=playwright-not-a-real-session; ds_user_id=0",
			// The suite signs up several accounts in seconds from one address.
			DISABLE_RATE_LIMIT: "1"
		}
	},
	use: { baseURL: "http://localhost:4173" }
});
