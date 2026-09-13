import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier } from "../factories";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";
import { periodService } from "../../src/modules/accounts/period.service";

/**
 * GRN / supplier invoice receipt (P1-08b GST, P1-09 books) — characterisation only
 * (Phase 2-T, docs/handoff/2026-09-13-commission-phase-2-transition.md §4).
 *
 * Read off `grn-invoice.service.ts` and `voucherPosting.service.ts` as they stand today:
 *  - the tax split, the purchase voucher (PURCH-001 + *-REC-001 ITC ledgers vs. the supplier
 *    ledger) and any payment vouchers are all posted synchronously inside the create call;
 *  - a cancel reverses those vouchers (`cancellationService`) and, only when `updateStock` was
 *    on, reverses the stock it received — the GRN row itself is never deleted, just marked
 *    CANCELLED (P1-09).
 *
 * ODDITY (not fixed here): `grn-invoice.routes.ts` guards every route with `requireFeature("purchase")`
 * only — it never calls `requirePermission`, unlike its sibling `purchase-order.routes.ts`. The
 * "invoice.*" permission keys are registered (`packages/shared/src/permissions.ts`) and AUDITOR is
 * deliberately given only `invoice.view` (`provisioning.service.ts`, "the statutory auditor reads
 * everything ... and changes nothing"), but nothing in this module enforces that — an auditor can
 * create and cancel GRNs over the API today. See the last test.
 */
const sfx = Date.now().toString(36).slice(-6);
const today = () => new Date().toISOString().slice(0, 10);
const n = (v: unknown) => Number(v);

let OWNER: { auth: Record<string, string> };
let supplier: Awaited<ReturnType<typeof createSupplier>>;
let rawMaterial: Awaited<ReturnType<typeof createRawMaterial>>;

const basePayload = (overrides: Record<string, unknown> = {}) => ({
  invoiceNo: `INV-${sfx}-${Math.random().toString(36).slice(2, 8)}`,
  grnDate: today(),
  supplierId: supplier.id,
  storeId: "ST-RM",
  billingAddressLine1: "Plot 1, Demo Industrial Estate",
  billingCity: "Chennai",
  billingState: "Tamil Nadu",
  billingPincode: "600001",
  shippingAddressLine1: "Plot 1, Demo Industrial Estate",
  shippingCity: "Chennai",
  shippingState: "Tamil Nadu",
  shippingPincode: "600001",
  items: [
    {
      productId: rawMaterial.rawMaterialId,
      description: rawMaterial.materialName,
      uom: "KG",
      quantity: 10,
      unitPrice: 100,
      tax: 18,
    },
  ],
  ...overrides,
});

/** Debit/credit ledger codes on the one voucher posted against a ref document. */
const voucherLines = async (
  refDocType: string,
  refDocId: string,
  status: "POSTED" | "CANCELLED" = "POSTED"
) => {
  const prisma = await getPrisma();
  const voucher = await asDemoTenant(() =>
    prisma.voucher.findFirstOrThrow({
      where: { refDocType, refDocId, status },
      include: { items: { include: { debitLedger: true, creditLedger: true } } },
    })
  );
  const debits: Record<string, number> = {};
  const credits: Record<string, number> = {};
  for (const item of voucher.items) {
    if (item.debitLedger) debits[item.debitLedger.code] = n(item.debitAmount);
    if (item.creditLedger) credits[item.creditLedger.code] = n(item.creditAmount);
  }
  return { voucher, debits, credits };
};

describe("GRN / invoice receipt", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    // Registered and in the same state (33) as the demo company's head office, so the split
    // lands on CGST/SGST rather than IGST.
    supplier = await createSupplier({ gstin: "33AAAAA0000A1Z1", gstRegType: "REGULAR" });
    rawMaterial = await createRawMaterial({ baseUom: "KG", onHandQty: 0 });
  });

  it("receives goods against a supplier, splits GST and posts purchase + payment vouchers", async () => {
    const client = await api();
    const res = await client
      .post("/api/grn-invoices")
      .set(OWNER.auth)
      .send(
        basePayload({
          updateStock: true,
          payments: [{ amount: 700, paymentMethod: "Cash", paymentDate: today() }],
        })
      );
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(201);
    const grn = res.body.data;

    expect(grn.grnNumber).toMatch(/^GRN\//);
    expect(grn.supplyType).toBe("INTRA_STATE");
    expect(grn.reverseCharge).toBe(false);
    // 10kg at ₹100: ₹1,000 taxable, 18% split evenly into CGST/SGST since it is intra-state.
    expect(n(grn.subtotal)).toBe(1000);
    expect(n(grn.totalCgst)).toBe(90);
    expect(n(grn.totalSgst)).toBe(90);
    expect(n(grn.totalIgst)).toBe(0);
    expect(n(grn.netAmount)).toBe(1180);
    // 700 of 1,180 paid: the service's own word for that is "Partial", not e.g. "PARTIAL" or "Paid".
    expect(grn.paymentStatus).toBe("Partial");

    const item = grn.items[0];
    expect(n(item.taxableAmount)).toBe(1000);
    expect(n(item.cgstAmount)).toBe(90);
    expect(n(item.sgstAmount)).toBe(90);

    // updateStock is opt-in (defaults to false); here it was on, so the receipt landed on-hand.
    const prisma = await getPrisma();
    const material = await asDemoTenant(() =>
      prisma.rawMaterial.findUniqueOrThrow({ where: { id: rawMaterial.id } })
    );
    expect(n(material.onHandQty)).toBe(10);

    // Purchase voucher: the base (excl. GST) goes to PURCH-001, the GST to the *-REC-001 input
    // credit ledgers, and the supplier is credited the full GST-inclusive net amount.
    const purchase = await voucherLines("GRN_INVOICE", grn.id);
    expect(purchase.debits).toMatchObject({
      "PURCH-001": 1000,
      "CGST-REC-001": 90,
      "SGST-REC-001": 90,
    });
    const supplierLedger = await asDemoTenant(() =>
      prisma.accountLedger.findFirstOrThrow({ where: { supplierId: supplier.id } })
    );
    expect(purchase.credits).toMatchObject({ [supplierLedger.code]: 1180 });

    // Payment voucher, keyed by the payment's own id (set on the GRN when it was created):
    // the supplier's liability comes down, cash goes out.
    const payment = await voucherLines("GRN_PAYMENT", grn.payments[0].id);
    expect(payment.debits).toMatchObject({ [supplierLedger.code]: 700 });
    expect(payment.credits).toMatchObject({ "CASH-001": 700 });
  });

  it("rejects an empty item list, an unknown supplier, an unknown store, and a closed posting period", async () => {
    const client = await api();

    const noItems = await client
      .post("/api/grn-invoices")
      .set(OWNER.auth)
      .send(basePayload({ items: [] }));
    expect(noItems.status).toBe(400);
    expect(JSON.stringify(noItems.body.errors)).toMatch(/At least one item/);

    const badSupplier = await client
      .post("/api/grn-invoices")
      .set(OWNER.auth)
      .send(basePayload({ supplierId: 999999999 }));
    expect(badSupplier.status).toBe(404);
    expect(badSupplier.body.message).toBe("Supplier not found");

    const badStore = await client
      .post("/api/grn-invoices")
      .set(OWNER.auth)
      .send(basePayload({ storeId: `NOPE-${sfx}` }));
    expect(badStore.status).toBe(404);
    expect(badStore.body.message).toBe("Store not found");

    // periodService.assertPostingAllowed() is wired straight into create(), right after the
    // supplier/store lookups and ahead of any GST or ledger work (P1-09).
    await asDemoTenant(async () => {
      const period = await periodService.createPeriod({
        periodName: `GRN char. test closed period ${sfx}`,
        startDate: "1999-06-01",
        endDate: "1999-06-30",
      });
      await periodService.closePeriod(period.id);
    });
    const closed = await client
      .post("/api/grn-invoices")
      .set(OWNER.auth)
      .send(basePayload({ grnDate: "1999-06-15" }));
    expect(closed.status).toBe(403);
    expect(closed.body.code).toBe("PERIOD_CLOSED");
  });

  it("cancels a GRN by reversing its voucher and its stock, never deleting the row", async () => {
    const client = await api();
    const prisma = await getPrisma();

    const created = (
      await client
        .post("/api/grn-invoices")
        .set(OWNER.auth)
        .send(basePayload({ updateStock: true }))
    ).body.data;
    expect(created.grnNumber).toMatch(/^GRN\//);

    const before = await asDemoTenant(() =>
      prisma.rawMaterial.findUniqueOrThrow({ where: { id: rawMaterial.id } })
    );

    const cancel = await client
      .post(`/api/grn-invoices/${created.id}/cancel`)
      .set(OWNER.auth)
      .send({ reason: "Wrong receipt" });
    expect(cancel.status, JSON.stringify(cancel.body).slice(0, 300)).toBe(200);

    // The row stays on file, only its status changes (P1-09): never a hard delete.
    const grn = await asDemoTenant(() =>
      prisma.grnInvoice.findUniqueOrThrow({ where: { id: created.id } })
    );
    expect(grn.status).toBe("CANCELLED");
    expect(grn.cancelReason).toBe("Wrong receipt");
    expect(grn.cancelledAt).not.toBeNull();

    // The 10kg received on the way in comes back out on cancellation.
    const after = await asDemoTenant(() =>
      prisma.rawMaterial.findUniqueOrThrow({ where: { id: rawMaterial.id } })
    );
    expect(n(after.onHandQty)).toBe(n(before.onHandQty) - 10);

    const purchase = await voucherLines("GRN_INVOICE", created.id, "CANCELLED");
    expect(purchase.voucher.status).toBe("CANCELLED");
    const reversal = await asDemoTenant(() =>
      prisma.voucher.findFirstOrThrow({
        where: { refDocType: "REVERSAL", refDocId: String(purchase.voucher.id) },
      })
    );
    expect(reversal.type).toBe("JOURNAL");

    const again = await client
      .post(`/api/grn-invoices/${created.id}/cancel`)
      .set(OWNER.auth)
      .send({ reason: "second try" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_CANCELLED");
  });

  it("does not gate by permission (no requirePermission on this router) and hides another tenant's GRNs", async () => {
    const client = await api();
    const auditor = await authed("demo.auditor");

    // ODDITY, characterised as found rather than fixed: AUDITOR holds only "invoice.view" in the
    // permission registry (by design — see the module docstring above), yet this router never
    // calls requirePermission, so an auditor can create *and* cancel a GRN today.
    const created = await client.post("/api/grn-invoices").set(auditor.auth).send(basePayload());
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    const cancelled = await client
      .post(`/api/grn-invoices/${created.body.data.id}/cancel`)
      .set(auditor.auth)
      .send({ reason: "cleanup by auditor" });
    expect(cancelled.status).toBe(200);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "GRN Invoice Tenant B", companyCode: `GRNB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.grnInvoice.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.grnInvoice.count())).toBeGreaterThan(0);
  });
});
