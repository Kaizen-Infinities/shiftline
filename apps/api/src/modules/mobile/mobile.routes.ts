/**
 * /api/mobile — endpoints used by the Shiftline Field (sales executive) app.
 *
 * Permissions (registered in packages/shared):
 *   mobile-app.view    – read: bootstrap, pull, customer statement
 *   mobile-app.create  – write: push, positions, attachments, cheque OCR
 *   mobile-app.manage  – office: routes, planning, collections, devices
 *
 * Writes identify their device with `x-device-id` (see mobile.types.ts).
 */
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireAnyPermission, requirePermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import { uploadMobileAttachment } from "./mobile.attachment.service";
import { mobileController } from "./mobile.controller";

const router = Router();

router.use(authMiddleware);

/** Turns multer's errors (size, type) into 4xx ApiErrors instead of 500s. */
const upload = (field: string) => (req: Request, res: Response, next: NextFunction) =>
  uploadMobileAttachment.single(field)(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new ApiError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.message));
    }
    next(err);
  });

// ─── Device ──────────────────────────────────────────────────────────────────
router.get("/bootstrap", requirePermission("mobile-app.view"), mobileController.bootstrap);
router.get("/sync/pull", requirePermission("mobile-app.view"), mobileController.pull);
router.post("/sync/push", requirePermission("mobile-app.create"), mobileController.push);
router.post("/position", requirePermission("mobile-app.create"), mobileController.positions);
router.post(
  "/attachments",
  requirePermission("mobile-app.create"),
  upload("file"),
  mobileController.uploadAttachment
);
router.post(
  "/ocr/cheque",
  requirePermission("mobile-app.create"),
  upload("image"),
  mobileController.chequeOcr
);
router.get(
  "/customers/:id/statement",
  requirePermission("mobile-app.view"),
  mobileController.customerStatement
);

// ─── Office / admin ──────────────────────────────────────────────────────────
router.get(
  "/admin/positions",
  requireAnyPermission("mobile-app.manage", "dash-overview.view"),
  mobileController.latestPositions
);
router.get("/admin/devices", requirePermission("mobile-app.manage"), mobileController.listDevices);
router.post(
  "/admin/devices/:id/revoke",
  requirePermission("mobile-app.manage"),
  mobileController.revokeDevice
);
router.post(
  "/admin/devices/:id/restore",
  requirePermission("mobile-app.manage"),
  mobileController.restoreDevice
);
router.get("/admin/agents", requirePermission("mobile-app.manage"), mobileController.listAgents);
router.get("/admin/routes", requirePermission("mobile-app.manage"), mobileController.listRoutes);
router.post("/admin/routes", requirePermission("mobile-app.manage"), mobileController.createRoute);
router.put(
  "/admin/routes/:id/customers",
  requirePermission("mobile-app.manage"),
  mobileController.setRouteCustomers
);
router.put(
  "/admin/routes/:id/assignments",
  requirePermission("mobile-app.manage"),
  mobileController.setRouteAssignments
);
router.get("/admin/visits", requirePermission("mobile-app.manage"), mobileController.listVisits);
router.post("/admin/visits", requirePermission("mobile-app.manage"), mobileController.planVisits);
router.get(
  "/admin/collections",
  requirePermission("mobile-app.manage"),
  mobileController.listCollections
);
router.post(
  "/admin/collections/:id/repost",
  requirePermission("mobile-app.manage"),
  mobileController.repostCollection
);

export default router;
