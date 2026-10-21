import { describe, expect, it } from "vitest";
import { api, authed } from "../helpers/app";
import { getPrisma } from "../helpers/db";
import { asDemoTenant, createSupplier, demoCompany } from "../factories";
import { accountsService } from "../../src/modules/accounts/accounts.service";

/** H05/H06: an edited bill must not read as a payment, and a balance is not "overdue" by itself. */
describe("payable summary", () => {
  it("ignores cancelled vouchers and their reversals, and only flags bills past due", async () => {
    const prisma = await getPrisma();
    const company = await demoCompany();
    const supplier = await createSupplier();
    const sfx = Date.now().toString(36);

    await asDemoTenant(async () => {
      const ledger = await accountsService.ensureSupplierLedger(supplier);
      const purch = await prisma.accountLedger.findFirstOrThrow({ where: { code: "PURCH-001" } });
      const mk = async (
        n: string,
        data: { status?: "POSTED" | "CANCELLED"; reversalOfId?: number },
        reversal: boolean
      ) =>
        prisma.voucher.create({
          data: {
            companyId: company.id,
            voucherNo: `PT-${sfx}-${n}`,
            type: "JOURNAL",
            date: new Date(),
            ...data,
            items: {
              create: [
                reversal
                  ? { companyId: company.id, debitLedgerId: ledger.id, debitAmount: 11800 }
                  : { companyId: company.id, debitLedgerId: purch.id, debitAmount: 11800 },
                ...(reversal
                  ? []
                  : [{ companyId: company.id, creditLedgerId: ledger.id, creditAmount: 11800 }]),
              ],
            },
          },
        });
      // original bill, cancelled by an edit, its reversal, and the reposted bill
      const original = await mk("1", { status: "CANCELLED" }, false);
      await mk("2", { reversalOfId: original.id }, true);
      await mk("3", {}, false);
    });

    const { auth } = await authed("demo.accounts");
    const res = await (await api())
      .get("/api/accounts/payable")
      .query({ supplierId: String(supplier.id) })
      .set(auth);
    expect(res.status).toBe(200);
    const row = (res.body.data?.data ?? res.body.data)[0];
    expect(row.totalBilled).toBe(11800);
    expect(row.totalPaid).toBe(0);
    expect(row.balanceAsOnDate).toBe(11800);
    expect(row.isOverdue).toBe(false);
    expect(row.overdueAmount).toBe(0);
  });
});
