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
  await expect(page.getByText(/overview/i).first()).toBeVisible({ timeout: 20_000 });

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

/**
 * Tenant isolation across a session swap. Stopping impersonation hands the tab back to a
 * platform admin, who has no tenant: from the click on, only auth and platform endpoints may be
 * called (a tenant screen that re-renders, or remounts, under the admin token would call its
 * tenant endpoints without a tenant). The tenant's cached rows must be gone as well, so the next
 * tenant the admin opens can never be shown this one's.
 */
test("stopping impersonation makes no tenant-scoped calls and drops the tenant's cache", async ({
  page,
}) => {
  await page.goto("/platform/tenants");
  await page.getByRole("link", { name: /Demo/i }).first().click();
  page.once("dialog", (d) => d.accept("E2E: tenant isolation on stop"));
  await page.getByRole("button", { name: /Act as owner/ }).click();
  await expect(page.getByTestId("impersonation-banner")).toBeVisible({ timeout: 20_000 });
  // Let the tenant dashboard load, so there is something to leak.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  const cachedWhileActing = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((k) => k.startsWith("ulc:") || k.startsWith("udc:"))
  );
  expect(cachedWhileActing.length, "the tenant dashboard cached something").toBeGreaterThan(0);

  const afterStop: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) afterStop.push(`${req.method()} ${url.pathname}`);
  });
  await page.getByRole("button", { name: /Stop impersonating/ }).click();
  await expect(page).toHaveURL(/\/platform/, { timeout: 20_000 });
  await expect(page.getByTestId("impersonation-banner")).toHaveCount(0);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

  const tenantScoped = afterStop.filter((r) => !/^\w+ \/api\/(auth|platform)(\/|$)/.test(r));
  expect(tenantScoped, "calls made after Stop outside /api/auth and /api/platform").toEqual([]);

  const cachedAfterStop = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((k) => k.startsWith("ulc:") || k.startsWith("udc:"))
  );
  expect(cachedAfterStop, "tenant rows still cached after Stop").toEqual([]);
});
