import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSuperAdmin } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { plansController, updatePlanSchema } from "./plans.controller";

/** /api/platform/plans (super admin): catalogue and per-plan edits. */
const router = Router();
router.use(authMiddleware, requireSuperAdmin());
router.get("/", asyncHandler(plansController.list));
router.put("/:code", validateMiddleware(updatePlanSchema), asyncHandler(plansController.update));

export default router;
