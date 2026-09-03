import { expect, test } from "@playwright/test";

test("home page renders the search form", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Instagram Follower" })).toBeVisible();
	await expect(page.getByLabel("Username")).toBeVisible();
});

test("scan history loads", async ({ page }) => {
	await page.goto("/scans");
	await expect(page.getByRole("heading", { name: "Scan history" })).toBeVisible();
});

test("image proxy refuses hosts outside Instagram's CDN", async ({ request }) => {
	const external = await request.get("/api/image?url=https://example.com/a.png");
	expect(external.status()).toBe(403);

	const internal = await request.get("/api/image?url=http://169.254.169.254/latest/meta-data/");
	expect(internal.status()).toBe(400);
});

test("scan rejects a non-numeric Instagram id", async ({ request }) => {
	const response = await request.post("/api/scan", {
		data: { userId: "not-a-number", username: "x" }
	});
	expect(response.ok()).toBeFalsy();
});
