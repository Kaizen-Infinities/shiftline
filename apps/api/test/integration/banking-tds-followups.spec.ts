import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import {
  asDemoTenant,
  createCustomer,
  createProduct,
  createRawMaterial,
  createSupplier,
} from "../factories";
import { bankingService } from "../../src/modules/banking/banking.service";
import { runAsTenant, withoutTenant } from "../../src/lib/tenant-context";

/**
 * Banking, FX and TDS/TCS follow-ups (P2-17).
 *
 * Eight small fixes noted in earlier hand-offs: a payment-ref fallback that could overflow
 * `Voucher.refDocId`; a PDC's FX realising at the wrong date; the cheque-due warning ignoring a
 * bounce; the supplier master missing three TDS fields; a TDS challan silently mis-posting a
 * section with no ledger; 206C(1H)'s threshold counted per customer row instead of per PAN; the
 * scrap TCS default with no item-master flag to key off; and the GRN view's cheque match not
 * distinguishing same-numbered cheques on one bill.
 */
const n = (v: unknown) => Number(v);
const sfx = Date.now().toString(36).slice(-6);
const FY = "2026";

const GRN_ADDRESS = {
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
      ...GRN_ADDRESS,
      invoiceNo: `P217-${sfx}-${Math.random().toString(36).slice(-6)}`,
      grnDate: `${FY}-06-01`,
      receiveDate: `${FY}-06-01`,
      supplierId,
      storeId: "ST-RM",
      updateStock: false,
      items,
      ...over,
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(201);
  return res.body.data as { id: string; paymentStatus: string; payments: any[] };
};

describe("banking, FX and TDS/TCS follow-ups (P2-17)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    PRODUCTION = await authed("demo.production");
    // The standard TDS/TCS sections seed themselves only while the table is still empty — done
    // here, first, so a later test's own hand-inserted section (item 5) can't race it.
    await (await api()).get("/api/tds/sections").set(OWNER.auth);
  });

  // ── 1. deriveStablePaymentRefId always fits 36 characters ─────────────────
  it("keeps a payment's derived refDocId within Voucher.refDocId's 36 characters", async () => {
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
          unitPrice: 4000,
          tax: 0,
        },
      ],
      {
        // No `id` on the payment: exercises the hash fallback, not `p.id`.
        payments: [
          {
            amount: 4000,
            paymentMethod: "Cash",
            paymentDate: `${FY}-06-01`,
          },
        ],
      }
    );
    expect(bill.paymentStatus).toBe("Closed");

    const client = await api();
    const fetched = await client.get(`/api/grn-invoices/${bill.id}`).set(OWNER.auth);
    expect(fetched.status).toBe(200);
    const voucherId = fetched.body.data.payments?.[0]?.sourceVoucherId;
    expect(voucherId).toBeTruthy();

    const prisma = await getPrisma();
    const voucher = await asDemoTenant(() =>
      prisma.voucher.findUniqueOrThrow({ where: { id: Number(voucherId) } })
    );
    expect(voucher.refDocType).toBe("GRN_PAYMENT");
    expect(voucher.refDocId).not.toBeNull();
    expect(voucher.refDocId!.length).toBeLessThanOrEqual(36);
  });

  // ── 2. PDC clearing realises FX at the clearing date, not the recorded date ─
  it("realises FX at the clearing date for a PDC, not the date it was originally recorded", async () => {
    const client = await api();
    const supplier = await createSupplier();
    const material = await createRawMaterial();
    await client.get("/api/currencies").set(OWNER.auth);
    const rate1 = await client
      .post("/api/currencies/rates")
      .set(OWNER.auth)
      .send({ currencyCode: "USD", rateDate: `${FY}-06-01`, rate: 84 });
    expect(rate1.status, JSON.stringify(rate1.body).slice(0, 300)).toBe(200);
    const rate2 = await client
      .post("/api/currencies/rates")
      .set(OWNER.auth)
      .send({ currencyCode: "USD", rateDate: `${FY}-06-10`, rate: 85 });
    expect(rate2.status, JSON.stringify(rate2.body).slice(0, 300)).toBe(200);

    const refId = `pdcfx-${sfx}`;
    await makeGrn(
      supplier.id,
      [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 1,
          unitPrice: 1000,
          tax: 0,
        },
      ],
      {
        currencyCode: "USD",
        exchangeRate: 83,
        grnDate: `${FY}-06-01`,
        receiveDate: `${FY}-06-01`,
        payments: [
          {
            id: refId,
            amount: 84000,
            paymentMethod: "Cheque",
            paymentDate: `${FY}-06-01`,
            instrumentType: "CHEQUE",
            chequeNo: `CHQ-${sfx}-FX`,
            // Post-dated: cleared nine days after it was recorded, at a different rate.
            chequeDate: `${FY}-06-10`,
            chequeBank: "Axis Bank",
          },
        ],
      }
    );

    const prisma = await getPrisma();
    const cheque = await asDemoTenant(() =>
      prisma.cheque.findFirstOrThrow({ where: { chequeNo: `CHQ-${sfx}-FX` } })
    );
    expect(cheque.status).toBe("IN_HAND");
    expect(cheque.voucherId).toBeNull();

    const cleared = await client
      .post(`/api/banking/cheques/${cheque.id}/status`)
      .set(OWNER.auth)
      .send({ status: "CLEARED", on: `${FY}-06-10` });
    expect(cleared.status, JSON.stringify(cleared.body).slice(0, 300)).toBe(200);

    const fxVoucher = await asDemoTenant(() =>
      prisma.voucher.findFirstOrThrow({
        where: { refDocType: "FX_REALISED", refDocId: refId },
        include: { items: true },
      })
    );
    // The voucher itself is dated the clearing day, not the day the payment was recorded —
    // and its narration records both, so which date the rate came from is on file (P2-17).
    expect(fxVoucher.date.toISOString().slice(0, 10)).toBe(`${FY}-06-10`);
    expect(fxVoucher.narration).toContain("cleared 2026-06-10");
    expect(fxVoucher.narration).toContain("recorded 2026-06-01");

    // $1,000 recovered at the clearing rate (85), not the recorded-date rate (84): a bigger gain
    // than the stale-date calculation would have posted.
    const gain = fxVoucher.items.reduce((s, i) => s + Number(i.debitAmount), 0);
    expect(gain).toBeCloseTo(1976.48, 1);
    expect(gain).not.toBeCloseTo(1000, 1);
  });

  // ── 3. cheque-due warning skips a bounce, labels a re-presentation ─────────
  it("skips a bounced-and-not-re-presented cheque, and labels a re-presented one distinctly", async () => {
    const client = await api();
    const dueDate = `${FY}-09-20`;
    const today = new Date(`${FY}-09-19T00:00:00Z`);

    const a = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({ kind: "RECEIVED", chequeNo: `CHQW-${sfx}-A`, chequeDate: dueDate, amount: 4000 });
    expect(a.status).toBe(201);
    await client
      .post(`/api/banking/cheques/${a.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "DEPOSITED", on: `${FY}-09-18` });
    await client
      .post(`/api/banking/cheques/${a.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "BOUNCED", on: `${FY}-09-19` });

    const b = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({ kind: "RECEIVED", chequeNo: `CHQW-${sfx}-B`, chequeDate: dueDate, amount: 4000 });
    expect(b.status).toBe(201);
    await client
      .post(`/api/banking/cheques/${b.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "DEPOSITED", on: `${FY}-09-18` });
    await client
      .post(`/api/banking/cheques/${b.body.data.id}/status`)
      .set(OWNER.auth)
      .send({ status: "BOUNCED", on: `${FY}-09-19` });
    const rep = await client
      .post(`/api/banking/cheques/${b.body.data.id}/re-present`)
      .set(OWNER.auth)
      .send({});
    expect(rep.status, JSON.stringify(rep.body).slice(0, 300)).toBe(200);
    expect(rep.body.data.status).toBe("DEPOSITED");

    const c = await client
      .post("/api/banking/cheques")
      .set(OWNER.auth)
      .send({ kind: "RECEIVED", chequeNo: `CHQW-${sfx}-C`, chequeDate: dueDate, amount: 4000 });
    expect(c.status).toBe(201);

    const result = await asDemoTenant(() => bankingService.warnDueCheques(today));
    // A (bounced, not re-presented) skipped; B (re-presented) and C (ordinary, in hand) warned.
    expect(result.sent).toBe(2);

    const prisma = await getPrisma();
    const notifs = await asDemoTenant(() =>
      prisma.notification.findMany({ where: { category: "banking-cheque" } })
    );
    const forA = notifs.filter((row) => row.link?.includes(`cheque=${a.body.data.id}`));
    const forB = notifs.filter((row) => row.link?.includes(`cheque=${b.body.data.id}`));
    const forC = notifs.filter((row) => row.link?.includes(`cheque=${c.body.data.id}`));
    // notify() fans out one row per recipient with the permission, so "at least one", not
    // exactly one — the point being proved is which cheques got a row at all.
    expect(forA).toHaveLength(0);
    expect(forB.length).toBeGreaterThanOrEqual(1);
    expect(forB[0].title.toLowerCase()).toContain("re-presented");
    expect((forB[0].body ?? "").toLowerCase()).toContain("re-presented");
    expect(forC.length).toBeGreaterThanOrEqual(1);
    expect(forC[0].title.toLowerCase()).not.toContain("re-presented");
  });

  // ── 4. Supplier: defaultTdsSectionCode, higherRate206AB, deducteeType ──────
  it("stores a supplier's TDS defaults and hides them from a foreign tenant", async () => {
    const client = await api();
    const created = await client
      .post("/api/suppliers")
      .set(OWNER.auth)
      .send({
        supplierCode: `TDSF-${sfx}`,
        legalName: "TDS Defaults Supplier (Test)",
        billingAddressLine1: "1 Demo Road",
        billingCity: "Chennai",
        billingState: "Tamil Nadu",
        billingPincode: "600001",
        stateCode: "33",
        defaultTdsSectionCode: "194C",
        deducteeType: "INDIVIDUAL_HUF",
        higherRate206AB: true,
      });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(created.body.data.defaultTdsSectionCode).toBe("194C");
    expect(created.body.data.deducteeType).toBe("INDIVIDUAL_HUF");
    expect(created.body.data.higherRate206AB).toBe(true);

    const updated = await client
      .put(`/api/suppliers/${created.body.data.id}`)
      .set(OWNER.auth)
      .send({ deducteeType: "COMPANY", higherRate206AB: false });
    expect(updated.status, JSON.stringify(updated.body).slice(0, 300)).toBe(200);
    expect(updated.body.data.deducteeType).toBe("COMPANY");
    expect(updated.body.data.higherRate206AB).toBe(false);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "P217 Tenant B", companyCode: `P217B-${sfx}` },
      })
    );
    const foreignSees = await runAsTenant(other.id, () =>
      prisma.supplier.findFirst({ where: { id: Number(created.body.data.id) } })
    );
    expect(foreignSees).toBeNull();
  });

  // ── 5. TDS challan refuses a section with no ledgerCode; sections screen requires one ──
  it("refuses to pay a challan for a section with no ledgerCode, and requires one on edit", async () => {
    const client = await api();
    const supplier = await createSupplier({ pan: "AAACT1234H", deducteeType: "COMPANY" });
    const material = await createRawMaterial();

    // Register a TDS section with no payable ledger — bypassing the (now-required) validation
    // on the edit endpoint, since a hand-edited row could always have gotten here before this
    // package (a stale record, a direct DB edit); the challan still has to refuse it.
    const prisma = await getPrisma();
    const section = await asDemoTenant(async () => {
      const company = await prisma.company.findFirstOrThrow({ where: { companyCode: "DEMO" } });
      return prisma.tdsSection.upsert({
        where: {
          companyId_code: { companyId: company.id, code: `194NL${sfx}`.slice(0, 20).toUpperCase() },
        },
        create: {
          companyId: company.id,
          code: `194NL${sfx}`.slice(0, 20).toUpperCase(),
          name: "No Ledger Section (Test)",
          rateCompany: 2,
          rateIndividual: 2,
          ledgerCode: null,
        },
        update: {},
      });
    });

    const grn = await makeGrn(
      supplier.id,
      [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 1,
          unitPrice: 50000,
          tax: 0,
        },
      ],
      { tdsSectionCode: section.code, deductTds: true }
    );
    const deduction = await asDemoTenant(() =>
      prisma.tdsDeduction.findFirstOrThrow({ where: { docType: "GRN_INVOICE", docId: grn.id } })
    );

    const challan = await client
      .post("/api/tds/challans")
      .set(OWNER.auth)
      .send({
        bsrCode: "0510308",
        challanSerial: `NL${sfx}`.slice(0, 10),
        challanDate: `${FY}-09-10`,
        periodKey: `${FY}-09`,
        deductionIds: [deduction.id],
      });
    expect(challan.status, JSON.stringify(challan.body).slice(0, 300)).toBe(409);
    expect(challan.body.code).toBe("SECTION_NO_LEDGER");

    // No challan was recorded for it.
    const stillUnpaid = await asDemoTenant(() =>
      prisma.tdsDeduction.findUniqueOrThrow({ where: { id: deduction.id } })
    );
    expect(stillUnpaid.challanId).toBeNull();

    // The sections screen itself now refuses a blank ledger code on save.
    const savedBlank = await client.post("/api/tds/sections").set(OWNER.auth).send({
      code: section.code,
      name: "No Ledger Section (Test)",
      rateCompany: 2,
      rateIndividual: 2,
    });
    expect(savedBlank.status).toBe(400);

    const savedWithLedger = await client.post("/api/tds/sections").set(OWNER.auth).send({
      code: section.code,
      name: "No Ledger Section (Test)",
      rateCompany: 2,
      rateIndividual: 2,
      ledgerCode: "TDS-LIA-001",
    });
    expect(savedWithLedger.status, JSON.stringify(savedWithLedger.body).slice(0, 300)).toBe(200);
    expect(savedWithLedger.body.data.ledgerCode).toBe("TDS-LIA-001");
  });

  // ── 6. 206C(1H) pools the threshold by PAN across customer rows ───────────
  it("pools the 206C(1H) annual threshold across customer rows sharing a PAN", async () => {
    const client = await api();
    // Same PAN ("AAAAA0000A", GSTIN chars 3-12) on two different Customer rows — a branch or a
    // duplicate entered twice, which is exactly the case this pools instead of resetting.
    const customerA = await createCustomer({ gstin: "33AAAAA0000A1Z9", stateCode: "33" });
    const customerB = await createCustomer({ gstin: "27AAAAA0000A1Z5", stateCode: "27" });
    const product = await createProduct({ gstRate: 0 });

    const invA = await client
      .post("/api/sales-invoices")
      .set(OWNER.auth)
      .send({
        invoiceDate: `${FY}-09-08`,
        customerId: customerA.id,
        collectTcs: true,
        tcsSectionCode: "206C(1H)",
        items: [{ productId: product.id.toString(), qty: 1, rate: 3000000 }],
      });
    expect(invA.status, JSON.stringify(invA.body).slice(0, 300)).toBe(201);
    // ₹30 lakh alone is under the ₹50 lakh threshold: nothing collected yet.
    expect(n(invA.body.data.tcsAmount)).toBe(0);

    const invB = await client
      .post("/api/sales-invoices")
      .set(OWNER.auth)
      .send({
        invoiceDate: `${FY}-09-08`,
        customerId: customerB.id,
        collectTcs: true,
        tcsSectionCode: "206C(1H)",
        items: [{ productId: product.id.toString(), qty: 1, rate: 2500000 }],
      });
    expect(invB.status, JSON.stringify(invB.body).slice(0, 300)).toBe(201);
    // Pooled by PAN: ₹30L + ₹25L = ₹55L crosses ₹50L, and only the ₹5L excess is taxed at 0.1%.
    // Per-row (the old behaviour) customer B's own year-to-date would still be under threshold
    // and this would be 0.
    expect(n(invB.body.data.tcsAmount)).toBeCloseTo(500, 2);
  });

  // ── 7. Product.isScrap ─────────────────────────────────────────────────────
  it("stores Product.isScrap and hides it from a foreign tenant", async () => {
    const client = await api();
    const res = await client
      .post("/api/products")
      .set(OWNER.auth)
      .field("productCode", `SCR-${sfx}`)
      .field("productName", "Offcut Bundle (Test)")
      .field("isScrap", "true");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(res.body.data.isScrap).toBe(true);

    const fetched = await client.get(`/api/products/${res.body.data.id}`).set(OWNER.auth);
    expect(fetched.body.data.isScrap).toBe(true);

    const prisma = await getPrisma();
    const other = await withoutTenant(() =>
      prisma.company.create({
        data: { companyName: "P217 Tenant C", companyCode: `P217C-${sfx}` },
      })
    );
    const foreignSees = await runAsTenant(other.id, () =>
      prisma.product.findFirst({ where: { id: BigInt(res.body.data.id) } })
    );
    expect(foreignSees).toBeNull();
  });

  // ── 8. Cheque register rows on one GRN with a re-typed, repeated cheque number ──
  it("keeps two same-numbered cheque payments on one bill distinguishable by date", async () => {
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
          unitPrice: 20000,
          tax: 0,
        },
      ],
      {
        payments: [
          {
            id: `dup1-${sfx}`,
            amount: 10000,
            paymentMethod: "Cheque",
            paymentDate: `${FY}-06-01`,
            instrumentType: "CHEQUE",
            chequeNo: `CHQ-${sfx}-DUP`,
            chequeDate: `${FY}-06-01`,
            chequeBank: "HDFC Bank",
          },
          {
            id: `dup2-${sfx}`,
            amount: 10000,
            paymentMethod: "Cheque",
            paymentDate: `${FY}-06-01`,
            instrumentType: "CHEQUE",
            // Same cheque number, re-typed by mistake — but a different cheque date, which is
            // what the GRN view's match now keys on alongside the number (P2-17).
            chequeNo: `CHQ-${sfx}-DUP`,
            chequeDate: `${FY}-06-15`,
            chequeBank: "HDFC Bank",
          },
        ],
      }
    );
    expect(bill.paymentStatus).toBe("Closed");

    const prisma = await getPrisma();
    const cheques = await asDemoTenant(() =>
      prisma.cheque.findMany({
        where: { sourceDocId: bill.id, chequeNo: `CHQ-${sfx}-DUP` },
        orderBy: { chequeDate: "asc" },
      })
    );
    expect(cheques).toHaveLength(2);
    expect(cheques[0].chequeDate.toISOString().slice(0, 10)).toBe(`${FY}-06-01`);
    expect(cheques[1].chequeDate.toISOString().slice(0, 10)).toBe(`${FY}-06-15`);
    // Both register rows belong to this one bill and share a cheque number, yet are two
    // distinct rows — chequeNo alone cannot tell them apart, only chequeNo + chequeDate can.
    expect(cheques[0].id).not.toBe(cheques[1].id);
  });

  it("refuses supplier TDS-default edits without permission", async () => {
    const client = await api();
    const res = await client
      .post("/api/suppliers")
      .set(PRODUCTION.auth)
      .send({
        supplierCode: `TDSFR-${sfx}`,
        legalName: "Refused Supplier (Test)",
        billingAddressLine1: "1 Demo Road",
        billingCity: "Chennai",
        billingState: "Tamil Nadu",
        billingPincode: "600001",
        stateCode: "33",
        defaultTdsSectionCode: "194C",
      });
    expect(res.status).toBe(403);
  });
});
