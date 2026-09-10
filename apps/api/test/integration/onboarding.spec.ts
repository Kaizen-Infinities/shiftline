import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";

/**
 * Onboarding wizard (P1-00 part 2): a provisioned tenant's owner walks through
 * every step, accepts the terms and is marked onboarded; permissions and the
 * post-completion lock are enforced.
 */
describe("onboarding wizard", () => {
  const suffix = randomUUID().slice(0, 6);
  const companyCode = `O${suffix.toUpperCase()}`;
  const slug = `o-${suffix}`;
  const ownerEmail = `owner.${suffix}@onboard.example`;
  let companyId: string;
  let owner: { Authorization: string };

  const asOwner = () => owner;

  it("the invited owner lands on the first step with the provisioned defaults", async () => {
    const adminLogin = await (
      await api()
    )
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: ADMIN.password });
    const created = await (
      await api()
    )
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${adminLogin.body.data.accessToken}`)
      .send({
        companyCode,
        companyName: "Onboard Metals",
        slug,
        owner: { email: ownerEmail, fullName: "Onboard Owner" },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    companyId = created.body.data.company.id;
    const token = new URL(created.body.data.ownerInvitation.acceptUrl).searchParams.get("token")!;
    const accepted = await (
      await api()
    )
      .post(`/api/invitations/token/${token}/accept`)
      .send({ password: "OnboardOwner#2026!" });
    expect(accepted.status).toBe(201);
    owner = { Authorization: `Bearer ${accepted.body.data.accessToken}` };

    const state = await (await api()).get("/api/onboarding").set(asOwner());
    expect(state.status, JSON.stringify(state.body)).toBe(200);
    expect(state.body.data).toMatchObject({
      step: "company",
      isOnboarded: false,
      tos: { accepted: false },
      company: { companyName: "Onboard Metals", slug },
    });
    expect(state.body.data.steps.map((s: { key: string }) => s.key)).toEqual([
      "company",
      "gst",
      "financial-year",
      "bank",
      "users",
      "review",
    ]);
    expect(state.body.data.steps.every((s: { done: boolean }) => !s.done)).toBe(true);
    expect(state.body.data.gst.businessPlaces).toHaveLength(1);
    expect(state.body.data.gst.businessPlaces[0]).toMatchObject({ code: "HO", isHeadOffice: true });
    expect(state.body.data.bankAccounts).toEqual([
      expect.objectContaining({ code: "BANK-001", name: "Main Bank Account", bankName: null }),
    ]);
    expect(state.body.data.roles.map((r: { code: string }) => r.code).sort()).toEqual([
      "ACCOUNTS",
      "AUDITOR",
      "OWNER",
      "PRODUCTION",
      "SALES_EXEC",
      "STORES",
    ]);
    expect(state.body.data.users).toHaveLength(1);
    expect(state.body.data.financialYear).toMatchObject({
      code: expect.stringMatching(/^\d{4}-\d{2}$/),
    });

    // Nothing can be completed before the steps are done.
    const early = await (await api()).post("/api/onboarding/complete").set(asOwner());
    expect(early.status).toBe(409);
  });

  it("company step validates and advances", async () => {
    const bad = await (
      await api()
    )
      .put("/api/onboarding/company")
      .set(asOwner())
      .send({ companyName: "" });
    expect(bad.status).toBe(400);

    const ok = await (await api()).put("/api/onboarding/company").set(asOwner()).send({
      companyName: "Onboard Metals",
      legalName: "Onboard Metals Private Limited",
      email: "office@onboard.example",
      phone: "04412345678",
      addressLine1: "12 Industrial Estate",
      city: "Coimbatore",
      state: "Tamil Nadu",
      zipcode: "641001",
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.step).toBe("gst");

    const prisma = await getPrisma();
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company).toMatchObject({
      legalName: "Onboard Metals Private Limited",
      city: "Coimbatore",
      onboardingStep: "gst",
    });
  });

  it("gst step checks the GSTIN, needs one head office and stores the places", async () => {
    const badGstin = await (
      await api()
    )
      .put("/api/onboarding/gst")
      .set(asOwner())
      .send({
        registrationType: "REGULAR",
        gstin: "33AAAAA0000A1Z5", // wrong check digit
        businessPlaces: [
          {
            code: "HO",
            name: "Head Office",
            type: "HEAD_OFFICE",
            gstPlaceCode: "33",
            isHeadOffice: true,
          },
        ],
      });
    expect(badGstin.status).toBe(400);

    const stateMismatch = await (
      await api()
    )
      .put("/api/onboarding/gst")
      .set(asOwner())
      .send({
        registrationType: "REGULAR",
        gstin: "33AAAAA0000A1Z9",
        businessPlaces: [
          {
            code: "HO",
            name: "Head Office",
            type: "HEAD_OFFICE",
            gstPlaceCode: "29",
            isHeadOffice: true,
          },
        ],
      });
    expect(stateMismatch.status).toBe(400);

    const ok = await (
      await api()
    )
      .put("/api/onboarding/gst")
      .set(asOwner())
      .send({
        registrationType: "REGULAR",
        gstin: "33AAAAA0000A1Z9",
        businessPlaces: [
          {
            code: "HO",
            name: "Registered Office",
            type: "HEAD_OFFICE",
            gstPlaceCode: "33",
            isHeadOffice: true,
            addressLine1: "12 Industrial Estate",
            city: "Coimbatore",
          },
          { code: "F1", name: "Unit 1", type: "FACTORY", gstPlaceCode: "33", city: "Coimbatore" },
        ],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.step).toBe("financial-year");

    const state = await (await api()).get("/api/onboarding").set(asOwner());
    expect(state.body.data.gst).toMatchObject({
      registrationType: "REGULAR",
      gstin: "33AAAAA0000A1Z9",
    });
    expect(state.body.data.gst.businessPlaces.map((p: { code: string }) => p.code)).toEqual([
      "HO",
      "F1",
    ]);
    expect(state.body.data.gst.businessPlaces[0]).toMatchObject({
      name: "Registered Office",
      addressLine1: "12 Industrial Estate",
    });
    expect(state.body.data.company.state).toBe("Tamil Nadu");
  });

  it("financial-year step re-dates the open period, settings and unused numbering series", async () => {
    const midMonth = await (
      await api()
    )
      .put("/api/onboarding/financial-year")
      .set(asOwner())
      .send({ fyStart: "2026-01-15" });
    expect(midMonth.status).toBe(400);

    const ok = await (
      await api()
    )
      .put("/api/onboarding/financial-year")
      .set(asOwner())
      .send({ fyStart: "2026-01-01", booksBeginOn: "2026-06-01" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data).toMatchObject({
      step: "bank",
      financialYear: {
        start: "2026-01-01",
        end: "2026-12-31",
        code: "2026",
        booksBeginOn: "2026-06-01",
      },
    });

    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    await runAsTenant(companyId, async () => {
      const setting = await prisma.invoiceSetting.findUniqueOrThrow({ where: { companyId } });
      expect(setting.financialYearStart.toISOString().slice(0, 10)).toBe("2026-01-01");
      expect(setting.financialYearEnd.toISOString().slice(0, 10)).toBe("2026-12-31");
      const periods = await prisma.accountingPeriod.findMany();
      expect(periods).toHaveLength(1);
      expect(periods[0].periodName).toBe("FY 2026");
      const codes = await prisma.documentSequence.groupBy({ by: ["fyCode"], _count: true });
      expect(codes.map((c) => c.fyCode)).toEqual(["2026"]);
    });
  });

  it("bank step renames the provisioned ledger, adds another with an opening balance and picks a default", async () => {
    const state = await (await api()).get("/api/onboarding").set(asOwner());
    const mainLedgerId = state.body.data.bankAccounts[0].ledgerId as number;

    const badIfsc = await (
      await api()
    )
      .put("/api/onboarding/bank")
      .set(asOwner())
      .send({ accounts: [{ name: "X", bankName: "Y", ifsc: "12345" }] });
    expect(badIfsc.status).toBe(400);

    const ok = await (
      await api()
    )
      .put("/api/onboarding/bank")
      .set(asOwner())
      .send({
        accounts: [
          {
            ledgerId: mainLedgerId,
            name: "HDFC Current Account",
            bankName: "HDFC Bank",
            accountNumber: "50100123456789",
            ifsc: "HDFC0001234",
            branch: "Coimbatore RS Puram",
            isDefault: true,
          },
          {
            name: "SBI Cash Credit",
            bankName: "State Bank of India",
            accountNumber: "38123456789",
            ifsc: "SBIN0001234",
            openingBalance: 250000,
          },
        ],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.step).toBe("users");
    expect(ok.body.data.accounts).toEqual([
      expect.objectContaining({ code: "BANK-001", name: "HDFC Current Account" }),
      expect.objectContaining({ code: "BANK-002", name: "SBI Cash Credit" }),
    ]);

    const after = await (await api()).get("/api/onboarding").set(asOwner());
    const banks = after.body.data.bankAccounts as Record<string, unknown>[];
    expect(banks).toHaveLength(2);
    expect(banks.find((b) => b.code === "BANK-001")).toMatchObject({
      bankName: "HDFC Bank",
      ifsc: "HDFC0001234",
      isDefault: true,
      currentBalance: 0,
    });
    expect(banks.find((b) => b.code === "BANK-002")).toMatchObject({
      currentBalance: 250000,
      hasOpeningBalance: true,
      isDefault: false,
    });

    // The opening entry is a balanced journal dated the day the books begin, and audited.
    const prisma = await getPrisma();
    const { runAsTenant } = await import("../../src/lib/tenant-context");
    await runAsTenant(companyId, async () => {
      const voucher = await prisma.voucher.findFirstOrThrow({
        where: { refDocType: "LEDGER_OPENING_BALANCE" },
        include: { items: true },
      });
      expect(voucher.date.toISOString().slice(0, 10)).toBe("2026-06-01");
      const debit = voucher.items.reduce((s, i) => s + Number(i.debitAmount), 0);
      const credit = voucher.items.reduce((s, i) => s + Number(i.creditAmount), 0);
      expect(debit).toBe(250000);
      expect(credit).toBe(250000);
      expect(await prisma.bankAccount.count()).toBe(2);
      const audit = await prisma.auditLog.count({
        where: { entityName: "bank_accounts", action: "CREATE" },
      });
      expect(audit).toBe(2);
    });
  });

  it("users step invites colleagues per role and reports duplicates", async () => {
    const ok = await (
      await api()
    )
      .put("/api/onboarding/users")
      .set(asOwner())
      .send({
        invitations: [
          {
            email: `accounts.${suffix}@onboard.example`,
            fullName: "Accounts Lead",
            roleCode: "ACCOUNTS",
          },
          { email: `sales.${suffix}@onboard.example`, roleCode: "SALES_EXEC" },
          { email: ownerEmail, roleCode: "OWNER" }, // already a user
          { email: `x.${suffix}@onboard.example`, roleCode: "NOPE" },
        ],
      });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.step).toBe("review");
    expect(ok.body.data.results.map((r: { status: string }) => r.status)).toEqual([
      "invited",
      "invited",
      "exists",
      "error",
    ]);
    expect(ok.body.data.results[0].acceptUrl).toMatch(/accept-invitation\?token=/);

    const state = await (await api()).get("/api/onboarding").set(asOwner());
    expect(state.body.data.invitations).toHaveLength(2);
    expect(state.body.data.steps.filter((s: { done: boolean }) => s.done)).toHaveLength(5);
  });

  it("completion needs the current terms accepted, then locks the wizard", async () => {
    const noTos = await (await api()).post("/api/onboarding/complete").set(asOwner());
    expect(noTos.status).toBe(409);

    const staleVersion = await (
      await api()
    )
      .post("/api/onboarding/accept-tos")
      .set(asOwner())
      .send({ version: "2020-01" });
    expect(staleVersion.status).toBe(400);

    const tos = await (
      await api()
    )
      .post("/api/onboarding/accept-tos")
      .set(asOwner())
      .send({ version: "2026-09" });
    expect(tos.status, JSON.stringify(tos.body)).toBe(200);

    const done = await (await api()).post("/api/onboarding/complete").set(asOwner());
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toMatchObject({ isOnboarded: true, onboardingStep: null });

    const company = await (await api()).get("/api/companies").set(asOwner());
    expect(company.body.data).toMatchObject({ isOnboarded: true, gstin: "33AAAAA0000A1Z9" });

    const prisma = await getPrisma();
    const row = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(row.tosAcceptedAt).toBeTruthy();
    expect(row.tosAcceptedBy).toBeTruthy();

    const locked = await (
      await api()
    )
      .put("/api/onboarding/company")
      .set(asOwner())
      .send({ companyName: "Renamed" });
    expect(locked.status).toBe(409);

    const state = await (await api()).get("/api/onboarding").set(asOwner());
    expect(state.body.data).toMatchObject({
      step: null,
      isOnboarded: true,
      tos: { accepted: true },
    });
    expect(state.body.data.steps.every((s: { done: boolean }) => s.done)).toBe(true);
  });

  it("members without company-settings.edit can read the state but not write", async () => {
    const sales = await authed("demo.sales");
    const read = await (await api()).get("/api/onboarding").set(sales.auth);
    expect(read.status).toBe(200);
    expect(read.body.data.isOnboarded).toBe(true);
    const write = await (
      await api()
    )
      .put("/api/onboarding/company")
      .set(sales.auth)
      .send({ companyName: "Nope" });
    expect(write.status).toBe(403);
  });
});
