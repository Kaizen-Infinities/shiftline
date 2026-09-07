import { expect, test } from "@playwright/test";

const USER = process.env.E2E_USER ?? "owner@demo.shiftline.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "Demo@12345678";

/**
 * The real login form: the access token stays in memory and the httpOnly
 * refresh cookie survives a reload, so the dashboard must come back without a
 * second login.
 */
test("login through the form, survive a reload", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(USER);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/);
});
