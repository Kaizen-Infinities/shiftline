import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { createCustomer, createProduct, createSupplier } from "../factories";

/**
 * Statements of account (P1-10c): a party's ledger for a period with the ageing of what is
 * unpaid, as JSON; sending needs a channel and a contact.
 */
const today = new Date().toISOString().slice(0, 10);

describe("statements of account", () => {
  it("builds a customer statement from the ledger and the ageing", async () => {
    const owner = await authed("demo.owner");
    const client = await api();
    const product = await createProduct();
    const customer = await createCustomer({
      stateCode: "33",
      creditDays: 15,
      firmName: "Statement Co (Test)",
      email: "statement@example.test",
    });
    const invoice = await client
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: today,
        customerId: customer.id,
        items: [{ productId: product.id.toString(), qty: 2, rate: 500 }],
      });
    expect(invoice.status).toBe(201);

    const res = await client
      .get(`/api/accounts/statements/customer/${customer.id}`)
      .query({ startDate: today, endDate: today })
      .set(owner.auth);
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.party).toMatchObject({
      type: "customer",
      code: customer.customerCode,
      email: "statement@example.test",
    });
    expect(s.company.name).toBeTruthy();
    expect(s.entries.length).toBeGreaterThanOrEqual(1);
    expect(s.closingBalance).toBeGreaterThan(0);
    expect(s.ageing.total).toBeCloseTo(s.closingBalance, 2);
    expect(s.ageing.buckets.notDue).toBeCloseTo(s.closingBalance, 2);
    expect(s.ageing.documents).toHaveLength(1);
    expect(s.ageing.documents[0].number).toBe(invoice.body.data.invoiceNo);

    // Without dates the statement runs up to today.
    const open = await client
      .get(`/api/accounts/statements/customer/${customer.id}`)
      .set(owner.auth);
    expect(open.status).toBe(200);
    expect(open.body.data.startDate).toBeNull();
    expect(open.body.data.endDate).toBe(today);
  });

  it("builds a supplier statement, and refuses unknown parties and bad input", async () => {
    const owner = await authed("demo.owner");
    const supervisor = await authed("demo.production");
    const client = await api();
    const supplier = await createSupplier({ legalName: "Statement Supplies (Test)" });

    const res = await client
      .get(`/api/accounts/statements/supplier/${supplier.id}`)
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.party).toMatchObject({ type: "supplier", code: supplier.supplierCode });
    expect(res.body.data.ageing === null || typeof res.body.data.ageing.total === "number").toBe(
      true
    );

    expect(
      (await client.get("/api/accounts/statements/supplier/999999").set(owner.auth)).status
    ).toBe(404);
    expect(
      (await client.get("/api/accounts/statements/customer/not-a-uuid").set(owner.auth)).status
    ).toBe(404);
    expect(
      (
        await client
          .get(`/api/accounts/statements/supplier/${supplier.id}`)
          .query({ startDate: "2026-09-07", endDate: "2026-09-01" })
          .set(owner.auth)
      ).status
    ).toBe(400);
    expect(
      (await client.get(`/api/accounts/statements/supplier/${supplier.id}`).set(supervisor.auth))
        .status
    ).toBe(403);

    // Sending needs a channel and a contact; nothing leaves before validation passes.
    const send = (body: Record<string, unknown>) =>
      client
        .post(`/api/accounts/statements/supplier/${supplier.id}/send`)
        .set(owner.auth)
        .send(body);
    expect((await send({})).status).toBe(400);
    expect((await send({ channel: "fax" })).status).toBe(400);
    const noEmail = await send({ channel: "email" });
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.message).toMatch(/no email/i);
    expect((await send({ channel: "email", to: "not-an-email" })).status).toBe(400);
    expect((await send({ channel: "whatsapp", to: "12" })).status).toBe(400);
  });
});
