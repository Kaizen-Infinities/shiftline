import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import shiftExecutionController from "./shift-execution.controller";
import { supervisorOverrideSchema } from "./shift-execution.validation";

const router = Router();

/**
 * Supervisor override for the shift console: the operator's session asks, a supervisor
 * vouches with their own credentials, and the server decides.
 */
router.post(
  "/supervisor-override",
  authMiddleware,
  requirePermission("shift-execution.edit"),
  validateMiddleware(supervisorOverrideSchema),
  shiftExecutionController.supervisorOverride
);

export default router;
