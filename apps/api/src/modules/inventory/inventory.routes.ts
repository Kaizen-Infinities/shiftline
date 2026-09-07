import { Router } from "express";
import inventoryController from "./inventory.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { getEodStockSchema } from "./inventory.validation";

import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

/**
 * GET /api/inventory/eod-stock
 * Protected by authentication middleware and validated by Zod query schemas
 */
router.get(
  "/eod-stock",
  authMiddleware,
  requireFeature("inventory"),
  validateMiddleware(getEodStockSchema),
  inventoryController.getEodStock
);

/**
 * POST /api/inventory/eod-stock/run-now
 * Manual EOD snapshot trigger
 */
router.post(
  "/eod-stock/run-now",
  authMiddleware,
  requireFeature("inventory"),
  inventoryController.runNow
);

export default router;
