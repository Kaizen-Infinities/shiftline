import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createRawMaterial, createSupplier, demoCompany } from "../factories";
import { limitFor, msmeService } from "../../src/modules/msme/msme.service";

/**
 * MSME dues and section 43B(h) (P1-07).
 *
 * The clock is the whole package, and two things about it are easy to get wrong and expensive to
 * get wrong: it runs from acceptance rather than the invoice date, and an agreement for 60 days
 * does not buy 60 days — section 15 caps it at 45. Both are tested directly, and the
 * disallowance report is tested against a bill on each side of the line.
 */
const sfx = Date.now().toString(36).slice(-5);
// FY 2029-30: past every other suite's financial year, so the report sees only these bills.
const FY = "2029-30";
const ACCEPTED = "2029-06-01";

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

const bill = async (supplierId: number, amount: number, over: Record<string, unknown> = {}) => {
  const material = await createRawMaterial();
  const res = await (
    await api()
  )
    .post("/api/grn-invoices")
    .set(OWNER.auth)
    .send({
      ...ADDRESS,
      invoiceNo: `MSME-${sfx}-${material.rawMaterialId}`,
      grnDate: ACCEPTED,
      receiveDate: ACCEPTED,
      supplierId,
      storeId: "ST-RM",
      updateStock: false,
      items: [
        {
          productId: material.rawMaterialId,
          description: material.materialName,
          uom: "KG",
          quantity: 1,
          unitPrice: amount,
          tax: 0,
        },
      ],
      ...over,
    });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  return res.body.data as { id: string; netAmount: string };
};

/** Payments have no API of their own yet, so the report is fed the rows it reads. */
const pay = async (grnInvoiceId: string, amount: number, paymentDate: string) => {
  const prisma = await getPrisma();
  const company = await demoCompany();
  return asDemoTenant(() =>
    prisma.grnInvoicePayment.create({
      data: {
        companyId: company.id,
        grnInvoiceId,
        amount,
        paymentMethod: "BANK",
        paymentDate: new Date(`${paymentDate}T00:00:00Z`),
      },
    })
  );
};

describe("MSME dues and section 43B(h)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
  });

  it("derives the limit: 15 days without a written contract, capped at 45 with one", () => {
    expect(limitFor({ hasWrittenContract: false, agreedPaymentDays: 90 })).toBe(15);
    expect(limitFor({ hasWrittenContract: false, agreedPaymentDays: null })).toBe(15);
    expect(limitFor({ hasWrittenContract: true, agreedPaymentDays: 30 })).toBe(30);
    // Agreeing to 60 days does not make 60 days lawful.
    expect(limitFor({ hasWrittenContract: true, agreedPaymentDays: 60 })).toBe(45);
    expect(limitFor({ hasWrittenContract: true, agreedPaymentDays: null })).toBe(45);
  });

  it("counts from acceptance and reports the clock per bill", async () => {
    const supplier = await createSupplier({
      msmeCategory: "MICRO",
      udyamNumber: `UDYAM-TN-01-000${sfx.slice(0, 4)}`.slice(0, 19),
      hasWrittenContract: true,
      agreedPaymentDays: 45,
    });
    const grn = await bill(supplier.id, 10000);

    const res = await (
      await api()
    )
      .get("/api/msme/bills")
      .query({ supplierId: supplier.id, asOn: "2029-06-20" })
      .set(OWNER.auth);
    expect(res.status).toBe(200);
    const rows = res.body.data as {
      grnId: string;
      dueDate: string;
      daysLeft: number;
      limitDays: number;
      outstanding: number;
      overdue: boolean;
    }[];
    const row = rows.find((r) => r.grnId === grn.id)!;
    expect(row).toBeDefined();
    // Accepted 1 June + 45 days = 16 July, whatever the invoice said.
    expect(row.dueDate).toBe("2029-07-16");
    expect(row.limitDays).toBe(45);
    expect(row.daysLeft).toBe(26);
    expect(row.overdue).toBe(false);
    expect(row.outstanding).toBe(10000);
  });

  it("disallows what is unpaid past the limit at the year end, and gives it back in the year it is paid", async () => {
    const supplier = await createSupplier({
      msmeCategory: "SMALL",
      hasWrittenContract: false, // 15 days
    });
    const unpaid = await bill(supplier.id, 5000);
    const paidInTime = await bill(supplier.id, 3000);
    const paidLate = await bill(supplier.id, 7000);

    // Within the 15 days: never disallowed.
    await pay(paidInTime.id, 3000, "2029-06-10");
    // After the 15 days but inside the same financial year: the deduction lands in this year.
    await pay(paidLate.id, 7000, "2029-08-20");

    const report = await asDemoTenant(() => msmeService.disallowance(FY));
    expect(report.fyEnd).toBe("2030-03-31");

    const disallowedIds = report.disallowed.bills.map((b) => b.grnId);
    expect(disallowedIds).toContain(unpaid.id);
    expect(disallowedIds).not.toContain(paidInTime.id);
    expect(disallowedIds).not.toContain(paidLate.id);
    expect(report.disallowed.total).toBeGreaterThanOrEqual(5000);

    const backIds = report.allowedOnPayment.bills.map((b) => b.grnId);
    expect(backIds).toContain(paidLate.id);
    expect(backIds).not.toContain(paidInTime.id);
  });

  it("leaves medium and unregistered suppliers out of it entirely", async () => {
    const medium = await createSupplier({ msmeCategory: "MEDIUM" });
    const plain = await createSupplier({ msmeCategory: "NOT_REGISTERED" });
    const a = await bill(medium.id, 9000);
    const b = await bill(plain.id, 9000);

    const report = await asDemoTenant(() => msmeService.disallowance(FY));
    const seen = [...report.disallowed.bills, ...report.allowedOnPayment.bills].map((x) => x.grnId);
    // Section 43B(h) reaches micro and small only; a medium enterprise has no section 15 clock.
    expect(seen).not.toContain(a.id);
    expect(seen).not.toContain(b.id);
  });

  it("reports on Form 1 only what is past 45 days, whatever the supplier's own limit is", async () => {
    const supplier = await createSupplier({ msmeCategory: "MICRO", hasWrittenContract: false });
    const old = await bill(supplier.id, 4000);

    // Half-year to 30 September 2029: the 1 June bill is 121 days old, so it is reportable.
    const res = await (await api()).get("/api/msme/form1/2029-H1").set(OWNER.auth);
    expect(res.status).toBe(200);
    const form = res.body.data as {
      to: string;
      lines: { invoiceNo: string; amountOutstanding: number; reason: string }[];
    };
    expect(form.to).toBe("2029-09-30");
    const line = form.lines.find((l) => l.amountOutstanding === 4000);
    expect(line, JSON.stringify(form.lines).slice(0, 300)).toBeDefined();
    expect(line!.reason).toBe("No written agreement");
    expect(old.id).toBeTruthy();

    // ...and it lands on the filing gate like every other return.
    const registered = await (
      await api()
    )
      .post("/api/msme/form1/2029-H1/register")
      .set(OWNER.auth)
      .send({});
    expect(registered.status).toBe(200);
    expect(registered.body.data.filing.filingType).toBe("MSME_1");
    expect(registered.body.data.filing.periodKey).toBe("2029-H1");
  });

  it("warns once per threshold rather than once a day", async () => {
    const supplier = await createSupplier({
      msmeCategory: "MICRO",
      hasWrittenContract: true,
      agreedPaymentDays: 45,
    });
    await bill(supplier.id, 2500);

    // 1 June + 45 days = 16 July; 15 days before that is 1 July.
    const first = await asDemoTenant(() =>
      msmeService.warnUpcoming(new Date("2029-07-01T09:00:00Z"))
    );
    expect(first.sent).toBeGreaterThan(0);
    const again = await asDemoTenant(() =>
      msmeService.warnUpcoming(new Date("2029-07-01T18:00:00Z"))
    );
    expect(again.sent).toBe(0);
  });

  it("refuses a bad financial year and a bad half-year", async () => {
    const client = await api();
    expect((await client.get("/api/msme/disallowance/2029").set(OWNER.auth)).status).toBe(400);
    expect((await client.get("/api/msme/form1/2029-H3").set(OWNER.auth)).status).toBe(400);
  });
});
