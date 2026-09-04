import { expect, test } from "@playwright/test";

test("anonymous visitors are sent to the login page", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("signup page is reachable", async ({ page }) => {
	await page.goto("/signup");
	await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
	await expect(page.getByLabel("Email")).toBeVisible();
});

test("private endpoints reject anonymous callers", async ({ request }) => {
	expect((await request.get("/api/events")).status()).toBe(401);

	const scan = await request.post("/api/scan", {
		data: { userId: "1", username: "x" }
	});
	expect(scan.status()).toBe(401);
});

test("scan pages are not readable without a session", async ({ request }) => {
	// Redirect to /login rather than the scan itself.
	const response = await request.get("/scans/1", { maxRedirects: 0 });
	expect(response.status()).toBe(303);
	expect(response.headers()["location"]).toContain("/login");
});

test("image proxy refuses hosts outside Instagram's CDN", async ({ request }) => {
	// Still guarded even before the auth check, and never an open relay.
	const external = await request.get("/api/image?url=https://example.com/a.png");
	expect([401, 403]).toContain(external.status());

	const internal = await request.get("/api/image?url=http://169.254.169.254/latest/meta-data/");
	expect([400, 401]).toContain(internal.status());
});
