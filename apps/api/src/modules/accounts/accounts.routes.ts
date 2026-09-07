import { Router } from "express";
import { accountsController } from "./accounts.controller";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";

const router = Router();
router.use(authMiddleware);

router.get("/groups", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.listLedgerGroups(req, res, next)
);
router.post("/groups", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.createLedgerGroup(req, res, next)
);
router.patch("/groups/:id", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.updateLedgerGroup(req, res, next)
);
router.get("/ledgers", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getLedgers(req, res, next)
);
router.post("/ledgers", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.createLedger(req, res, next)
);
router.get("/ledgers/:id", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getLedgerById(req, res, next)
);
router.patch("/ledgers/:id", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.updateLedger(req, res, next)
);
router.get("/ledger-statement/multi", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getMultiLedgerStatement(req, res, next)
);
router.get("/ledgers/:id/statement", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getLedgerStatement(req, res, next)
);

router.get("/bank-accounts", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getBankAccounts(req, res, next)
);
router.post("/ledgers/:id/opening-balance", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.setBankOpeningBalance(req, res, next)
);
router.post("/repair-opening-vouchers", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.repairPartyOpeningBalanceVouchers(req, res, next)
);

router.get("/payable", requirePermission("payable.view"), (req, res, next) =>
  accountsController.getPayableSummaries(req, res, next)
);
// Ageing (P1-10) is declared before the `:id` routes so "ageing" is never read as an id.
router.get("/payable/ageing", requirePermission("payable.view"), (req, res, next) =>
  accountsController.getPayableAgeing(req, res, next)
);
router.get("/payable/:supplierId", requirePermission("payable.view"), (req, res, next) =>
  accountsController.getSupplierPayableDetail(req, res, next)
);

router.get("/receivable", requirePermission("receivable.view"), (req, res, next) =>
  accountsController.getReceivableSummaries(req, res, next)
);
router.get("/receivable/ageing", requirePermission("receivable.view"), (req, res, next) =>
  accountsController.getReceivableAgeing(req, res, next)
);
router.get("/receivable/:customerId", requirePermission("receivable.view"), (req, res, next) =>
  accountsController.getCustomerReceivableDetail(req, res, next)
);

// Books of prime entry and cash flow (P1-10b)
router.get("/day-book", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getDayBook(req, res, next)
);
router.get("/cash-book", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getCashBook(req, res, next)
);
router.get("/bank-book", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getBankBook(req, res, next)
);
router.get("/bank-book/:ledgerId", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getBankBook(req, res, next)
);
router.get("/cash-flow", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getCashFlow(req, res, next)
);

// Statements of account (P1-10c): JSON, PDF, send by email or WhatsApp
for (const [party, perm] of [
  ["customer", "receivable.view"],
  ["supplier", "payable.view"],
] as const) {
  router.get(`/statements/${party}/:id`, requirePermission(perm), (req, res, next) =>
    accountsController.getStatement(req, res, next)
  );
  router.get(`/statements/${party}/:id/pdf`, requirePermission(perm), (req, res, next) =>
    accountsController.getStatementPdf(req, res, next)
  );
  router.post(`/statements/${party}/:id/send`, requirePermission(perm), (req, res, next) =>
    accountsController.sendStatement(req, res, next)
  );
}

// Reports
router.get("/balance-sheet", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getBalanceSheet(req, res, next)
);
router.get("/trial-balance", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getTrialBalance(req, res, next)
);
router.get("/profit-loss", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getProfitAndLoss(req, res, next)
);
router.get("/profit-loss/by-period", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getProfitAndLossByPeriod(req, res, next)
);

// Accounting Periods
router.get("/period-control", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.getPeriodControl(req, res, next)
);
router.put("/period-control", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.setPeriodControl(req, res, next)
);
router.get("/periods", requirePermission("accounts.view"), (req, res, next) =>
  accountsController.listPeriods(req, res, next)
);
router.post("/periods", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.createPeriod(req, res, next)
);
router.post("/periods/:id/close", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.closePeriod(req, res, next)
);
router.post("/periods/:id/reopen", requirePermission("accounts.edit"), (req, res, next) =>
  accountsController.reopenPeriod(req, res, next)
);

export default router;
