import { expect, test as setup } from "@playwright/test";

const USER = process.env.E2E_USER ?? "owner@demo.shiftline.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "Demo@12345678";

/** Logs in once through the real form and stores the session for the smoke tests. */
setup("login as the seeded owner", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(USER);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await page.context().storageState({ path: "e2e/.auth/owner.json" });
});
