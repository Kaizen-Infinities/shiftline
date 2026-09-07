import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSuperAdmin } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  consoleController,
  deviceParam,
  tenantAuditSchema,
  tenantIdParam,
  updateTenantSchema,
} from "./console.controller";

/** /api/platform: the console's read-mostly view of the fleet and of one tenant (super admin). */
const router = Router();
router.use(authMiddleware, requireSuperAdmin());

router.get("/overview", asyncHandler(consoleController.overview));
router.get(
  "/tenants/:id",
  validateMiddleware(tenantIdParam),
  asyncHandler(consoleController.detail)
);
router.put(
  "/tenants/:id",
  validateMiddleware(updateTenantSchema),
  asyncHandler(consoleController.update)
);
router.get(
  "/tenants/:id/overrides",
  validateMiddleware(tenantIdParam),
  asyncHandler(consoleController.overrides)
);
router.get(
  "/tenants/:id/users",
  validateMiddleware(tenantIdParam),
  asyncHandler(consoleController.users)
);
router.get(
  "/tenants/:id/audit",
  validateMiddleware(tenantAuditSchema),
  asyncHandler(consoleController.audit)
);
router.get(
  "/tenants/:id/devices",
  validateMiddleware(tenantIdParam),
  asyncHandler(consoleController.devices)
);
router.post(
  "/tenants/:id/devices/:deviceId/revoke",
  validateMiddleware(deviceParam),
  asyncHandler(consoleController.revokeDevice)
);

export default router;
