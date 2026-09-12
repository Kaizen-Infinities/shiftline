import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createSalesInvoice } from "../factories";

/**
 * Payment links, callbacks and what a capture does to the books (P1-21).
 *
 * The gateway here is the fixture, but the path is the live one: the same signature check, the
 * same event log, the same posting. What is proved is that money arriving through a webhook ends
 * up in the ledger exactly once, at the gross, with the gateway's cut taken out separately.
 */
const KEY_SECRET = "fixture-key-secret";
const WEBHOOK_SECRET = "fixture-webhook-secret";

let OWNER: { auth: Record<string, string> };
let WEBHOOK_PATH: string;
let INVOICE: { id: string; invoiceNo: string };

const ledgerBalance = async (code: string) => {
  const prisma = await getPrisma();
  return asDemoTenant(async () => {
    const ledger = await prisma.accountLedger.findFirstOrThrow({ where: { code } });
    const items = await prisma.journalItem.findMany({
      where: {
        OR: [{ debitLedgerId: ledger.id }, { creditLedgerId: ledger.id }],
        voucher: { status: "POSTED" },
      },
      select: { debitLedgerId: true, creditLedgerId: true, debitAmount: true, creditAmount: true },
    });
    return items.reduce(
      (s, i) =>
        s +
        (i.debitLedgerId === ledger.id ? Number(i.debitAmount) : 0) -
        (i.creditLedgerId === ledger.id ? Number(i.creditAmount) : 0),
      0
    );
  });
};

/** Post a signed callback the way the gateway would. */
const callback = async (body: string, signature: string, path = WEBHOOK_PATH) =>
  (await api())
    .post(path)
    .set("Content-Type", "application/json")
    .set("x-payment-signature", signature)
    .send(body);

describe("payment links and the gateway", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    const saved = await (await api()).put("/api/payments/settings").set(OWNER.auth).send({
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

    const customer = await createCustomer({ stateCode: "27" });
    const invoice = await createSalesInvoice({ customerId: customer.id, grandTotal: "10000" });
    INVOICE = { id: invoice.id, invoiceNo: invoice.invoiceNo };
  });

  it("keeps the secrets and hands out a callback path that names no tenant", async () => {
    const res = await (await api()).get("/api/payments/settings").set(OWNER.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.hasKeySecret).toBe(true);
    expect(res.body.data.hasWebhookSecret).toBe(true);
    // Nothing anywhere in the response is the secret itself.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(KEY_SECRET);
    expect(body).not.toContain(WEBHOOK_SECRET);
    const company = await asDemoTenant(async () => (await getPrisma()).company.findFirst());
    expect(res.body.data.webhookPath).not.toContain(String(company?.id));

    // And the secret is not sitting in the database in the clear either.
    const prisma = await getPrisma();
    const row = await asDemoTenant(() => prisma.paymentGatewayConfig.findFirstOrThrow());
    expect(row.keySecret).not.toBe(KEY_SECRET);
    expect(row.keySecret?.startsWith("enc:v1:")).toBe(true);
  });

  it("refuses to turn the gateway on without the credentials it needs", async () => {
    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const { paymentsConfigService } =
      await import("../../src/modules/payments/payments.config.service");
    const fresh = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyName: "Gateway Tenant",
          companyCode: `PGC-${Date.now().toString(36).slice(-5)}`,
        },
      })
    );
    await expect(
      runAsTenant(fresh.id, () =>
        paymentsConfigService.update(
          {
            provider: "FIXTURE",
            enabled: true,
            keyId: "fixture_key",
            bankLedgerCode: "BANK-001",
            feeLedgerCode: "PG-FEE-001",
            expiryHours: 72,
          },
          {}
        )
      )
    ).rejects.toThrow(/key secret/i);
  });

  it("will not raise a link for more than the invoice still owes", async () => {
    const res = await (
      await api()
    )
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ salesInvoiceId: INVOICE.id, amount: 25000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OVER_BALANCE");
  });

  it("posts a capture once, at the gross, with the gateway's cut taken out separately", async () => {
    const client = await api();
    const created = await client
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ salesInvoiceId: INVOICE.id, amount: 4000, description: "Part payment" });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const linkId = created.body.data.id as string;
    expect(created.body.data.status).toBe("CREATED");
    expect(created.body.data.shortUrl).toMatch(/^https:\/\//);

    const prepared = await client
      .post(`/api/payments/links/${linkId}/simulate`)
      .set(OWNER.auth)
      .send({});
    expect(prepared.status, JSON.stringify(prepared.body).slice(0, 300)).toBe(200);
    const { body, signature, payment } = prepared.body.data as {
      body: string;
      signature: string;
      payment: { amount: number; fee: number; feeTax: number };
    };

    const bankBefore = await ledgerBalance("BANK-001");
    const feeBefore = await ledgerBalance("PG-FEE-001");

    const delivered = await callback(body, signature);
    expect(delivered.status, JSON.stringify(delivered.body).slice(0, 300)).toBe(200);
    expect(delivered.body.data.status).toBe("PROCESSED");

    // The gateway redelivers; the books must not move a second time.
    const again = await callback(body, signature);
    expect(again.body.data.status).toBe("DUPLICATE");

    const link = await client.get(`/api/payments/links/${linkId}`).set(OWNER.auth);
    // The link is for 4,000 and 4,000 arrived, so the link is done; the invoice is not.
    expect(link.body.data.status).toBe("PAID");
    expect(Number(link.body.data.amountPaid)).toBe(4000);
    expect(link.body.data.captures).toHaveLength(1);

    const feeTotal = Math.round((payment.fee + payment.feeTax) * 100) / 100;
    // The customer paid 4,000 and the bank received 4,000 less what the gateway kept.
    expect(Math.round(((await ledgerBalance("BANK-001")) - bankBefore) * 100) / 100).toBe(
      Math.round((4000 - feeTotal) * 100) / 100
    );
    expect(Math.round(((await ledgerBalance("PG-FEE-001")) - feeBefore) * 100) / 100).toBe(
      feeTotal
    );
  });

  it("refuses a callback that is not signed with the webhook secret, and writes it down", async () => {
    const client = await api();
    const created = await client
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ salesInvoiceId: INVOICE.id, amount: 1000 });
    const prepared = await client
      .post(`/api/payments/links/${created.body.data.id}/simulate`)
      .set(OWNER.auth)
      .send({});
    const { body } = prepared.body.data as { body: string };

    const forged = await callback(body, "deadbeef");
    expect(forged.status).toBe(401);
    expect(forged.body.code).toBe("BAD_CALLBACK");

    const prisma = await getPrisma();
    const failed = await asDemoTenant(() =>
      prisma.paymentWebhookEvent.findFirst({
        where: { signatureValid: false },
        orderBy: { receivedAt: "desc" },
      })
    );
    expect(failed?.status).toBe("FAILED");
    // Nothing was posted for it.
    expect(await asDemoTenant(() => prisma.paymentCapture.count({ where: { amount: 1000 } }))).toBe(
      0
    );
  });

  it("marks the invoice paid only when the whole of it is, and refuses to cancel a paid link", async () => {
    const client = await api();
    const created = await client
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ salesInvoiceId: INVOICE.id });
    expect(created.status).toBe(201);
    // 10,000 less the 4,000 already captured and the 1,000 still out on an open link.
    expect(Number(created.body.data.amount)).toBe(5000);

    const prepared = await client
      .post(`/api/payments/links/${created.body.data.id}/simulate`)
      .set(OWNER.auth)
      .send({});
    const { body, signature } = prepared.body.data as { body: string; signature: string };
    expect((await callback(body, signature)).body.data.status).toBe("PROCESSED");

    const link = await client.get(`/api/payments/links/${created.body.data.id}`).set(OWNER.auth);
    expect(link.body.data.status).toBe("PAID");

    const cancelled = await client
      .post(`/api/payments/links/${created.body.data.id}/cancel`)
      .set(OWNER.auth)
      .send({ reason: "Changed their mind" });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.code).toBe("ALREADY_PAID");

    // 9,000 of 10,000 collected, so the invoice is not paid off yet.
    const prisma = await getPrisma();
    const invoice = await asDemoTenant(() =>
      prisma.salesInvoice.findUniqueOrThrow({ where: { id: INVOICE.id } })
    );
    expect(invoice.status).not.toBe("PAID");
  });

  it("cancels a link nobody has paid", async () => {
    const client = await api();
    const created = await client
      .post("/api/payments/links")
      .set(OWNER.auth)
      .send({ amount: 500, description: "Bare amount" });
    expect(created.status).toBe(201);
    const cancelled = await client
      .post(`/api/payments/links/${created.body.data.id}/cancel`)
      .set(OWNER.auth)
      .send({ reason: "Raised twice" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
  });

  it("refuses a user without the permission and hides another tenant's links", async () => {
    const client = await api();
    const production = await authed("demo.production");
    expect((await client.get("/api/payments/links").set(production.auth)).status).toBe(403);
    expect((await client.get("/api/payments/settings").set(production.auth)).status).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: {
          companyName: "Payments Tenant B",
          companyCode: `PGB-${Date.now().toString(36).slice(-5)}`,
        },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.paymentLink.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.paymentLink.count())).toBeGreaterThan(0);
  });

  it("refuses an unknown callback token the same way it refuses a bad signature", async () => {
    const res = await callback("{}", "deadbeef", `/api/payments/webhook/${"0".repeat(48)}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("BAD_CALLBACK");
  });
});
