import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSuperAdmin } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createTenantSchema,
  overrideDeleteSchema,
  overrideSchema,
  tenantIdSchema,
  tenantsController,
  updateSubscriptionSchema,
} from "./tenants.controller";

/** /api/platform/tenants — platform administration only (no tenant scope). */
const router = Router();
router.use(authMiddleware, requireSuperAdmin());

router.get("/", asyncHandler(tenantsController.list));
router.post("/", validateMiddleware(createTenantSchema), asyncHandler(tenantsController.create));
router.get(
  "/:id/subscription",
  validateMiddleware(tenantIdSchema),
  asyncHandler(tenantsController.subscription)
);
router.put(
  "/:id/subscription",
  validateMiddleware(updateSubscriptionSchema),
  asyncHandler(tenantsController.updateSubscription)
);
router.put(
  "/:id/overrides/:feature",
  validateMiddleware(overrideSchema),
  asyncHandler(tenantsController.setOverride)
);
router.delete(
  "/:id/overrides/:feature",
  validateMiddleware(overrideDeleteSchema),
  asyncHandler(tenantsController.removeOverride)
);

export default router;
