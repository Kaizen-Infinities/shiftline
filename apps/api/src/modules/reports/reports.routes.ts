import { Router } from "express";
import reportsController from "./reports.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import {
  dateRangeQuerySchema,
  productionOrderReportSchema,
  purchaseOrderReportQuerySchema,
  salesOrderReportQuerySchema,
} from "./reports.validation";

const router = Router();

// "reports.view" was never a registered permission key, so every one of these routes answered 403
// to everybody, the owner included. The keys below are the registered ones the report screens
// already gate their menu entries on.

/**
 * Machine Status & Efficiency Report
 */
router.get(
  "/machines",
  authMiddleware,
  requirePermission("production-reports.view"),
  validateMiddleware(dateRangeQuerySchema),
  reportsController.getMachineReport
);

/**
 * Weekly Program Progress Report
 */
router.get(
  "/weekly-programs",
  authMiddleware,
  requirePermission("production-reports.view"),
  validateMiddleware(dateRangeQuerySchema),
  reportsController.getWeeklyProgramReport
);

/**
 * Production Order Detail & Hourly Logs Report
 */
router.get(
  "/production-orders/:productionOrderId",
  authMiddleware,
  requirePermission("production-reports.view"),
  validateMiddleware(productionOrderReportSchema),
  reportsController.getProductionOrderReport
);

/**
 * Sales Order Report
 */
router.get(
  "/sales-orders",
  authMiddleware,
  requirePermission("sales-reports.view"),
  validateMiddleware(salesOrderReportQuerySchema),
  reportsController.getSalesOrderReport
);

/**
 * Purchase Order Report
 */
router.get(
  "/purchase-orders",
  authMiddleware,
  requirePermission("purchase-reports.view"),
  validateMiddleware(purchaseOrderReportQuerySchema),
  reportsController.getPurchaseOrderReport
);

export default router;
