import { Router } from "express";
import productShiftRecordController from "./product-shift-record.controller";
import { createRecordSchema, productIdSchema } from "./product-shift-record.validation";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { authMiddleware } from "../../middleware/auth.middleware";

import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

router.post(
  "/",
  authMiddleware,
  requireFeature("production"),
  validateMiddleware(createRecordSchema),
  productShiftRecordController.create
);
router.get(
  "/product/:productId",
  authMiddleware,
  requireFeature("production"),
  validateMiddleware(productIdSchema),
  productShiftRecordController.findByProduct
);

export default router;
