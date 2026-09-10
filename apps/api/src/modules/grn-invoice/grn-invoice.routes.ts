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
const router = Router();

router.post(
  "/",
  authMiddleware,
  requireFeature("purchase"),
  uploadInvoiceImage.single("invoiceImage"),
  validateMiddleware(createGrnInvoiceRequestSchema),
  grnInvoiceController.create
);

router.put(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  uploadInvoiceImage.single("invoiceImage"),
  validateMiddleware(updateGrnInvoiceRequestSchema),
  grnInvoiceController.update
);

router.get("/", authMiddleware, requireFeature("purchase"), grnInvoiceController.findAll);

router.get(
  "/next-code",
  authMiddleware,
  requireFeature("purchase"),
  grnInvoiceController.getNextCode
);

router.get(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(grnInvoiceIdRequestSchema),
  grnInvoiceController.findOne
);

router.put(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(updateGrnInvoiceRequestSchema),
  grnInvoiceController.update
);

router.delete(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(grnInvoiceIdRequestSchema),
  grnInvoiceController.delete
);

router.post(
  "/:id/cancel",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(grnInvoiceIdRequestSchema),
  grnInvoiceController.delete
);

export default router;
