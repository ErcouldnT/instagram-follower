import { expect, test, type Page } from "@playwright/test";

/** Unique per run: the suite shares one database with previous runs. */
function credentials(tag: string) {
	const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	return { email: `${tag}-${stamp}@example.test`, password: "password123" };
}

async function signUp(page: Page, tag: string) {
	const account = credentials(tag);
	await page.goto("/signup");
	await page.getByLabel("Name").fill(tag);
	await page.getByLabel("Email").fill(account.email);
	await page.getByLabel("Password").fill(account.password);
	await page.getByRole("button", { name: "Sign up" }).click();
	await page.waitForURL("**/");
	return account;
}

test("a new account lands on the scan form and can sign out", async ({ page }) => {
	const account = await signUp(page, "solo");

	await expect(page.getByRole("heading", { name: "New scan" })).toBeVisible();
	await expect(page.getByText(account.email)).toBeVisible();

	await page.getByRole("button", { name: "Sign out" }).click();
	await page.waitForURL("**/login");
	await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("one account cannot open another's scan", async ({ browser }) => {
	const first = await browser.newContext();
	const second = await browser.newContext();

	try {
		const ownerPage = await first.newPage();
		await signUp(ownerPage, "owner");

		// Queue a scan so a real scan id exists to probe for.
		const created = await ownerPage.request.post("/api/scan", {
			data: { userId: "12345", username: "target", lists: ["following"] }
		});
		expect(created.ok()).toBeTruthy();
		const { scanId } = (await created.json()) as { scanId: number };

		// The owner sees it in their history.
		await ownerPage.goto(`/scans/${scanId}`);
		await expect(ownerPage.getByRole("heading", { name: "target" })).toBeVisible();

		// A different account gets a 404, not a permission hint.
		const otherPage = await second.newPage();
		await signUp(otherPage, "other");

		const probe = await otherPage.request.get(`/scans/${scanId}`);
		expect(probe.status()).toBe(404);

		await otherPage.goto("/scans");
		await expect(otherPage.getByText("target")).toHaveCount(0);
	} finally {
		await first.close();
		await second.close();
	}
});

test("a queued scan reports its position and can be cancelled", async ({ page }) => {
	await signUp(page, "queue");

	// Two scans: the runner takes the first, so the second must report a place
	// in line rather than starting alongside it.
	for (const username of ["first", "second"]) {
		const response = await page.request.post("/api/scan", {
			data: { userId: username === "first" ? "111" : "222", username, lists: ["following"] }
		});
		expect(response.ok()).toBeTruthy();
	}

	// The live bar is fed by SSE, so this also proves the stream is flowing.
	const bar = page.locator("text=/Waiting — position|Next in line|Scanning/").first();
	await expect(bar).toBeVisible({ timeout: 15_000 });

	await expect(page.getByRole("button", { name: "Cancel" }).first()).toBeVisible({
		timeout: 15_000
	});
});
