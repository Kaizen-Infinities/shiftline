import { Router } from "express";
import { expenseController } from "./expense.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import {
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdRequestSchema,
} from "./expense.validation";

import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

router.post(
  "/",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(createExpenseSchema),
  expenseController.create
);

router.get("/", authMiddleware, requireFeature("purchase"), expenseController.findAll);

router.get("/next-code", authMiddleware, requireFeature("purchase"), expenseController.getNextCode);

router.get(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.findOne
);

router.put(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(expenseIdRequestSchema),
  validateMiddleware(updateExpenseSchema),
  expenseController.update
);

router.delete(
  "/:id",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.delete
);

router.post(
  "/:id/cancel",
  authMiddleware,
  requireFeature("purchase"),
  validateMiddleware(expenseIdRequestSchema),
  expenseController.delete
);

export default router;
