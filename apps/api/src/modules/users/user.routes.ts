import { Router } from "express";

import {
  createUser,
  getProfile,
  updateProfile,
  getAllUsers,
  getUserById,
  updateUserStatus,
  checkUsername,
  updateMyLocale,
} from "./user.controller";
import { createUserSchema, updateMyLocaleSchema } from "./user.validation";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";

const router = Router();

/*
|--------------------------------------------------------------------------
| Profile Routes
|--------------------------------------------------------------------------
*/

router.get("/profile", authMiddleware, getProfile);

router.patch("/profile", authMiddleware, updateProfile);

// TN-04: every signed-in user may set their own UI language; no permission beyond being
// signed in, like the profile routes above. The target is always the token's user.
router.patch(
  "/me/locale",
  authMiddleware,
  validateMiddleware(updateMyLocaleSchema),
  updateMyLocale
);

/*
|--------------------------------------------------------------------------
| User Management Routes
|--------------------------------------------------------------------------
*/

router.post(
  "/",
  authMiddleware,
  requirePermission("users.create"),
  validateMiddleware(createUserSchema),
  createUser
);

router.get("/", authMiddleware, requirePermission("users.view"), getAllUsers);

router.get("/check-username/:username", authMiddleware, checkUsername);

router.get("/:id", authMiddleware, requirePermission("users.view"), getUserById);

router.patch("/:id/status", authMiddleware, requirePermission("users.edit"), updateUserStatus);

export default router;
