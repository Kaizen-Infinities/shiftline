import { expect, test, type Page } from "@playwright/test";

/**
 * Platform console (P1-02): a platform admin signs in, sees the fleet, opens a tenant and acts
 * as its owner; the banner shows and Stop returns them to the console.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@e2e.shiftline.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin#2026!!";

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

test.beforeEach(async ({ context, request }) => {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const rt = res.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value;
  expect(rt, "refresh cookie issued").toBeTruthy();
  const value = rt!.split(";")[0].split("=")[1];
  await context.addCookies([
    {
      name: "shiftline_rt",
      value,
      domain: new URL(API).hostname,
      path: "/api/auth",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    },
  ]);
});

test("the console lists tenants and a platform admin can act as a tenant owner", async ({
  page,
}) => {
  const failures = trackApi(page);
  await page.goto("/platform");
  await expect(page.getByText(/Platform Overview/).first()).toBeVisible({ timeout: 20_000 });

  await page.goto("/platform/tenants");
  await expect(page.getByText(/^Tenants$/).first()).toBeVisible({ timeout: 20_000 });
  const demo = page.getByRole("link", { name: /Demo/i }).first();
  await expect(demo).toBeVisible();
  await demo.click();
  await expect(page.getByRole("button", { name: /Act as owner/ })).toBeVisible({ timeout: 20_000 });

  page.once("dialog", (d) => d.accept("E2E: verify the banner"));
  await page.getByRole("button", { name: /Act as owner/ }).click();
  await expect(page.getByTestId("impersonation-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("impersonation-banner")).toContainText(/Acting as/);

  await page.getByRole("button", { name: /Stop impersonating/ }).click();
  await expect(page.getByTestId("impersonation-banner")).toHaveCount(0, { timeout: 20_000 });
  await expect(page).toHaveURL(/\/platform/);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  expect(failures()).toEqual([]);
});

test("plans render", async ({ page }) => {
  const failures = trackApi(page);
  await page.goto("/platform/plans");
  await expect(page.getByText(/^Plans$/).first()).toBeVisible({ timeout: 20_000 });
  expect(failures()).toEqual([]);
});
