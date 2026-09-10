import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { yearEndController } from "./year-end.controller";

/** Year-end closing (P1-09e): prepare, approve, reverse. */
const router = Router();
router.use(authMiddleware);

router.get("/", requirePermission("year-end.view"), asyncHandler(yearEndController.list));
router.get("/preview", requirePermission("year-end.view"), asyncHandler(yearEndController.preview));
router.post(
  "/prepare",
  requirePermission("year-end.prepare"),
  asyncHandler(yearEndController.prepare)
);
router.post(
  "/:id/approve",
  requirePermission("year-end.approve"),
  asyncHandler(yearEndController.approve)
);
router.post(
  "/:id/reverse",
  requirePermission("year-end.approve"),
  asyncHandler(yearEndController.reverse)
);
router.post(
  "/:id/discard",
  requirePermission("year-end.prepare"),
  asyncHandler(yearEndController.discard)
);

export default router;
