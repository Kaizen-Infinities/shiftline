import { Router } from "express";
import { productCapacityHistoryController } from "./product-capacity-history.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import {
  productIdSchema,
  machineIdSchema,
  manualCapacitySchema,
} from "./product-capacity-history.validation";

import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

router.get(
  "/product/:productId",
  authMiddleware,
  requireFeature("production"),
  requirePermission("products.view"),
  validateMiddleware(productIdSchema),
  productCapacityHistoryController.findByProduct
);

router.get(
  "/product/:productId/machine/:machineId",
  authMiddleware,
  requireFeature("production"),
  requirePermission("products.view"),
  validateMiddleware(productIdSchema),
  validateMiddleware(machineIdSchema),
  productCapacityHistoryController.getLatestByProductAndMachine
);

router.post(
  "/manual",
  authMiddleware,
  requireFeature("production"),
  requirePermission("products.edit"),
  validateMiddleware(manualCapacitySchema),
  productCapacityHistoryController.manualChange
);

export default router;
