import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createRawMaterial,
  createSupplier,
  demoCompany,
} from "../factories";
import { voucherPostingService } from "../../src/modules/accounts/voucherPosting.service";
import { accountsService } from "../../src/modules/accounts/accounts.service";

/**
 * Banking and FX settlement (P2-06).
 *
 * A cheque from a receipt or payment, its re-presentation after a bounce, the realised gain or
 * loss on the day a foreign-currency document is actually settled, and a purchase bill's own
 * currency feeding the same exposure and restatement a sales invoice already had.
 */
const sfx = Date.now().toString(36).slice(-5);
// A payment's own date cannot be in the future (validated on the way in), so this suite runs on
// a fixed date safely in the past — a PDC's post-dated-ness is judged against its own payment
// date, never the system clock, so nothing here depends on how close that date is to today.
const FY = "2026";

const ADDRESS = {
  billingAddressLine1: "1 Demo Road",
  billingCity: "Chennai",
  billingState: "Tamil Nadu",
  billingPincode: "600001",
  shippingAddressLine1: "1 Demo Road",
  shippingCity: "Chennai",
  shippingState: "Tamil Nadu",
  shippingPincode: "600001",
};

let OWNER: { auth: Record<string, string> };
let PRODUCTION: { auth: Record<string, string> };

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

const makeGrn = async (
  supplierId: number,
  items: Record<string, unknown>[],
  over: Record<string, unknown> = {}
) => {
  const res = await (
    await api()
  )
    .post("/api/grn-invoices")
    .set(OWNER.auth)
    .send({
      ...ADDRESS,
      invoiceNo: `P206-${sfx}-${Math.random().toString(36).slice(-6)}`,
      grnDate: `${FY}-06-01`,
      receiveDate: `${FY}-06-01`,
      supplierId,
      storeId: "ST-RM",
      updateStock: false,
      items,
      ...over,
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
  return res.body.data as {
    id: string;
    netAmount: string;
    paymentStatus: string;
    currencyCode: string;
    foreignTotal: string | null;
  };
};

describe("banking and FX settlement", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    PRODUCTION = await authed("demo.production");
  });

  it("creates the cheque register row in the same transaction as an immediate cheque payment", async () => {
    const supplier = await createSupplier();
    const material = await createRawMaterial();
    const bill = await makeGrn(
      supplier.id,
      [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 1,
          unitPrice: 10000,
          tax: 0,
        },
      ],
      {
        payments: [
          {
            id: `p206a-${sfx}`,
            amount: 10000,
            paymentMethod: "Cheque",
            paymentDate: `${FY}-06-01`,
            instrumentType: "CHEQUE",
            chequeNo: `CHQ-${sfx}-A`,
            chequeDate: `${FY}-06-01`,
            chequeBank: "HDFC Bank",
          },
        ],
      }
    );
    expect(bill.paymentStatus).toBe("Closed");

    const prisma = await getPrisma();
    const cheque = await asDemoTenant(() =>
      prisma.cheque.findFirst({ where: { chequeNo: `CHQ-${sfx}-A` } })
    );
    expect(cheque).not.toBeNull();
    expect(cheque!.kind).toBe("ISSUED");
    expect(cheque!.status).toBe("IN_HAND");
    expect(cheque!.voucherId).not.toBeNull();
    expect(cheque!.refDocType).toBe("GRN_PAYMENT");

    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUnique({ where: { id: cheque!.voucherId! } })
    );
    expect(voucher?.status).toBe("POSTED");
  });

  it("a post-dated cheque posts no voucher until it clears", async () => {
    const supplier = await createSupplier();
    const material = await createRawMaterial();
    const bill = await makeGrn(
      supplier.id,
      [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 1,
          unitPrice: 8000,
          tax: 0,
        },
      ],
      {
        payments: [
          {
            id: `p206b-${sfx}`,
            amount: 8000,
            paymentMethod: "Cheque",
            paymentDate: `${FY}-06-01`,
            instrumentType: "CHEQUE",
            chequeNo: `CHQ-${sfx}-B`,
            // Post-dated: written for a month after it was recorded.
            chequeDate: `${FY}-07-01`,
            chequeBank: "ICICI Bank",
          },
        ],
      }
    );
    const prisma = await getPrisma();
    let cheque = await asDemoTenant(() =>
      prisma.cheque.findFirstOrThrow({ where: { chequeNo: `CHQ-${sfx}-B` } })
    );
    expect(cheque.status).toBe("IN_HAND");
    expect(cheque.voucherId).toBeNull();
    // No voucher for this payment exists yet — the PDC has not cleared.
    const notYetPosted = await asDemoTenant(() =>
      prisma.voucher.count({ where: { refDocType: "GRN_PAYMENT", refDocId: `p206b-${sfx}` } })
    );
    expect(notYetPosted).toBe(0);

    // Marking it CLEARED is what actually posts the payment now.
    const cleared = await (
      await api()
    )
      .post(`/api/banking/cheques/${cheque.id}/status`)
      .set(OWNER.auth)
      .send({ status: "CLEARED", on: `${FY}-07-02` });
    expect(cleared.status, JSON.stringify(cleared.body).slice(0, 300)).toBe(200);
    expect(cleared.body.data.status).toBe("CLEARED");
    expect(cleared.body.data.voucherId).not.toBeNull();

    cheque = await asDemoTenant(() => prisma.cheque.findFirstOrThrow({ where: { id: cheque.id } }));
    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUnique({ where: { id: cheque.voucherId! } })
    );
    expect(voucher?.status).toBe("POSTED");
    expect(voucher?.refDocType).toBe("GRN_PAYMENT");

    // Clearing it again does nothing new — it is already closed.
    const again = await (
      await api()
    )
      .post(`/api/banking/cheques/${cheque.id}/status`)
      .set(OWNER.auth)
      .send({ status: "CLEARED" });
    expect(again.status).toBe(409);
  });

  it("bounce then re-present posts the receipt again exactly once, and the ledger nets back", async () => {
    const client = await api();
    const customer = await createCustomer();
    // Bouncing (P1-20) posts against the generic Sundry Debtors ledger, not the customer's own —
    // re-presenting has to reverse exactly that, on the same ledger.
    const before = await ledgerBalance("DEBT-001");

    const cheque = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({
        kind: "RECEIVED",
        chequeNo: `CHQ-${sfx}-C`,
        chequeDate: `${FY}-08-01`,
        amount: 15000,
        partyName: customer.firmName,
        customerId: customer.id,
      });
    expect(cheque.status).toBe(201);

    await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "DEPOSITED", on: `${FY}-08-02` });

    const bounced = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "BOUNCED", on: `${FY}-08-05`, bounceCharges: 250 });
    expect(bounced.status).toBe(200);
    expect(bounced.body.data.status).toBe("BOUNCED");

    // Direct clear of a bounced cheque is refused.
    const directClear = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "CLEARED" });
    expect(directClear.status).toBe(409);
    expect(directClear.body.code).toBe("CHEQUE_BOUNCED");

    const rePresented = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/re-present`)
      .set(OWNER.auth)
      .send({});
    expect(rePresented.status, JSON.stringify(rePresented.body).slice(0, 300)).toBe(200);
    expect(rePresented.body.data.status).toBe("DEPOSITED");
    expect(rePresented.body.data.voucherId).not.toBeNull();

    // Re-presenting again is refused: it is no longer BOUNCED.
    const twice = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/re-present`)
      .set(OWNER.auth)
      .send({});
    expect(twice.status).toBe(409);

    // The bounce put the customer back in debt for the cheque; the re-presentation takes it back
    // out. Net effect on the party ledger: as if the cheque had never bounced at all.
    const after = await ledgerBalance("DEBT-001");
    expect(Math.round(after - before)).toBe(0);

    const prisma = await getPrisma();
    const represented = await asDemoTenant(() =>
      prisma.voucher.count({ where: { refDocType: "CHEQUE_REPRESENT" } })
    );
    expect(represented).toBeGreaterThanOrEqual(1);
  });

  it("posts the realised gain on a receipt against a USD invoice, and never twice for the same settlement", async () => {
    const client = await api();
    const prisma = await getPrisma();
    const company = await demoCompany();
    const customer = await createCustomer();
    // The currency master seeds itself the first time it is read, and a rate needs it to exist.
    await client.get("/api/currencies").set(OWNER.auth);
    const rateRes = await client
      .post("/api/currencies/rates")
      .set(OWNER.auth)
      .send({ currencyCode: "USD", rateDate: `${FY}-09-01`, rate: 83 });
    expect(rateRes.status, JSON.stringify(rateRes.body).slice(0, 300)).toBe(200);

    // $1,000 raised at 83, settled at 84: a rupee better, a ₹1,000 gain.
    const invoice = await asDemoTenant(() =>
      prisma.salesInvoice.create({
        data: {
          companyId: company.id,
          invoiceNo: `P206-SI-${sfx}`,
          invoiceDate: new Date(`${FY}-09-01T00:00:00Z`),
          customerId: customer.id,
          subTotal: 83000,
          taxTotal: 0,
          grandTotal: 83000,
          status: "CONFIRMED",
          currencyCode: "USD",
          exchangeRate: 83,
          foreignTotal: 1000,
          payments: [],
        },
      })
    );

    const gainBefore = await ledgerBalance("FX-GAIN-001");

    await asDemoTenant(() =>
      prisma.salesInvoice.update({
        where: { id: invoice.id },
        data: {
          payments: [
            {
              id: `p206-pay-${sfx}`,
              amount: 84000,
              paymentMethod: "Bank Transfer",
              paymentDate: `${FY}-09-05`,
              settlementRate: 84,
            },
          ] as any,
        },
      })
    );

    const posted = await asDemoTenant(() =>
      voucherPostingService.postReceiptVouchersForSales(invoice.id)
    );
    expect(posted).toHaveLength(1);

    // FX-GAIN-001 is credit-normal, so a gain moves the debit-minus-credit balance down, not up
    // (see fx.spec.ts's own ledgerBalance convention).
    const gainAfter = await ledgerBalance("FX-GAIN-001");
    expect(Math.round(gainBefore - gainAfter)).toBe(1000);

    const fxVouchers = await asDemoTenant(() =>
      prisma.voucher.count({ where: { refDocType: "FX_REALISED", refDocId: `p206-pay-${sfx}` } })
    );
    expect(fxVouchers).toBe(1);

    // Recording the same payment again (an edit that resends the same array) never posts twice.
    await asDemoTenant(() => voucherPostingService.postReceiptVouchersForSales(invoice.id));
    const gainStill = await ledgerBalance("FX-GAIN-001");
    expect(Math.round(gainBefore - gainStill)).toBe(1000);
  });

  it("a USD purchase bill appears in the exposure and restates one line per party at the same total", async () => {
    const client = await api();
    const supplier = await createSupplier();
    const material = await createRawMaterial();

    await client
      .post("/api/currencies/rates")
      .set(OWNER.auth)
      .send({ currencyCode: "USD", rateDate: `${FY}-10-01`, rate: 83 });

    const bill = await makeGrn(
      supplier.id,
      [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 1,
          unitPrice: 100,
          tax: 0,
        },
      ],
      { currencyCode: "USD", exchangeRate: 83, grnDate: `${FY}-10-01`, receiveDate: `${FY}-10-01` }
    );
    expect(bill.currencyCode).toBe("USD");
    expect(Number(bill.foreignTotal)).toBeCloseTo(100, 2);

    const exposure = await client
      .get("/api/fx/exposure")
      .query({ asOn: `${FY}-10-15` })
      .set(OWNER.auth);
    expect(exposure.status).toBe(200);
    const line = exposure.body.data.find((l: { documentId: string }) => l.documentId === bill.id);
    expect(line).toBeTruthy();
    expect(line.documentType).toBe("GRN_INVOICE");
    expect(line.currencyCode).toBe("USD");

    // Restate at a stronger rupee: the total across every party line is unchanged either way —
    // the shape moved from one net line to one line per party, not the number.
    await client
      .post("/api/currencies/rates")
      .set(OWNER.auth)
      .send({ currencyCode: "USD", rateDate: `${FY}-10-31`, rate: 82 });

    const preview = await client.get(`/api/fx/revaluations/preview/${FY}-10`).set(OWNER.auth);
    expect(preview.status).toBe(200);
    const total = preview.body.data.netAmount;

    const revalued = await client.post(`/api/fx/revaluations/${FY}-10`).set(OWNER.auth).send({});
    expect(revalued.status, JSON.stringify(revalued.body).slice(0, 300)).toBe(200);

    const prisma = await getPrisma();
    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({
        where: { id: revalued.body.data.voucherId },
        include: { items: true },
      })
    );
    // Every line lands on a real party ledger or the gain/loss ledger, never a net Sundry line.
    const supplierLedgerCode = await asDemoTenant(async () => {
      const ledger = await accountsService.ensureSupplierLedger(supplier);
      return ledger.code;
    });
    const supplierLedgerId = await asDemoTenant(async () => {
      const prismaClient = await getPrisma();
      const l = await prismaClient.accountLedger.findFirstOrThrow({
        where: { code: supplierLedgerCode },
      });
      return l.id;
    });
    const touchesSupplier = voucher.items.some(
      (i) => i.debitLedgerId === supplierLedgerId || i.creditLedgerId === supplierLedgerId
    );
    expect(touchesSupplier).toBe(true);

    const net = voucher.items.reduce(
      (s, i) => s + Number(i.debitAmount) - Number(i.creditAmount),
      0
    );
    expect(Math.round(net)).toBe(0);
    expect(Math.abs(Number(revalued.body.data.netAmount) - Number(total))).toBeLessThan(0.01);
  });

  it("refuses re-presentation without the permission and hides another tenant's cheques", async () => {
    const client = await api();
    const cheque = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({
        kind: "RECEIVED",
        chequeNo: `CHQ-${sfx}-D`,
        chequeDate: `${FY}-11-01`,
        amount: 5000,
      });
    expect(cheque.status).toBe(201);

    const refused = await client
      .post(`/api/banking/cheques/${cheque.body.data.id}/re-present`)
      .set(PRODUCTION.auth)
      .send({});
    expect(refused.status).toBe(403);

    const prisma = await getPrisma();
    const { runAsTenant, withoutTenant } = await import("../../src/lib/tenant-context");
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "Banking FX Tenant B", companyCode: `BFXB-${sfx}` },
      })
    );
    expect(await runAsTenant(other.id, () => prisma.cheque.count())).toBe(0);
    expect(await asDemoTenant(() => prisma.cheque.count())).toBeGreaterThan(0);
  });
});
