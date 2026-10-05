import { Router } from "express";
import productShiftRecordController from "./product-shift-record.controller";
import { createRecordSchema, productIdSchema } from "./product-shift-record.validation";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { authMiddleware } from "../../middleware/auth.middleware";

import { requireAnyPermission, requirePermission } from "../../middleware/permission.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

router.post(
  "/",
  authMiddleware,
  requireFeature("production"),
  requirePermission("shift-execution.edit"),
  validateMiddleware(createRecordSchema),
  productShiftRecordController.create
);
router.get(
  "/product/:productId",
  authMiddleware,
  requireFeature("production"),
  requireAnyPermission("shift-execution.view", "machines.view"),
  validateMiddleware(productIdSchema),
  productShiftRecordController.findByProduct
);

export default router;
