import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { auditTrailController } from "./audit-trail.controller";

/** Audit trail viewer (P1-09d): read-only, per tenant. */
const router = Router();
router.use(authMiddleware);

router.get("/", requirePermission("audit-reports.view"), asyncHandler(auditTrailController.list));
router.get(
  "/filters",
  requirePermission("audit-reports.view"),
  asyncHandler(auditTrailController.filters)
);
router.get(
  "/export",
  requirePermission("audit-reports.export"),
  asyncHandler(auditTrailController.exportCsv)
);

export default router;
