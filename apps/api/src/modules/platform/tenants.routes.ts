import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSuperAdmin } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { createTenantSchema, tenantsController } from "./tenants.controller";

/** /api/platform/tenants — platform administration only (no tenant scope). */
const router = Router();
router.use(authMiddleware, requireSuperAdmin());

router.get("/", asyncHandler(tenantsController.list));
router.post("/", validateMiddleware(createTenantSchema), asyncHandler(tenantsController.create));

export default router;
