import { createHmac, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct, demoCompany } from "../factories";

/**
 * Regression tests for the business-logic findings BL-01 (advance recovered twice), ABUSE-01
 * (overlapping receipts), BL-02/BL-03 (subscription charge reconciliation) and BL-04 (a FAILED
 * webhook event must be retried).
 */
const sfx = randomUUID().slice(0, 6).toUpperCase();
const n = (v: unknown) => Number(v);

describe("BL-01: salary advance is recovered exactly once", () => {
  it("approve then lock (and a replayed approve/lock) recovers the deduction once", async () => {
    const OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const company = await demoCompany();
    const employee = await asDemoTenant(() =>
      prisma.employee.create({
        data: {
          companyId: company.id,
          empCode: `BL1-${sfx}`,
          fullName: "Advance Once",
          status: "active",
          basicSalary: 10000,
          grossSalary: 10000,
        },
      })
    );
    const cfg = await (
      await api()
    )
      .put(`/api/payroll/employees/${employee.id}/config`)
      .set(OWNER.auth)
      .send({
        salaryType: "FIXED_MONTHLY",
        monthlySalary: 10000,
        basicSalary: 10000,
        da: 0,
        hra: 0,
        otherAllowance: 0,
        cashInHand: 0,
        paymentMode: "BANK",
      });
    expect(cfg.status).toBe(200);
    // Outstanding 300, but only 100 is withheld by the run.
    const advance = await (
      await api()
    )
      .post("/api/payroll/advances")
      .set(OWNER.auth)
      .send({ employeeId: Number(employee.id), amount: 300, disbursedDate: "2033-04-15" });
    expect(advance.status).toBe(201);

    const run = await (
      await api()
    )
      .post("/api/payroll/runs")
      .set(OWNER.auth)
      .send({
        period: "2033-05",
        type: "MONTHLY",
        employeeCategory: "FIXED_MONTHLY",
        calendarDays: 31,
        attendance: [
          {
            employeeId: Number(employee.id),
            presentDays: 31,
            absentDays: 0,
            halfDays: 0,
            otHours: 0,
            lateMinutes: 0,
            permissionMinutes: 0,
            advance: 100,
          },
        ],
      });
    expect(run.status, JSON.stringify(run.body).slice(0, 400)).toBe(201);
    expect(n(run.body.data.results[0].salaryAdvance)).toBe(100);
    const runId = run.body.data.id;
    const recovered = async () =>
      n(
        (
          await asDemoTenant(() =>
            prisma.salaryAdvance.findUniqueOrThrow({ where: { id: advance.body.data.id } })
          )
        ).recoveredAmount
      );

    // Two racing approvals: exactly one wins.
    const [a, b] = await Promise.all([
      (await api()).post(`/api/payroll/runs/${runId}/approve`).set(OWNER.auth),
      (await api()).post(`/api/payroll/runs/${runId}/approve`).set(OWNER.auth),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, expect.any(Number)]);
    expect([a.status, b.status].filter((s) => s === 200)).toHaveLength(1);
    expect(await recovered()).toBe(100);

    const locked = await (await api()).post(`/api/payroll/runs/${runId}/lock`).set(OWNER.auth);
    expect(locked.status).toBe(200);
    expect(await recovered()).toBe(100);

    const replay = await (await api()).post(`/api/payroll/runs/${runId}/lock`).set(OWNER.auth);
    expect(replay.status).toBe(400);
    expect(await recovered()).toBe(100);
  });
});

describe("ABUSE-01: overlapping receipts", () => {
  it("two receipts of 60% of an invoice cannot both settle; JSON, rows and vouchers agree", async () => {
    const OWNER = await authed("demo.owner");
    const prisma = await getPrisma();
    const client = await api();
    const customer = await createCustomer();
    const product = await createProduct();
    const created = await client
      .post("/api/sales-invoices")
      .set(OWNER.auth)
      .send({
        invoiceDate: "2026-09-01",
        customerId: customer.id,
        items: [{ productId: product.id.toString(), qty: 1, rate: 100 }],
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const id = created.body.data.id as string;
    const total = n(created.body.data.grandTotal);
    const part = Math.round(total * 0.6 * 100) / 100;

    const send = async () =>
      (await api())
        .post(`/api/sales-invoices/${id}/receipts`)
        .set(OWNER.auth)
        .send({ amount: part, paymentDate: "2026-09-05", instrumentType: "CASH" });
    const results = await Promise.all([send(), send()]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body).slice(0, 2)).slice(0, 400)).toEqual([
      201, 400,
    ]);
    expect(results.find((r) => r.status === 400)?.body.code).toBe("OVER_RECEIPT");

    const inv = await asDemoTenant(() => prisma.salesInvoice.findUniqueOrThrow({ where: { id } }));
    const json = inv.payments as Array<{ amount: number }>;
    const rows = await asDemoTenant(() =>
      prisma.salesInvoicePayment.findMany({ where: { salesInvoiceId: id } })
    );
    expect(json).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(n(rows[0].amount)).toBe(part);
    expect(n(json[0].amount)).toBe(part);
    expect(
      await asDemoTenant(() =>
        prisma.voucher.count({
          where: { refDocType: "SALES_PAYMENT", status: "POSTED", refDocId: (json[0] as any).id },
        })
      )
    ).toBe(1);
  });
});

describe("BL-02/BL-03: subscription charge reconciliation", () => {
  const SECRET = "test-platform-billing-secret-0000";
  const SUB_ID = `sub_bl_${Date.now().toString(36)}`;
  const callback = async (payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    return (await api())
      .post("/api/payments/webhook/platform")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", createHmac("sha256", SECRET).update(body).digest("hex"))
      .send(body);
  };
  let companyId: string;

  beforeAll(async () => {
    companyId = (await demoCompany()).id;
    const { billingService } = await import("../../src/modules/payments/billing.service");
    await billingService.attachProviderIds(companyId, { providerSubscriptionId: SUB_ID });
    await billingService.raise(companyId, {
      periodStart: new Date("2034-01-01T00:00:00Z"),
      periodEnd: new Date("2034-01-31T00:00:00Z"),
      amount: 7777,
    });
  });

  it("a short or wrong-invoice charge settles nothing and leaves the account's status alone", async () => {
    const prisma = await getPrisma();
    await asDemoTenant(async () => {
      const s = await prisma.subscription.findFirstOrThrow();
      await prisma.subscription.update({ where: { id: s.id }, data: { status: "PAST_DUE" } });
    });
    const res = await callback({
      event_id: `evt_short_${SUB_ID}`,
      event: "subscription.charged",
      subscription: { id: SUB_ID, invoice_id: "inv_other", payment_id: "pay_short", amount: 1 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe("IGNORED");
    const invoice = await asDemoTenant(() =>
      prisma.subscriptionInvoice.findFirstOrThrow({ where: { amount: 7777 } })
    );
    expect(invoice.status).toBe("DUE");
    const sub = await asDemoTenant(() => prisma.subscription.findFirstOrThrow());
    expect(sub.status).toBe("PAST_DUE");
  });

  it("the full-amount charge settles the invoice once and activates the account", async () => {
    const prisma = await getPrisma();
    const payload = {
      event: "subscription.charged",
      subscription: { id: SUB_ID, invoice_id: "inv_ok", payment_id: "pay_ok", amount: 7777 },
    };
    expect((await callback({ ...payload, event_id: `evt_ok_${SUB_ID}` })).status).toBe(200);
    expect((await callback({ ...payload, event_id: `evt_ok2_${SUB_ID}` })).status).toBe(200);
    const paid = await asDemoTenant(() =>
      prisma.subscriptionInvoice.findMany({ where: { providerPaymentId: "pay_ok" } })
    );
    expect(paid).toHaveLength(1);
    expect(paid[0].status).toBe("PAID");
    expect((await asDemoTenant(() => prisma.subscription.findFirstOrThrow())).status).toBe(
      "ACTIVE"
    );
  });

  it("a charge with no open invoice does not reactivate a past-due account", async () => {
    const prisma = await getPrisma();
    await asDemoTenant(async () => {
      const s = await prisma.subscription.findFirstOrThrow();
      await prisma.subscription.update({ where: { id: s.id }, data: { status: "PAST_DUE" } });
    });
    const res = await callback({
      event_id: `evt_none_${SUB_ID}`,
      event: "subscription.charged",
      subscription: { id: SUB_ID, invoice_id: "inv_none", payment_id: "pay_none", amount: 7777 },
    });
    expect(res.status).toBe(200);
    expect((await asDemoTenant(() => prisma.subscription.findFirstOrThrow())).status).toBe(
      "PAST_DUE"
    );
  });
});

describe("BL-04: a FAILED payment event is retried and posts once", () => {
  it("re-processes the same event id after a failure, then treats it as a duplicate", async () => {
    const OWNER = await authed("demo.owner");
    const client = await api();
    const prisma = await getPrisma();
    const saved = await client.put("/api/payments/settings").set(OWNER.auth).send({
      provider: "FIXTURE",
      enabled: true,
      keyId: "fixture_key",
      keySecret: "fixture-key-secret",
      webhookSecret: "fixture-webhook-secret",
      bankLedgerCode: "BANK-001",
      feeLedgerCode: "PG-FEE-001",
      expiryHours: 72,
    });
    expect(saved.status).toBe(200);
    const path = saved.body.data.webhookPath as string;
    const { createSalesInvoice } = await import("../factories");
    const customer = await createCustomer({ stateCode: "27" });
    const invoice = await createSalesInvoice({ customerId: customer.id, grandTotal: "2000" });
    const link = await client
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ salesInvoiceId: invoice.id, amount: 2000 });
    expect(link.status).toBe(201);
    const prepared = await client
      .post(`/api/payments/links/${link.body.data.id}/simulate`)
      .set(OWNER.auth)
      .send({});
    const { body, signature } = prepared.body.data as { body: string; signature: string };
    const deliver = async () =>
      (await api())
        .post(path)
        .set("Content-Type", "application/json")
        .set("x-payment-signature", signature)
        .send(body);

    const { paymentsService } = await import("../../src/modules/payments/payments.service");
    const real = paymentsService.applyPayment.bind(paymentsService);
    const spy = vi
      .spyOn(paymentsService, "applyPayment")
      .mockRejectedValueOnce(new Error("books are momentarily unavailable"));
    const first = await deliver();
    expect(first.status).toBeGreaterThanOrEqual(500);
    const failed = await asDemoTenant(() =>
      prisma.paymentWebhookEvent.findFirstOrThrow({ where: { status: "FAILED" } })
    );
    expect(failed.status).toBe("FAILED");

    spy.mockImplementation(real);
    const retry = await deliver();
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.data.status).toBe("PROCESSED");
    const again = await deliver();
    expect(again.body.data.status).toBe("DUPLICATE");
    spy.mockRestore();

    expect(await asDemoTenant(() => prisma.paymentCapture.count({ where: { amount: 2000 } }))).toBe(
      1
    );
    const link2 = await client.get(`/api/payments/links/${link.body.data.id}`).set(OWNER.auth);
    expect(n(link2.body.data.amountPaid)).toBe(2000);
  });
});
