import { expect, test, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * A brand-new tenant is provisioned by the platform admin, its owner accepts the
 * invitation and completes the onboarding wizard in the browser, landing on the
 * dashboard. Exercises P1-00 parts 1 and 2 end to end.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@e2e.shiftline.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "E2eAdmin#2026!!";

const cookieFromLogin = async (
  context: BrowserContext,
  headers: { name: string; value: string }[]
) => {
  const rt = headers
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .find((v) => v.startsWith("shiftline_rt="));
  expect(rt, "refresh cookie issued").toBeTruthy();
  await context.addCookies([
    {
      name: "shiftline_rt",
      value: rt!.split(";")[0].split("=")[1],
      domain: new URL(API).hostname,
      path: "/api/auth",
      httpOnly: true,
      secure: true,
      sameSite: "None",
    },
  ]);
};

const provisionTenant = async (request: APIRequestContext) => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const admin = await request.post(`${API}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(admin.ok(), await admin.text()).toBe(true);
  const adminToken = (await admin.json()).data.accessToken as string;
  const created = await request.post(`${API}/api/platform/tenants`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: {
      companyCode: `E2E${suffix.toUpperCase()}`,
      companyName: `Wizard Works ${suffix}`,
      slug: `wizard-${suffix}`,
      owner: { email: `owner.${suffix}@wizard.example`, fullName: "Wizard Owner" },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const body = await created.json();
  const token = new URL(body.data.ownerInvitation.acceptUrl).searchParams.get("token")!;
  return { suffix, token, companyName: body.data.company.companyName as string };
};

test("a new tenant's owner completes onboarding and reaches the dashboard", async ({
  page,
  context,
  request,
}) => {
  const failures: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500)
      failures.push(`${res.request().method()} ${res.url()} -> ${res.status()}`);
  });
  page.on("pageerror", (err) => failures.push(`pageerror: ${err.message}`));

  const { suffix, token } = await provisionTenant(request);

  // The owner accepts the invitation through the API (the page itself is covered by unit tests).
  const accepted = await request.post(`${API}/api/invitations/token/${token}/accept`, {
    data: { password: "WizardOwner#2026!" },
  });
  expect(accepted.status(), await accepted.text()).toBe(201);
  await cookieFromLogin(context, accepted.headersArray());

  // Any protected page redirects a not-yet-onboarded tenant to the wizard.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { name: "Company details" })).toBeVisible();

  // 1. Company
  await page.getByLabel("Legal name").fill(`Wizard Works ${suffix} Private Limited`);
  await page.getByLabel("Address").fill("1 Wizard Road");
  await page.getByLabel("City").fill("Chennai");
  await page.getByLabel("State").selectOption({ label: "Tamil Nadu" });
  await page.getByLabel("PIN code").fill("600001");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 2. GST: a check-digit-valid placeholder GSTIN fills the head office state.
  await expect(page.getByRole("heading", { name: "GST and places of business" })).toBeVisible();
  await page.getByRole("textbox", { name: /^GSTIN/ }).fill("33AAAAA0000A1Z9");
  await expect(page.getByText(/Valid · Tamil Nadu/)).toBeVisible();
  await page.getByRole("button", { name: "+ Add a place" }).click();
  await page.getByLabel("Place 2 code").fill("F1");
  await page.getByLabel("Place 2 name").fill("Unit 1");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 3. Financial year (default April–March).
  await expect(page.getByRole("heading", { name: "Financial year" })).toBeVisible();
  await expect(page.getByText(/^FY \d{4}-\d{2}$/)).toBeVisible();
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 4. Bank: give the provisioned account its details and an opening balance.
  await expect(page.getByRole("heading", { name: "Bank accounts" })).toBeVisible();
  await page.getByLabel("Account 1 name").fill("HDFC Current Account");
  await page.getByLabel("Account 1 bank").fill("HDFC Bank");
  await page.getByLabel("Account number").fill("50100123456789");
  await page.getByLabel("IFSC").fill("HDFC0001234");
  await page.getByLabel("Opening balance (₹)").fill("150000");
  await page.getByRole("button", { name: "Save and continue" }).click();

  // 5. Team: invite one colleague.
  await expect(page.getByRole("heading", { name: "Invite your team" })).toBeVisible();
  await page.getByLabel("Invitee 1 email").fill(`accounts.${suffix}@wizard.example`);
  await page.getByRole("button", { name: "Send invitations" }).click();
  await expect(page.getByText(/^invited/)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  // 6. Review: bank details and the invitation show up; accept the terms and finish.
  await expect(page.getByRole("heading", { name: "Review and finish" })).toBeVisible();
  await expect(page.getByText("HDFC Current Account")).toBeVisible();
  await expect(page.getByText(/1 pending invitation/)).toBeVisible();
  await page.getByLabel(/accept the terms of service/).check();
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText(/Field Team Map/i)).toBeVisible();

  // Once onboarded, the wizard bounces back to the dashboard.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard/);

  expect(failures).toEqual([]);
});
