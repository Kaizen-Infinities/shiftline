import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  listNotificationsSchema,
  notificationIdSchema,
  notificationsController,
} from "./notifications.controller";

/** /api/notifications: the signed-in user's own notices; no extra permission. */
const router = Router();

router.use(authMiddleware);
router.get(
  "/",
  validateMiddleware(listNotificationsSchema),
  asyncHandler(notificationsController.list)
);
router.post("/read-all", asyncHandler(notificationsController.markAllRead));
router.post(
  "/:id/read",
  validateMiddleware(notificationIdSchema),
  asyncHandler(notificationsController.markRead)
);

export default router;
