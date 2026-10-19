import { describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createCustomer, createProduct, demoCompany } from "../factories";

/** B2C default: no state information -> local supply; a state that cannot be resolved -> refused. */
describe("sales invoice place of supply without a resolvable state", () => {
  const post = async (customerId: string) => {
    const owner = await authed("demo.owner");
    const prisma = await getPrisma();
    const hsn = await asDemoTenant(() =>
      prisma.hsnCode.findFirstOrThrow({ where: { code: "3923" } })
    );
    // A taxable line needs an HSN and rate on its master (a sale refuses one without).
    const product = await createProduct({ gstRate: 18, hsnCodeId: hsn.id });
    return (await api())
      .post("/api/sales-invoices")
      .set(owner.auth)
      .send({
        invoiceDate: "2026-09-07",
        customerId,
        items: [{ productId: product.id.toString(), qty: 1, rate: 100 }],
      });
  };

  it("treats a customer with no state information as intra-state", async () => {
    const customer = await createCustomer({
      gstRegType: "UNREGISTERED",
      stateCode: null,
      gstin: null,
    });
    const res = await post(customer.id);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.supplyType).toBe("INTRA_STATE");
    const item = res.body.data.items[0];
    expect(Number(item.igstAmount)).toBe(0);
  });

  it("refuses a misspelled address state with no GSTIN or state code", async () => {
    const customer = await createCustomer({
      gstRegType: "UNREGISTERED",
      stateCode: null,
      gstin: null,
    });
    await asDemoTenant(async () => {
      const prisma = await getPrisma();
      const company = await demoCompany();
      await prisma.customerAddress.create({
        data: {
          companyId: company.id,
          customerId: customer.id,
          label: "Billing",
          is_default: true,
          state_code: "",
          address: { state: "Maharashtr" },
        },
      });
    });
    const res = await post(customer.id);
    expect(res.status).toBe(400);
    expect(res.body.message ?? res.body.error ?? "").toMatch(/Place of supply/);
  });
});
