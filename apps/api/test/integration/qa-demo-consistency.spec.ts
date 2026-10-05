import { describe, expect, it } from "vitest";

import { getPrisma } from "../helpers/db";
import { asDemoTenant } from "../factories";
import {
  seedDemoActivity,
  seedDemoProductionOrders,
  seedDemoStockMinimums,
} from "../../prisma/seed-demo-activity";
import { complianceService } from "../../src/modules/gst-returns/compliance.service";
import { runAsTenant } from "../../src/lib/tenant-context";

/**
 * F11 and F19 from the QA pass: the demo books, products and production orders agree with each
 * other, and the GSTR-1 reminder says what "prepared" means.
 */
const n = (v: unknown) => Number(v);

describe("demo seed consistency (F11)", () => {
  it("leaves cash and bank in debit, gives products a minimum, and varies the orders", async () => {
    const prisma = await getPrisma();
    const owner = await asDemoTenant(() =>
      prisma.user.findUniqueOrThrow({ where: { username: "demo.owner" } })
    );
    const company = await asDemoTenant(() =>
      prisma.company.findUniqueOrThrow({ where: { companyCode: "DEMO" } })
    );
    const opts = { companyId: company.id, ownerUserId: owner.userId };
    await seedDemoActivity(opts);
    await seedDemoStockMinimums(opts);
    await seedDemoProductionOrders(opts);

    // (a) The seeded receipts leave no cash or bank ledger overdrawn. Other specs in the same
    // worker post to the same ledgers, so only the demo invoices' receipt vouchers count.
    const rows = await asDemoTenant(async () => {
      const demoInvoices = await prisma.salesInvoice.findMany({
        where: { notes: { startsWith: "Demo activity" } },
        select: { invoiceNo: true },
      });
      expect(demoInvoices.length).toBeGreaterThan(0);
      const receipts = await prisma.voucher.findMany({
        where: {
          refDocType: "SALES_PAYMENT",
          OR: demoInvoices.map((i) => ({ narration: { contains: i.invoiceNo } })),
        },
        select: { id: true },
      });
      expect(receipts.length).toBeGreaterThan(0);
      const seeded = { voucherId: { in: receipts.map((v) => v.id) } };
      const ledgers = await prisma.accountLedger.findMany({
        where: { ledgerGroup: { code: { in: ["CASH_IN_HAND", "BANK_ACCOUNTS"] } } },
        select: { id: true, code: true },
      });
      const out: { code: string; balance: number }[] = [];
      for (const l of ledgers) {
        const [d, c] = await Promise.all([
          prisma.journalItem.aggregate({
            where: { debitLedgerId: l.id, ...seeded },
            _sum: { debitAmount: true },
          }),
          prisma.journalItem.aggregate({
            where: { creditLedgerId: l.id, ...seeded },
            _sum: { creditAmount: true },
          }),
        ]);
        out.push({ code: l.code, balance: n(d._sum.debitAmount) - n(c._sum.creditAmount) });
      }
      return out;
    });
    for (const r of rows) expect(r.balance, r.code).toBeGreaterThanOrEqual(0);

    // (b) The seeded finished goods carry the minimum the dashboard will use.
    const products = await asDemoTenant(() =>
      prisma.product.findMany({
        where: { productCode: { in: ["P001", "P002", "P003", "P004", "P005"] } },
      })
    );
    expect(products).toHaveLength(5);
    for (const p of products) expect(n(p.minimumQty), p.productCode).toBeGreaterThan(0);

    // (c) Orders are in several states, finished ones are not overdue, and some are in the future.
    const orders = await asDemoTenant(() =>
      prisma.productionOrder.findMany({ where: { productionOrderId: { startsWith: "MO-DEMO-" } } })
    );
    expect(new Set(orders.map((o) => o.status)).size).toBeGreaterThanOrEqual(4);
    const now = Date.now();
    expect(orders.some((o) => o.status === "COMPLETED")).toBe(true);
    expect(orders.some((o) => o.status === "IN_PRODUCTION")).toBe(true);
    expect(orders.filter((o) => o.dueDate.getTime() > now).length).toBeGreaterThanOrEqual(5);
    expect(
      orders.filter((o) => o.dueDate.getTime() < now && o.status !== "COMPLETED")
    ).toHaveLength(0);

    // Running the seed again adds nothing.
    await seedDemoProductionOrders(opts);
    expect(
      await asDemoTenant(() =>
        prisma.productionOrder.count({ where: { productionOrderId: { startsWith: "MO-DEMO-" } } })
      )
    ).toBe(orders.length);
  });
});

describe("GSTR-1 reminder wording (F19)", () => {
  it("says no filing has been started for approval, and does not repeat for the same day", async () => {
    const prisma = await getPrisma();
    const company = await asDemoTenant(() =>
      prisma.company.findUniqueOrThrow({ where: { companyCode: "DEMO" } })
    );
    // 4 Dec 2026 is seven days before the 11 Dec GSTR-1 date for November.
    const at = new Date(Date.UTC(2026, 11, 4));
    const first = await runAsTenant(company.id, () => complianceService.warnUpcoming(at));
    expect(first.sent).toBeGreaterThan(0);
    const note = await asDemoTenant(() =>
      prisma.notification.findFirst({
        where: { category: "filings", title: { contains: "GSTR-1" }, link: { contains: "&d=7" } },
        orderBy: { createdAt: "desc" },
      })
    );
    expect(note?.body).toContain("No filing has been started for approval yet");
    expect(note?.body).toContain("live preview");
    const second = await runAsTenant(company.id, () => complianceService.warnUpcoming(at));
    expect(second.sent).toBe(0);
  });
});
