/**
 * Demo trading activity for the development tenant: a few sales invoices and the receipts
 * against them. Without it the demo books hold invoices and no money in, so Receivable equals
 * Sales to the rupee, cash and bank only ever go down, and the bank balance reads negative.
 *
 * Everything goes through the real services (invoice creation, `recordReceipt`), so numbers,
 * vouchers, ledgers and audit rows are exactly what a user clicking through the app would
 * produce. Nothing here writes a voucher or `audit_log` by hand. Idempotent: an invoice is
 * recognised by its marker note, and receipts are only recorded on an invoice that has none.
 *
 * Kept out of `seedTenant` on purpose: the cross-tenant suite seeds extra tenants with that
 * function and must not pay for, or depend on, demo books.
 */
import { prisma } from "../src/config/prisma";
import { runAsTenant } from "../src/lib/tenant-context";
import { salesInvoiceService } from "../src/modules/sales-invoice/sales-invoice.service";

export interface DemoActivityOptions {
  companyId: string;
  /** User id of the demo owner; recorded as the author of every document. */
  ownerUserId: string;
  log?: (msg: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);

/** One invoice per customer, and what has been collected against it so far. */
const PLAN = [
  // Paid in full by bank transfer.
  {
    customer: "C001",
    daysAgo: 45,
    lines: [["P001", 400]],
    receipts: [{ share: 1, daysAgo: 30, by: "BANK" }],
  },
  // Part paid in cash.
  {
    customer: "C002",
    daysAgo: 35,
    lines: [["P003", 900]],
    receipts: [{ share: 0.4, daysAgo: 25, by: "CASH" }],
  },
  // Paid in two bank instalments.
  {
    customer: "C003",
    daysAgo: 30,
    lines: [["P004", 120]],
    receipts: [
      { share: 0.5, daysAgo: 20, by: "BANK" },
      { share: 0.5, daysAgo: 8, by: "BANK" },
    ],
  },
  // Nothing received yet: past its 7-day credit period.
  { customer: "C004", daysAgo: 20, lines: [["P005", 6000]], receipts: [] },
  // A quarter received.
  {
    customer: "C005",
    daysAgo: 12,
    lines: [["P002", 500]],
    receipts: [{ share: 0.25, daysAgo: 4, by: "BANK" }],
  },
] as const;

export async function seedDemoActivity(opts: DemoActivityOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const user = { userId: opts.ownerUserId, companyId: opts.companyId };

  await runAsTenant(opts.companyId, async () => {
    for (const plan of PLAN) {
      const customer = await prisma.customer.findFirst({
        where: { customerCode: plan.customer },
        select: { id: true },
      });
      if (!customer) continue;
      const marker = `Demo activity ${plan.customer}`;

      let invoice = await prisma.salesInvoice.findFirst({
        where: { customerId: customer.id, notes: marker },
      });
      if (!invoice) {
        const items = [];
        for (const [productCode, qty] of plan.lines) {
          const product = await prisma.product.findFirst({
            where: { productCode },
            select: { id: true, rate: true },
          });
          if (!product) continue;
          items.push({ productId: product.id.toString(), qty, rate: Number(product.rate ?? 0) });
        }
        if (items.length === 0) continue;
        const created = await salesInvoiceService.createSalesInvoice(
          {
            invoiceDate: isoDay(plan.daysAgo),
            customerId: customer.id,
            items,
            notes: marker,
            payments: [],
          } as unknown as Parameters<typeof salesInvoiceService.createSalesInvoice>[0],
          user
        );
        invoice = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: created.id } });
        log(`demo invoice ${invoice.invoiceNo} for ${plan.customer}`);
      }

      const hasReceipts = Array.isArray(invoice.payments) && invoice.payments.length > 0;
      if (hasReceipts) continue;
      const total = Number(invoice.grandTotal);
      for (const r of plan.receipts) {
        const amount = Math.round(total * r.share * 100) / 100;
        await salesInvoiceService.recordReceipt(
          invoice.id,
          {
            amount,
            paymentDate: isoDay(r.daysAgo),
            instrumentType: r.by,
            referenceNumber: r.by === "BANK" ? `NEFT-${plan.customer}-${r.daysAgo}` : undefined,
          } as Parameters<typeof salesInvoiceService.recordReceipt>[1],
          user
        );
        log(`demo receipt ${amount} (${r.by}) on ${invoice.invoiceNo}`);
      }
    }
  });
}
