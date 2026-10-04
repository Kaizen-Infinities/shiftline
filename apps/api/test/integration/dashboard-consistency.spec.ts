import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { api, authed } from "../helpers/app";
import { resetPeriodControl } from "../helpers/books";
import { foreignTenant } from "../helpers/foreign-tenant";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createProduct } from "../factories";
import { seedDemoActivity } from "../../prisma/seed-demo-activity";
import { accountsService } from "../../src/modules/accounts/accounts.service";
import { getISTDayStartUtc } from "../../src/utils/dateUtils";

/**
 * R-05 to R-07: the TV board, the dashboard, bank reconciliation and the demo data have to tell
 * the same story. Each block pins one defect from docs/AS-BUILT.md.
 */
const n = (v: unknown) => Number(v);
const sfx = randomUUID().slice(0, 6).toUpperCase();

let OWNER: { auth: Record<string, string> };

const accountsSummary = async () => {
  const res = await (await api()).get("/api/dashboard/accounts-summary").set(OWNER.auth);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.data;
};
const tvSummary = async (auth = OWNER.auth) => {
  const res = await (await api()).get("/api/dashboard/tv-summary").set(auth);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body.data;
};

/** An overdrawn bank ledger: a credit opening balance on an asset ledger. */
const overdrawnBankLedger = async (amount: number) =>
  asDemoTenant(() =>
    accountsService.createLedger({
      code: `BNK-${sfx}`,
      name: `Overdrawn Bank ${sfx}`,
      type: "ASSET",
      group: "Bank Accounts",
      isActive: true,
      openingBalance: amount,
      openingBalanceType: "CREDIT",
    } as Parameters<typeof accountsService.createLedger>[0])
  );

describe("dashboard, TV board and bank reconciliation agree (R-05, R-06, R-07)", () => {
  beforeAll(async () => {
    OWNER = await authed("demo.owner");
    await resetPeriodControl();
  });

  describe("defects 3 and 6: demo receipts and customer names", () => {
    it("posts receipts against the demo invoices, so receivable is below sales", async () => {
      const owner = await asDemoTenant(async () =>
        (await getPrisma()).user.findUniqueOrThrow({ where: { username: "demo.owner" } })
      );
      const company = await asDemoTenant(async () =>
        (await getPrisma()).company.findUniqueOrThrow({ where: { companyCode: "DEMO" } })
      );
      await seedDemoActivity({ companyId: company.id, ownerUserId: owner.userId });

      const prisma = await getPrisma();
      const invoices = await asDemoTenant(() =>
        prisma.salesInvoice.findMany({ where: { notes: { startsWith: "Demo activity C" } } })
      );
      expect(invoices).toHaveLength(5);
      const received = invoices.map((i) =>
        ((i.payments as { amount: number }[]) ?? []).reduce((s, p) => s + n(p.amount), 0)
      );
      expect(received.filter((r) => r > 0).length).toBeGreaterThanOrEqual(4);
      expect(received.filter((r) => r === 0).length).toBeGreaterThanOrEqual(1); // C004 still owes

      // The receipts are real RECEIPT vouchers on the books, not a number written on the invoice.
      const vouchers = await asDemoTenant(() =>
        prisma.voucher.findMany({
          where: { refDocType: "SALES_PAYMENT", status: "POSTED", type: "RECEIPT" },
        })
      );
      expect(vouchers.length).toBeGreaterThanOrEqual(5);

      const summary = await accountsSummary();
      expect(summary.totalReceivable).toBeLessThan(summary.totalSales);

      // Running it again changes nothing.
      await seedDemoActivity({ companyId: company.id, ownerUserId: owner.userId });
      const again = await asDemoTenant(() =>
        prisma.salesInvoice.count({ where: { notes: { startsWith: "Demo activity C" } } })
      );
      expect(again).toBe(5);
    });

    it("names every demo customer and supplier the same way, with the company-code suffix", async () => {
      const prisma = await getPrisma();
      const customers = await asDemoTenant(() =>
        prisma.customer.findMany({
          where: { customerCode: { in: ["C001", "C002", "C003", "C004", "C005"] } },
        })
      );
      const suppliers = await asDemoTenant(() =>
        prisma.supplier.findMany({ where: { supplierCode: { in: ["S001", "S002", "S003"] } } })
      );
      expect(customers).toHaveLength(5);
      expect(suppliers).toHaveLength(3);
      for (const c of customers) {
        expect(c.firmName, c.customerCode).toMatch(/ \(DEMO\)$/);
        expect(c.displayName, c.customerCode).toMatch(/ \(DEMO\)$/);
      }
      for (const s of suppliers) {
        expect(s.legalName, s.supplierCode).toMatch(/\(DEMO\)/);
        expect(s.displayName, s.supplierCode).toMatch(/ \(DEMO\)$/);
      }
    });
  });

  describe("defects 1 and 4: cash and bank sign, and the negative-balance alert", () => {
    it("sums the same accounts as the bank list, keeping the sign", async () => {
      const ledger = await overdrawnBankLedger(250000);
      const client = await api();
      const list = await client.get("/api/accounts/bank-accounts").set(OWNER.auth);
      expect(list.status).toBe(200);
      const accounts = list.body.data.accounts as { name: string; currentBalance: number }[];
      const mine = accounts.find((a) => a.name === ledger.name)!;
      expect(n(mine.currentBalance)).toBe(-250000);

      const s = await accountsSummary();
      // Tiles and list use one definition of "bank or cash", so the totals match to the paisa.
      expect(Math.round(s.totalCashInHand + s.totalBankBalance)).toBe(
        Math.round(list.body.data.totalBalance)
      );
      expect(s.cashBankAccountCount).toBe(accounts.length);
      expect(s.cashAccountCount + s.bankAccountCount).toBe(accounts.length);
    });

    it("raises the alert for exactly the accounts whose balance is negative", async () => {
      await overdrawnBankLedger(250000).catch(() => undefined); // already there from the test above
      const client = await api();
      const list = await client.get("/api/accounts/bank-accounts").set(OWNER.auth);
      const accounts = list.body.data.accounts as { name: string; currentBalance: number }[];
      const negative = accounts.filter((a) => n(a.currentBalance) < -0.005);
      expect(negative.length).toBeGreaterThanOrEqual(1);

      const s = await accountsSummary();
      expect(s.negativeCashBankCount).toBe(negative.length);
      const alert = (
        s.alerts as { message: string; details?: { name: string; amount: string }[] }[]
      ).find((a) => /negative balance/.test(a.message))!;
      expect(alert.message).toContain(`${negative.length} bank/cash account`);
      expect((alert.details ?? []).map((d) => d.name).sort()).toEqual(
        negative.map((a) => a.name).sort()
      );
      for (const d of alert.details ?? []) expect(d.amount.startsWith("-")).toBe(true);
    });

    it("shows no alert for a tenant with no overdrawn account", async () => {
      const foreign = await foreignTenant(`dc${sfx.slice(0, 4).toLowerCase()}`);
      const res = await (await api()).get("/api/dashboard/accounts-summary").set(foreign.auth);
      expect(res.status).toBe(200);
      expect(res.body.data.negativeCashBankCount).toBe(0);
      expect(JSON.stringify(res.body.data.alerts)).not.toContain("negative balance");
      // ...and the demo tenant's overdrawn ledger is not in its totals.
      expect(JSON.stringify(res.body.data)).not.toContain(`Overdrawn Bank ${sfx}`);
    });
  });

  describe("defect 2: inventory health counts finished goods", () => {
    it("counts a product with no stock as critical, and one above its minimum as healthy", async () => {
      const prisma = await getPrisma();
      const before = await tvSummary();
      const store = await asDemoTenant(() => prisma.store.findFirstOrThrow());

      const empty = await createProduct({ productName: `Zero Stock ${sfx}` }); // min unset => 1,500
      const stocked = await createProduct({ productName: `Well Stocked ${sfx}` });
      const lowish = await createProduct({ productName: `Running Low ${sfx}`, minimumQty: "1000" });
      await asDemoTenant(() =>
        prisma.finishedGoodsStock.createMany({
          data: [
            { storeId: store.storeId, productItemId: stocked.id, onHandQty: 9000 },
            { storeId: store.storeId, productItemId: lowish.id, onHandQty: 800 }, // low, above 40%
          ],
        })
      );
      expect(empty.id).not.toBe(stocked.id);

      const after = await tvSummary();
      expect(after.inventory.finishedSkuTotal).toBe(before.inventory.finishedSkuTotal + 3);
      expect(after.inventory.finishedCritical).toBe(before.inventory.finishedCritical + 1);
      expect(after.inventory.finishedLow).toBe(before.inventory.finishedLow + 1);
      expect(after.inventory.criticalCount).toBe(before.inventory.criticalCount + 1);
      expect(after.inventory.skuTotal).toBe(before.inventory.skuTotal + 3);
      // Never "100% healthy" while a finished good sits at zero.
      expect(after.inventory.healthyPct).toBeLessThan(100);
      expect(after.alerts.some((a: { text: string }) => /finished good/.test(a.text))).toBe(true);
    });

    it("scopes the finished-goods count to the tenant", async () => {
      const foreign = await foreignTenant(`df${sfx.slice(0, 4).toLowerCase()}`);
      const tv = await tvSummary(foreign.auth);
      // The foreign tenant has its own five seeded products, all at zero, and none of ours.
      expect(tv.inventory.finishedSkuTotal).toBe(5);
      expect(tv.inventory.finishedCritical).toBe(5);
      expect(JSON.stringify(tv.inventory)).not.toContain(sfx);
    });
  });

  describe("defect 5: bank reconciliation sees the bank account", () => {
    it("lists the seeded bank account with its ledger and book balance", async () => {
      const res = await (await api()).get("/api/banking/accounts").set(OWNER.auth);
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
      const main = (
        res.body.data.accounts as { ledgerCode: string; id: string; bookBalance: number }[]
      ).find((a) => a.ledgerCode === "BANK-001")!;
      expect(main).toBeDefined();
      expect(main.id).toMatch(/^[0-9a-f-]{36}$/); // the BankAccount uuid the banking routes take

      // The dashboard's bank total includes this account's balance.
      const list = await (await api()).get("/api/accounts/bank-accounts").set(OWNER.auth);
      const ledger = (list.body.data.accounts as { code: string; currentBalance: number }[]).find(
        (a) => a.code === "BANK-001"
      )!;
      expect(n(main.bookBalance)).toBe(n(ledger.currentBalance));
    });

    it("offers a bank ledger with no bank details for set-up, and links it once", async () => {
      await overdrawnBankLedger(250000).catch(() => undefined);
      const client = await api();
      const before = await client.get("/api/banking/accounts").set(OWNER.auth);
      const orphan = (before.body.data.unlinked as { ledgerId: number; name: string }[]).find((u) =>
        u.name.includes(sfx)
      )!;
      expect(orphan).toBeDefined();

      const linked = await client
        .post("/api/banking/accounts")
        .set(OWNER.auth)
        .send({ ledgerId: orphan.ledgerId, bankName: `Test Bank ${sfx}` });
      expect(linked.status, JSON.stringify(linked.body).slice(0, 300)).toBe(201);

      const after = await client.get("/api/banking/accounts").set(OWNER.auth);
      expect(
        (after.body.data.accounts as { bankName: string }[]).some(
          (a) => a.bankName === `Test Bank ${sfx}`
        )
      ).toBe(true);
      expect(
        (after.body.data.unlinked as { name: string }[]).some((u) => u.name.includes(sfx))
      ).toBe(false);

      const twice = await client
        .post("/api/banking/accounts")
        .set(OWNER.auth)
        .send({ ledgerId: orphan.ledgerId, bankName: "Again" });
      expect(twice.status).toBe(409);
    });

    it("refuses bad input, a cash ledger, the anonymous and a user who may only view", async () => {
      const client = await api();
      const noName = await client
        .post("/api/banking/accounts")
        .set(OWNER.auth)
        .send({ ledgerId: 1 });
      expect(noName.status).toBe(400);
      expect(JSON.stringify(noName.body)).not.toMatch(/prisma|SELECT |\.ts:\d/i);

      const prisma = await getPrisma();
      const cash = await asDemoTenant(() =>
        prisma.accountLedger.findFirstOrThrow({ where: { code: "CASH-001" } })
      );
      const asCash = await client
        .post("/api/banking/accounts")
        .set(OWNER.auth)
        .send({ ledgerId: cash.id, bankName: "Cash is not a bank" });
      expect(asCash.status).toBe(404);

      expect((await client.get("/api/banking/accounts")).status).toBe(401);
      const auditor = await authed("demo.auditor");
      const viewOnly = await client
        .post("/api/banking/accounts")
        .set(auditor.auth)
        .send({ ledgerId: cash.id, bankName: "x" });
      expect(viewOnly.status).toBe(403);
    });

    it("keeps one tenant's bank accounts and ledgers out of another's", async () => {
      const foreign = await foreignTenant(`db${sfx.slice(0, 4).toLowerCase()}`);
      const client = await api();
      const res = await client.get("/api/banking/accounts").set(foreign.auth);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body.data)).not.toContain(sfx);
      expect(res.body.data.accounts).toHaveLength(1); // its own seeded Main Bank only

      // A demo ledger id is not linkable from another tenant.
      const prisma = await getPrisma();
      const demoBank = await asDemoTenant(() =>
        prisma.accountLedger.findFirstOrThrow({
          where: { name: { contains: `Overdrawn Bank ${sfx}` } },
        })
      );
      const cross = await client
        .post("/api/banking/accounts")
        .set(foreign.auth)
        .send({ ledgerId: demoBank.id, bankName: "Intruder" });
      expect(cross.status).toBe(404);
    });
  });

  describe("defect 8: overdue orders and today's plan are different, dated in IST", () => {
    it("counts a production order as past due once its due date is before IST midnight", async () => {
      const prisma = await getPrisma();
      const product = await createProduct();
      const before = (await tvSummary()).orders.delayed as number;
      const istMidnight = getISTDayStartUtc();
      const mk = (suffix: string, due: Date, status = "CREATED") =>
        asDemoTenant(() =>
          prisma.productionOrder.create({
            data: {
              productionOrderId: `PO${sfx}${suffix}`,
              orderDate: new Date(istMidnight.getTime() - 5 * 86400000),
              dueDate: due,
              productItemId: product.id,
              targetQty: 100,
              uom: "NOS",
              status,
            },
          })
        );
      await mk("A", new Date(istMidnight.getTime() - 60_000)); // 23:59 IST yesterday: past due
      await mk("B", new Date(istMidnight.getTime() + 60 * 60_000)); // 01:00 IST today: not yet
      await mk("C", new Date(istMidnight.getTime() - 86400000), "COMPLETED"); // late but finished
      const tv = await tvSummary();
      expect(tv.orders.delayed).toBe(before + 1);
      expect(
        tv.alerts.some((a: { text: string }) => /past due date and not finished/.test(a.text))
      ).toBe(true);

      // The dashboard carries the due date, so it can say the same thing in its own words.
      const summary = await (await api()).get("/api/dashboard/summary").set(OWNER.auth);
      const po = (
        summary.body.data.productionOrders as { productionOrderId: string; dueDate: string }[]
      ).find((p) => p.productionOrderId === `PO${sfx}A`)!;
      expect(po.dueDate).toBeTruthy();
    });
  });
});
