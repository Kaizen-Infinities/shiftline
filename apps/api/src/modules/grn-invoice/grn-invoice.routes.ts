import { Router } from "express";
import grnInvoiceController from "./grn-invoice.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import {
  createGrnInvoiceRequestSchema,
  updateGrnInvoiceRequestSchema,
  grnInvoiceIdRequestSchema,
} from "./grn-invoice.validation";
import { uploadInvoiceImage } from "../../middleware/upload.middleware";

import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
const router = Router();

router.post(
  "/",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("invoice.create"),
  uploadInvoiceImage.single("invoiceImage"),
  validateMiddleware(createGrnInvoiceRequestSchema),
  grnInvoiceController.create
);

router.get(
  "/",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("invoice.view"),
  grnInvoiceController.findAll
);

router.get(
  "/next-code",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("invoice.view"),
  grnInvoiceController.getNextCode
);

router.get(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("invoice.view"),
  validateMiddleware(grnInvoiceIdRequestSchema),
  grnInvoiceController.findOne
);

router.put(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("invoice.edit"),
  uploadInvoiceImage.single("invoiceImage"),
  validateMiddleware(updateGrnInvoiceRequestSchema),
  grnInvoiceController.update
);

router.delete(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("invoice.delete"),
  validateMiddleware(grnInvoiceIdRequestSchema),
  grnInvoiceController.delete
);

router.post(
  "/:id/cancel",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("invoice.delete"),
  validateMiddleware(grnInvoiceIdRequestSchema),
  grnInvoiceController.delete
);

export default router;
