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
			BETTER_AUTH_SECRET: "playwright-test-secret-not-used-in-production"
		}
	},
	use: { baseURL: "http://localhost:4173" }
});
