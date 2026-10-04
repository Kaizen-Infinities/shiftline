import { Router } from "express";
import dashboardController from "./dashboard.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireAnyPermission } from "../../middleware/permission.middleware";

const router = Router();

// Every dashboard widget has its own key (see "Dashboard Widgets" in the permission registry).
// /summary feeds all of them, so any widget key opens it.
const DASHBOARD_WIDGET_KEYS = [
  "dash-overview.view",
  "dash-trend.view",
  "dash-tasks.view",
  "dash-inventory.view",
  "dash-machines.view",
  "dash-top-products.view",
  "dash-recent-sales.view",
] as const;

router.get(
  "/summary",
  authMiddleware,
  requireAnyPermission(...DASHBOARD_WIDGET_KEYS),
  dashboardController.getSummary
);

// Bank and cash balances, receivables, payables: accounts-level data. Needs the books, not
// just a dashboard widget.
router.get(
  "/accounts-summary",
  authMiddleware,
  requireAnyPermission("accounts.view", "vouchers.view"),
  dashboardController.getAccountsSummary
);

// The management TV wall aggregates sales, plant and finance; `insights.view` is the key the
// registry describes as covering the TV wall.
router.get(
  "/tv-summary",
  authMiddleware,
  requireAnyPermission("insights.view"),
  dashboardController.getTvSummary
);

export default router;
