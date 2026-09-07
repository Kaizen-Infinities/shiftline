import { Router } from "express";
import { expenseController } from "./expense.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import {
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdRequestSchema,
  rejectExpenseSchema,
} from "./expense.validation";
import { requirePermission } from "../../middleware/permission.middleware";

import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

router.post(
  "/",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.create"),
  validateMiddleware(createExpenseSchema),
  expenseController.create
);

router.get(
  "/",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.view"),
  expenseController.findAll
);

router.get(
  "/next-code",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.create"),
  expenseController.getNextCode
);

router.get(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.view"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.findOne
);

router.put(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.edit"),
  validateMiddleware(expenseIdRequestSchema),
  validateMiddleware(updateExpenseSchema),
  expenseController.update
);

router.delete(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.delete"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.delete
);

router.post(
  "/:id/cancel",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.delete"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.delete
);

// Expense claims (P1-10d): submit → approve (posts the voucher) or reject with a reason.
router.post(
  "/:id/submit",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.edit"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.submit
);
router.post(
  "/:id/approve",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.approve"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.approve
);
router.post(
  "/:id/reject",
  authMiddleware,
  requireFeature("purchase"),
  requirePermission("expenses.approve"),
  validateMiddleware(expenseIdRequestSchema),
  validateMiddleware(rejectExpenseSchema),
  expenseController.reject
);

export default router;
