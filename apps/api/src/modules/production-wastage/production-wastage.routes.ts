import { Router } from "express";
import productionWastageController from "./production-wastage.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import {
  createProductionWastageSchema,
  updateProductionWastageSchema,
  getProductionWastageIdSchema,
} from "./production-wastage.validation";

const router = Router();

router.post(
  "/",
  authMiddleware,
  requirePermission("production-wastages.create"),
  validateMiddleware(createProductionWastageSchema),
  productionWastageController.create
);

router.get(
  "/",
  authMiddleware,
  requirePermission("production-wastages.view"),
  productionWastageController.findAll
);

router.get(
  "/:id",
  authMiddleware,
  requirePermission("production-wastages.view"),
  validateMiddleware(getProductionWastageIdSchema),
  productionWastageController.findById
);

router.put(
  "/:id",
  authMiddleware,
  requirePermission("production-wastages.edit"),
  validateMiddleware(updateProductionWastageSchema),
  productionWastageController.update
);

router.delete(
  "/:id",
  authMiddleware,
  requirePermission("production-wastages.delete"),
  validateMiddleware(getProductionWastageIdSchema),
  productionWastageController.delete
);

router.post(
  "/:id/approve",
  authMiddleware,
  requirePermission("production-wastages.edit"),
  validateMiddleware(getProductionWastageIdSchema),
  productionWastageController.approve
);

router.post(
  "/:id/reject",
  authMiddleware,
  requirePermission("production-wastages.edit"),
  validateMiddleware(getProductionWastageIdSchema),
  productionWastageController.reject
);

export default router;
