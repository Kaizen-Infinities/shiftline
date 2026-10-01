import { expect, test, type Page } from "@playwright/test";

/**
 * Fourteen screens must render for a logged-in owner without a server error.
 * `marker` is a stable piece of text on the page; the API tracker fails the
 * test on any 5xx the screen triggered.
 */
const SCREENS: { path: string; marker: RegExp }[] = [
  { path: "/dashboard", marker: /Field Team Map/i },
  { path: "/users", marker: /^users$/i },
  { path: "/roles", marker: /^roles$/i },
  { path: "/employees", marker: /^employees$/i },
  { path: "/products", marker: /production products/i },
  { path: "/raw-materials", marker: /^raw materials$/i },
  { path: "/machines", marker: /Machine/i },
  { path: "/production-orders", marker: /Production Order/i },
  { path: "/sales-order", marker: /^sales orders$/i },
  { path: "/sales-invoices", marker: /^sales invoices$/i },
  { path: "/settings/company", marker: /General Info/i },
  { path: "/company/view", marker: /Employee Code/i },
  { path: "/settings/imports", marker: /data imports/i },
  { path: "/settings/gst", marker: /HSN/ },
  { path: "/accounts/chart-of-accounts", marker: /chart of accounts/i },
  { path: "/reports/audit", marker: /audit trail/i },
  { path: "/accounts/year-end", marker: /year-end closing/i },
  { path: "/accounts/day-book", marker: /day book/i },
  { path: "/accounts/cash-flow", marker: /^cash flow$/i },
  { path: "/accounts/balance-sheet", marker: /balance sheet/i },
  { path: "/accounts/profit-loss", marker: /profit & loss/i },
  { path: "/expenses", marker: /expenses & claims/i },
  { path: "/settings/devices", marker: /field devices/i },
  { path: "/settings/export", marker: /account export/i },
  { path: "/compliance/approvals", marker: /filing approvals/i },
  { path: "/status", marker: /All systems operational|Some systems degraded/ },
  { path: "/compliance/e-invoices", marker: /e-invoice register/i },
  { path: "/settings/e-invoice", marker: /e-invoicing/i },
  { path: "/compliance/eway-bills", marker: /e-way bills/i },
  { path: "/settings/transporters", marker: /transporters/i },
  { path: "/compliance/gst", marker: /gst returns/i },
  { path: "/compliance/calendar", marker: /compliance calendar/i },
  { path: "/sales/advances", marker: /advances received/i },
  { path: "/settings/currencies", marker: /currencies & rates/i },
  { path: "/production/job-work", marker: /job work/i },
  { path: "/compliance/tds", marker: /tds & tcs/i },
  { path: "/accounts/tally", marker: /tally export/i },
  { path: "/payable/msme", marker: /msme dues/i },
  { path: "/accounts/fixed-assets", marker: /fixed assets/i },
  { path: "/accounts/forex", marker: /foreign exchange/i },
  { path: "/accounts/costing", marker: /costing/i },
  { path: "/accounts/bank-reconciliation", marker: /bank reconciliation/i },
  { path: "/payroll/statutory", marker: /statutory payroll/i },
  { path: "/payroll/entitlements", marker: /leave & entitlements/i },
  { path: "/sales/delivery-schedules", marker: /delivery schedules/i },
  { path: "/hr/leave", marker: /^leave requests$/i },
  { path: "/me/leave", marker: /my leave/i },
  { path: "/production/order-tna", marker: /order t&a/i },
  { path: "/exports/incentives", marker: /export incentives/i },
  { path: "/hr/registers", marker: /statutory registers/i },
  { path: "/hr/fines", marker: /fines & deductions/i },
  { path: "/accounts/payment-links", marker: /payment links/i },
  { path: "/settings/sms", marker: /sms & otp/i },
  { path: "/notifications", marker: /You are up to date|unread/i },
  { path: "/settings/machine-gateways", marker: /Machine gateways/i },
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
      // Visible matches only: the in-page breadcrumb repeats the title but is hidden from `lg` up.
      await expect(page.getByText(screen.marker).filter({ visible: true }).first()).toBeVisible({
        timeout: 20_000,
      });
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
