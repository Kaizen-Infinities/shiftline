import { Router } from "express";

import { createRole, getAllRoles, getRoleById, updateRole, deleteRole } from "./role.controller";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission, requireSuperAdmin } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";

import { createRoleSchema, updateRoleSchema } from "./role.validation";

const router = Router();

router.post(
  "/",
  authMiddleware,
  requirePermission("roles.create"),
  validateMiddleware(createRoleSchema),
  createRole
);

router.get("/", authMiddleware, requirePermission("roles.view"), getAllRoles);

router.get("/:id", authMiddleware, requirePermission("roles.view"), getRoleById);

// P1-09: the owner (roles.edit) sets names, status and each role's backdating allowance.
router.patch(
  "/:id",
  authMiddleware,
  requirePermission("roles.edit"),
  validateMiddleware(updateRoleSchema),
  updateRole
);

router.delete("/:id", authMiddleware, requireSuperAdmin(), deleteRole);

export default router;
