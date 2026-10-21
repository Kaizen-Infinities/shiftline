import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  invitationController,
  invitationIdSchema,
  invitationTokenSchema,
} from "./invitation.controller";

/**
 * /api/invitations. The two token routes are public (the invitee has no account
 * yet); everything else needs `users.create`.
 */
const router = Router();

router.get(
  "/token/:token",
  validateMiddleware(invitationTokenSchema),
  asyncHandler(invitationController.preview)
);
router.post(
  "/token/:token/accept",
  validateMiddleware(acceptInvitationSchema),
  asyncHandler(invitationController.accept)
);

router.use(authMiddleware);
router.get("/", requirePermission("users.view"), asyncHandler(invitationController.list));
router.get(
  "/roles",
  requirePermission("users.create"),
  asyncHandler(invitationController.assignableRoles)
);
router.post(
  "/",
  requirePermission("users.create"),
  validateMiddleware(createInvitationSchema),
  asyncHandler(invitationController.create)
);
router.post(
  "/:id/resend",
  requirePermission("users.create"),
  validateMiddleware(invitationIdSchema),
  asyncHandler(invitationController.resend)
);
router.post(
  "/:id/revoke",
  requirePermission("users.create"),
  validateMiddleware(invitationIdSchema),
  asyncHandler(invitationController.revoke)
);

export default router;
