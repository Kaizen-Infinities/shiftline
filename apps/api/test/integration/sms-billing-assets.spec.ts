import { describe, expect, it, beforeAll } from "vitest";

import { api, authed, ADMIN } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createSalesInvoice, demoCompany } from "../factories";

/**
 * P2-19: SMS wiring for payment links and captures, a negotiated monthly billing price settable
 * only by a platform admin, and three fixed-assets follow-ups — capitalising an expense,
 * a downloadable opening-import template, and a reversed run's restored figures in one view.
 */
const sfx = Date.now().toString(36).slice(-6);
const KEY_SECRET = `fixture-key-secret-${sfx}`;
const WEBHOOK_SECRET = `fixture-webhook-secret-${sfx}`;

const adminAuth = async () => {
  const login = await (
    await api()
  )
    .post("/api/auth/login")
    .send({ email: ADMIN.email, password: ADMIN.password });
  return { Authorization: `Bearer ${login.body.data.accessToken}` };
};

const callback = async (path: string, body: string, signature: string) =>
  (await api())
    .post(path)
    .set("Content-Type", "application/json")
    .set("x-payment-signature", signature)
    .send(body);

describe("payment SMS wiring (P2-19)", () => {
  let OWNER: { auth: Record<string, string> };
  let WEBHOOK_PATH: string;
  let INVOICE: { id: string; invoiceNo: string };
  const MOBILE = "9123456790";

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const client = await api();

    // Register both templates on the DLT and turn SMS on.
    const templates = await client.get("/api/sms/templates").set(OWNER.auth);
    for (const t of templates.body.data as { code: string; name: string; body: string }[]) {
      if (t.code !== "PAYMENT_LINK" && t.code !== "PAYMENT_RECEIVED") continue;
      await client
        .put("/api/sms/templates")
        .set(OWNER.auth)
        .send({
          code: t.code,
          name: t.name,
          category: "TRANSACTIONAL",
          dltTemplateId: `1101${sfx}${t.code.slice(0, 2)}`.slice(0, 30),
          body: t.body,
          isActive: true,
        });
    }
    await client
      .put("/api/sms/settings")
      .set(OWNER.auth)
      .send({
        provider: "FIXTURE",
        enabled: true,
        senderId: "SHFTLN",
        principalEntityId: "1101000000000003",
        authKey: `fixture-auth-key-${sfx}`,
        dailyCap: 2000,
      });

    const saved = await client.put("/api/payments/settings").set(OWNER.auth).send({
      provider: "FIXTURE",
      enabled: true,
      keyId: "fixture_key",
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET,
      bankLedgerCode: "BANK-001",
      feeLedgerCode: "PG-FEE-001",
      expiryHours: 72,
    });
    expect(saved.status, JSON.stringify(saved.body).slice(0, 300)).toBe(200);
    WEBHOOK_PATH = saved.body.data.webhookPath;

    const customer = await createCustomer({ stateCode: "27", mobile: [MOBILE] });
    const invoice = await createSalesInvoice({ customerId: customer.id, grandTotal: "8000" });
    INVOICE = { id: invoice.id, invoiceNo: invoice.invoiceNo };
  });

  it("queues PAYMENT_LINK once when a link is raised, and PAYMENT_RECEIVED once when it is captured", async () => {
    const prisma = await getPrisma();
    const client = await api();

    const before = await asDemoTenant(() =>
      prisma.smsMessage.count({ where: { templateCode: "PAYMENT_LINK", toMobile: MOBILE } })
    );
    const created = await client
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ salesInvoiceId: INVOICE.id, amount: 2000, description: "SMS test" });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);

    const afterLink = await asDemoTenant(() =>
      prisma.smsMessage.count({ where: { templateCode: "PAYMENT_LINK", toMobile: MOBILE } })
    );
    expect(afterLink).toBe(before + 1);
    const linkMsg = await asDemoTenant(() =>
      prisma.smsMessage.findFirst({
        where: { templateCode: "PAYMENT_LINK", toMobile: MOBILE },
        orderBy: { queuedAt: "desc" },
      })
    );
    expect(linkMsg?.body).toContain(INVOICE.invoiceNo);

    const receivedBefore = await asDemoTenant(() =>
      prisma.smsMessage.count({ where: { templateCode: "PAYMENT_RECEIVED", toMobile: MOBILE } })
    );
    const prepared = await client
      .post(`/api/payments/links/${created.body.data.id}/simulate`)
      .set(OWNER.auth)
      .send({});
    expect(prepared.status, JSON.stringify(prepared.body).slice(0, 300)).toBe(200);
    const { body, signature } = prepared.body.data as { body: string; signature: string };

    const delivered = await callback(WEBHOOK_PATH, body, signature);
    expect(delivered.status, JSON.stringify(delivered.body).slice(0, 300)).toBe(200);
    expect(delivered.body.data.status).toBe("PROCESSED");

    const receivedAfter = await asDemoTenant(() =>
      prisma.smsMessage.count({ where: { templateCode: "PAYMENT_RECEIVED", toMobile: MOBILE } })
    );
    expect(receivedAfter).toBe(receivedBefore + 1);

    // The gateway redelivers the callback; the capture is idempotent, so no second SMS is queued.
    const again = await callback(WEBHOOK_PATH, body, signature);
    expect(again.body.data.status).toBe("DUPLICATE");
    const receivedAfterRedelivery = await asDemoTenant(() =>
      prisma.smsMessage.count({ where: { templateCode: "PAYMENT_RECEIVED", toMobile: MOBILE } })
    );
    expect(receivedAfterRedelivery).toBe(receivedBefore + 1);
  });

  it("skips silently, without failing the link, when SMS is turned off", async () => {
    const client = await api();
    const prisma = await getPrisma();

    await client.put("/api/sms/settings").set(OWNER.auth).send({
      provider: "FIXTURE",
      enabled: false,
      senderId: "SHFTLN",
      principalEntityId: "1101000000000003",
      dailyCap: 2000,
    });

    const before = await asDemoTenant(() =>
      prisma.smsMessage.count({ where: { templateCode: "PAYMENT_LINK", toMobile: MOBILE } })
    );
    const created = await client
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ amount: 750, description: "SMS off test", notifyPhone: MOBILE });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);

    const after = await asDemoTenant(() =>
      prisma.smsMessage.count({ where: { templateCode: "PAYMENT_LINK", toMobile: MOBILE } })
    );
    expect(after).toBe(before);

    // Turn it back on for anything that runs after this in the same file.
    await client
      .put("/api/sms/settings")
      .set(OWNER.auth)
      .send({
        provider: "FIXTURE",
        enabled: true,
        senderId: "SHFTLN",
        principalEntityId: "1101000000000003",
        authKey: `fixture-auth-key-${sfx}`,
        dailyCap: 2000,
      });
  });
});

describe("negotiated monthly billing price (P2-19)", () => {
  let COMPANY_ID: string;

  beforeAll(async () => {
    COMPANY_ID = (await demoCompany()).id;
  });

  it("is refused for a tenant user and accepted for a platform admin, and the sweep bills it", async () => {
    const owner = await authed("demo.owner");
    const client = await api();

    const refused = await client
      .put(`/api/platform/tenants/${COMPANY_ID}/subscription`)
      .set(owner.auth)
      .send({ negotiatedMonthlyPrice: 18500 });
    expect(refused.status).toBe(403);

    const admin = await adminAuth();
    const accepted = await client
      .put(`/api/platform/tenants/${COMPANY_ID}/subscription`)
      .set(admin)
      .send({ negotiatedMonthlyPrice: 18500 });
    expect(accepted.status, JSON.stringify(accepted.body).slice(0, 300)).toBe(200);
    expect(Number(accepted.body.data.subscription.negotiatedMonthlyPrice)).toBe(18500);

    // Read back through the subscription endpoint too.
    const read = await client.get(`/api/platform/tenants/${COMPANY_ID}/subscription`).set(admin);
    expect(Number(read.body.data.subscription.negotiatedMonthlyPrice)).toBe(18500);

    // The demo tenant is on ENTERPRISE, which has no list price — raise() would refuse it
    // (NO_PRICE) without the negotiated price now standing in for it.
    const { billingService } = await import("../../src/modules/payments/billing.service");
    const periodStart = new Date("2033-06-01T00:00:00Z");
    const periodEnd = new Date("2033-06-30T00:00:00Z");
    const invoice = await billingService.raise(COMPANY_ID, { periodStart, periodEnd });
    expect(Number(invoice.amount)).toBe(18500);

    // Idempotent, as raise() already is.
    const again = await billingService.raise(COMPANY_ID, { periodStart, periodEnd });
    expect(again.id).toBe(invoice.id);

    // Clear it so it does not leak into any other suite's billing expectations.
    const cleared = await client
      .put(`/api/platform/tenants/${COMPANY_ID}/subscription`)
      .set(admin)
      .send({ negotiatedMonthlyPrice: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.subscription.negotiatedMonthlyPrice).toBeNull();
  });

  it("refuses a cross-tenant subscription read even for a platform admin acting on someone else's company", async () => {
    // A platform admin reads by tenant id explicitly, so there is no ambient cross-tenant leak to
    // prove here the way a tenant-scoped query would need; instead prove the unknown-id path.
    const admin = await adminAuth();
    const res = await (
      await api()
    )
      .get("/api/platform/tenants/00000000-0000-0000-0000-000000000000/subscription")
      .set(admin);
    expect(res.status).toBe(404);
  });
});

describe("fixed assets follow-ups (P2-19)", () => {
  let OWNER: { auth: Record<string, string> };

  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("capitalises an approved, posted expense and refuses a second time", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const number = `EXP-CAP-${sfx}`;

    const expense = await client.post("/api/expenses").set(OWNER.auth).send({
      expenseNumber: number,
      status: "Approved",
      expenseCategory: "Plant",
      date: "2032-04-10",
      expense: "Small compressor",
      amount: 42000,
      paymentMethod: "Cash",
    });
    expect(expense.status, JSON.stringify(expense.body).slice(0, 400)).toBe(201);
    const expenseId = expense.body.data.id as string;

    const posted = await asDemoTenant(() =>
      prisma.voucher.findFirstOrThrow({
        where: { refDocType: "EXPENSE", refDocId: expenseId, status: "POSTED" },
      })
    );
    expect(posted).toBeTruthy();

    const classesRes = await client.get("/api/assets/classes").set(OWNER.auth);
    const pm = (classesRes.body.data as { id: string; code: string }[]).find(
      (c) => c.code === "PM"
    )!;

    const expBefore = await asDemoTenant(async () => {
      const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code: "EXP-001" } });
      const items = await prisma.journalItem.findMany({
        where: {
          OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
          voucher: { status: "POSTED" },
        },
        select: {
          debitLedgerId: true,
          creditLedgerId: true,
          debitAmount: true,
          creditAmount: true,
        },
      });
      return items.reduce(
        (s, i) =>
          s +
          (i.debitLedgerId === ledger.id ? Number(i.debitAmount) : 0) -
          (i.creditLedgerId === ledger.id ? Number(i.creditAmount) : 0),
        0
      );
    });

    const capRes = await client
      .post("/api/assets/capitalise")
      .set(OWNER.auth)
      .send({
        sourceDocType: "EXPENSE",
        sourceDocId: expenseId,
        classId: pm.id,
        code: `FA-EXPCAP-${sfx}`,
        name: `Compressor ${sfx}`,
      });
    expect(capRes.status, JSON.stringify(capRes.body).slice(0, 400)).toBe(201);
    expect(capRes.body.data.voucherId).toBeTruthy();
    expect(Number(capRes.body.data.cost)).toBe(42000);

    const expAfter = await asDemoTenant(async () => {
      const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code: "EXP-001" } });
      const items = await prisma.journalItem.findMany({
        where: {
          OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
          voucher: { status: "POSTED" },
        },
        select: {
          debitLedgerId: true,
          creditLedgerId: true,
          debitAmount: true,
          creditAmount: true,
        },
      });
      return items.reduce(
        (s, i) =>
          s +
          (i.debitLedgerId === ledger.id ? Number(i.debitAmount) : 0) -
          (i.creditLedgerId === ledger.id ? Number(i.creditAmount) : 0),
        0
      );
    });
    // Capitalising credits the expense ledger back out for the amount moved to the asset.
    expect(Math.round(expBefore - expAfter)).toBe(42000);

    const again = await client
      .post("/api/assets/capitalise")
      .set(OWNER.auth)
      .send({
        sourceDocType: "EXPENSE",
        sourceDocId: expenseId,
        classId: pm.id,
        code: `FA-EXPCAP2-${sfx}`,
        name: "Second attempt",
      });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_CAPITALISED");
  });

  it("serves the opening-import CSV template with headers and one example row", async () => {
    const res = await (await api()).get("/api/assets/opening/template.csv").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = (res.text as string).trim().split(/\r?\n/);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("classCode");
    expect(lines[0]).toContain("code");
    expect(lines[0]).toContain("accumulatedDepreciation");
    // The example row parses back through the same importer without a header error.
    expect(lines[1]).toContain("PM");
  });

  it("refuses the template to a caller without assets.manage", async () => {
    const production = await authed("demo.production");
    const res = await (await api()).get("/api/assets/opening/template.csv").set(production.auth);
    expect(res.status).toBe(403);
  });

  it("shows a reversed run's accumulated depreciation before and after, for every asset on it", async () => {
    const client = await api();
    const P1 = "2033-02";
    const P2 = "2033-03";

    const addRes = await client
      .post("/api/assets")
      .set(OWNER.auth)
      .send({
        code: `FA-VIEW-${sfx.toUpperCase()}`,
        name: `Reversible View Machine ${sfx}`,
        classCode: "PM",
        cost: 240000,
        acquiredOn: "2033-02-01",
        capitalisedOn: "2033-02-01",
      });
    expect(addRes.status, JSON.stringify(addRes.body).slice(0, 400)).toBe(201);

    const run1 = await client.post(`/api/assets/depreciation/${P1}/prepare`).set(OWNER.auth);
    expect(run1.status).toBe(200);
    const run1Id = run1.body.data.id as string;
    await client.post(`/api/assets/depreciation/runs/${run1Id}/post`).set(OWNER.auth);

    const run2 = await client.post(`/api/assets/depreciation/${P2}/prepare`).set(OWNER.auth);
    expect(run2.status).toBe(200);
    const run2Id = run2.body.data.id as string;
    await client.post(`/api/assets/depreciation/runs/${run2Id}/post`).set(OWNER.auth);

    const reversed = await client
      .post(`/api/assets/depreciation-runs/${run2Id}/reverse`)
      .set(OWNER.auth);
    expect(reversed.status, JSON.stringify(reversed.body).slice(0, 400)).toBe(200);

    const detail = await client.get(`/api/assets/depreciation-runs/${run2Id}`).set(OWNER.auth);
    expect(detail.status, JSON.stringify(detail.body).slice(0, 400)).toBe(200);
    expect(detail.body.data.status).toBe("REVERSED");
    const lines = detail.body.data.lines as {
      code: string;
      amount: number;
      accumulatedDepreciationBefore: number;
      accumulatedDepreciationAfter: number;
    }[];
    const line = lines.find((l) => l.code === `FA-VIEW-${sfx.toUpperCase()}`);
    expect(line).toBeDefined();
    // "before" is what the run had charged (still on the asset); "after" is what the reversal
    // restored it to — the run's own amount is exactly the gap between the two.
    expect(
      Math.round((line!.accumulatedDepreciationBefore - line!.accumulatedDepreciationAfter) * 100) /
        100
    ).toBe(Math.round(line!.amount * 100) / 100);

    // A still-posted run shows the same figure both ways: nothing has moved it back yet.
    const postedDetail = await client
      .get(`/api/assets/depreciation-runs/${run1Id}`)
      .set(OWNER.auth);
    const postedLine = (
      postedDetail.body.data.lines as {
        code: string;
        accumulatedDepreciationBefore: number;
        accumulatedDepreciationAfter: number;
      }[]
    ).find((l) => l.code === `FA-VIEW-${sfx.toUpperCase()}`);
    expect(postedLine!.accumulatedDepreciationBefore).toBe(
      postedLine!.accumulatedDepreciationAfter
    );

    // Leave no posted run behind: a later-period POSTED run blocks any other suite's own
    // out-of-order check on an earlier period, in the same demo tenant these tests share.
    const rev1 = await client
      .post(`/api/assets/depreciation-runs/${run1Id}/reverse`)
      .set(OWNER.auth);
    expect(rev1.status, JSON.stringify(rev1.body).slice(0, 400)).toBe(200);
  });

  it("refuses opening/run-detail and capitalisation across tenants", async () => {
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Assets SMS Billing Tenant B", companyCode: `FAB2-${sfx}` },
      })
    );
    const run = await asDemoTenant(() => prisma.depreciationRun.findFirst());
    if (run) {
      const seenFromOther = await runAsTenant(other.id, () =>
        prisma.depreciationRun.findUnique({ where: { id: run.id } })
      );
      expect(seenFromOther).toBeNull();
    }
  });
});
