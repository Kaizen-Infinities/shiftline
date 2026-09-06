import { expect, test, type Page } from "@playwright/test";

/**
 * Twelve screens must render for a logged-in owner without a server error.
 * `marker` is a stable piece of text on the page; the API tracker fails the
 * test on any 5xx the screen triggered.
 */
const SCREENS: { path: string; marker: RegExp }[] = [
  { path: "/dashboard", marker: /Field Team Map/i },
  { path: "/users", marker: /User Management/i },
  { path: "/roles", marker: /Role Management/i },
  { path: "/employees", marker: /Employee Management/i },
  { path: "/products", marker: /Production Product/i },
  { path: "/raw-materials", marker: /Raw Materials Management/i },
  { path: "/machines", marker: /Machine/i },
  { path: "/production-orders", marker: /Production Order/i },
  { path: "/sales-order", marker: /Sales Order Management/i },
  { path: "/sales-invoices", marker: /Sales Invoice List/i },
  { path: "/settings/company", marker: /General Info/i },
  { path: "/company/view", marker: /Employee Code/i },
];

const trackApi = (page: Page) => {
  const failures: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) {
      failures.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
    }
  });
  page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));
  return () => failures;
};

test.describe("smoke", () => {
  for (const screen of SCREENS) {
    test(`${screen.path} renders`, async ({ page }) => {
      const failures = trackApi(page);
      await page.goto(screen.path);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByText(screen.marker).first()).toBeVisible({ timeout: 20_000 });
      // Let the screen's data calls settle before judging them; a screen that
      // polls or retries an external service must not stall the test.
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      expect(failures()).toEqual([]);
    });
  }

  test("a wrong password is refused without a crash", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    const failures = trackApi(page);
    await page.goto("/login");
    await page
      .locator('input[name="email"]')
      .fill(process.env.E2E_USER ?? "owner@demo.shiftline.local");
    await page.locator('input[name="password"]').fill("definitely-wrong-password");
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/invalid|incorrect|failed|wrong/i).first()).toBeVisible({
      timeout: 15_000,
    });
    expect(failures()).toEqual([]);
    await context.close();
  });
});
