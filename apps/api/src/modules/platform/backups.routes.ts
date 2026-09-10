import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSuperAdmin } from "../../middleware/permission.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { backupsController } from "./backups.controller";

/** /api/platform/backups — platform administration only (no tenant scope). */
const router = Router();
router.use(authMiddleware, requireSuperAdmin());

router.get("/", asyncHandler(backupsController.list));
router.post("/run", asyncHandler(backupsController.run));

export default router;
