import { Router } from "express";
import salesInvoiceController from "./sales-invoice.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import {
  createSalesInvoiceRequestSchema,
  updateSalesInvoiceRequestSchema,
  salesInvoiceIdRequestSchema,
  recordReceiptRequestSchema,
} from "./sales-invoice.validation";

const router = Router();

router.post(
  "/",
  authMiddleware,
  requirePermission("sales-invoices.create"),
  validateMiddleware(createSalesInvoiceRequestSchema),
  salesInvoiceController.create
);

router.get(
  "/",
  authMiddleware,
  requirePermission("sales-invoices.view"),
  salesInvoiceController.findAll
);

router.get(
  "/:id",
  authMiddleware,
  requirePermission("sales-invoices.view"),
  validateMiddleware(salesInvoiceIdRequestSchema),
  salesInvoiceController.findOne
);

router.put(
  "/:id",
  authMiddleware,
  requirePermission("sales-invoices.edit"),
  validateMiddleware(updateSalesInvoiceRequestSchema),
  salesInvoiceController.update
);

router.delete(
  "/:id",
  authMiddleware,
  requirePermission("sales-invoices.delete"),
  validateMiddleware(salesInvoiceIdRequestSchema),
  salesInvoiceController.delete
);

router.post(
  "/:id/cancel",
  authMiddleware,
  requirePermission("sales-invoices.delete"),
  validateMiddleware(salesInvoiceIdRequestSchema),
  salesInvoiceController.delete
);

router.post(
  "/:id/email-invoice",
  authMiddleware,
  requirePermission("sales-invoices.whatsapp-email"),
  validateMiddleware(salesInvoiceIdRequestSchema),
  salesInvoiceController.emailInvoice
);
router.post(
  "/:id/whatsapp-invoice",
  authMiddleware,
  requirePermission("sales-invoices.whatsapp-email"),
  validateMiddleware(salesInvoiceIdRequestSchema),
  salesInvoiceController.whatsappInvoice
);

// P2-12: a receipt recorded by hand against a sales invoice (cash/bank/cheque, with a
// settlement rate for a foreign-currency invoice). Gated by the same permission as editing the
// invoice itself, by analogy with how a GRN invoice's payments array is gated by the purchase
// module's edit access.
router.post(
  "/:id/receipts",
  authMiddleware,
  requirePermission("sales-invoices.edit"),
  validateMiddleware(recordReceiptRequestSchema),
  salesInvoiceController.recordReceipt
);

router.get(
  "/:id/receipts",
  authMiddleware,
  requirePermission("sales-invoices.view"),
  validateMiddleware(salesInvoiceIdRequestSchema),
  salesInvoiceController.listReceipts
);

export default router;
