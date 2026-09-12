import { expect, test, type Page } from "@playwright/test";

/**
 * Fourteen screens must render for a logged-in owner without a server error.
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
  { path: "/settings/imports", marker: /Data imports/i },
  { path: "/settings/gst", marker: /HSN/ },
  { path: "/accounts/chart-of-accounts", marker: /Chart of Accounts/ },
  { path: "/reports/audit", marker: /Audit Trail/ },
  { path: "/accounts/year-end", marker: /Year-End Closing/ },
  { path: "/accounts/day-book", marker: /Day Book/ },
  { path: "/accounts/cash-flow", marker: /Cash Flow Statement/ },
  { path: "/accounts/balance-sheet", marker: /Balance Sheet/ },
  { path: "/accounts/profit-loss", marker: /Profit & Loss/ },
  { path: "/expenses", marker: /Expense Management/ },
  { path: "/settings/devices", marker: /Field Devices/ },
  { path: "/settings/export", marker: /Account Export/ },
  { path: "/compliance/approvals", marker: /Filing Approvals/ },
  { path: "/status", marker: /All systems operational|Some systems degraded/ },
  { path: "/compliance/e-invoices", marker: /E-invoice Register/ },
  { path: "/settings/e-invoice", marker: /E-invoicing/ },
  { path: "/compliance/eway-bills", marker: /E-way Bills/ },
  { path: "/settings/transporters", marker: /Transporters/ },
  { path: "/compliance/gst", marker: /GST Returns/ },
  { path: "/compliance/calendar", marker: /Compliance Calendar/ },
  { path: "/sales/advances", marker: /Advances Received/ },
  { path: "/settings/currencies", marker: /Currencies and Rates/ },
  { path: "/production/job-work", marker: /Job Work/ },
  { path: "/compliance/tds", marker: /TDS and TCS/ },
  { path: "/accounts/tally", marker: /Tally Export/ },
  { path: "/payable/msme", marker: /MSME Dues/ },
  { path: "/notifications", marker: /You are up to date|unread/i },
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

const API = process.env.E2E_API_URL ?? "http://localhost:5000";
const USER = process.env.E2E_USER ?? "owner@demo.shiftline.local";
const PASSWORD = process.env.E2E_PASSWORD ?? "Demo@12345678";

/**
 * Each test starts from a fresh API login: the refresh cookie rotates on every
 * use, so a session saved to disk would be replayed and revoked by the second
 * test. Logging in through the API costs a few milliseconds.
 */
test.beforeEach(async ({ context, request }) => {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { email: USER, password: PASSWORD },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const setCookie = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie");
  const rt = setCookie.map((h) => h.value).find((v) => v.startsWith("shiftline_rt="));
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
    const context = await browser.newContext();
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
