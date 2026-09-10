import { Router } from "express";
import { productCapacityHistoryController } from "./product-capacity-history.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { productIdSchema, machineIdSchema } from "./product-capacity-history.validation";

import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

router.get(
  "/product/:productId",
  authMiddleware,
  requireFeature("production"),
  validateMiddleware(productIdSchema),
  productCapacityHistoryController.findByProduct
);

router.get(
  "/product/:productId/machine/:machineId",
  authMiddleware,
  requireFeature("production"),
  validateMiddleware(productIdSchema),
  validateMiddleware(machineIdSchema),
  productCapacityHistoryController.getLatestByProductAndMachine
);

router.post(
  "/manual",
  authMiddleware,
  requireFeature("production"),
  productCapacityHistoryController.manualChange
);

export default router;
