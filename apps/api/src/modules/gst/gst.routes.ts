import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  createHsnSchema,
  createRateSchema,
  gstController,
  hsnCodeParamSchema,
  hsnListSchema,
  idParamSchema,
  updateHsnSchema,
  updateRateSchema,
  validateGstinSchema,
} from "./gst.controller";

/** /api/gst: reference data, GST slabs and the HSN/SAC master (permission module gst_tax). */
const router = Router();
router.use(authMiddleware);

router.get("/states", asyncHandler(gstController.states));
router.post(
  "/validate-gstin",
  validateMiddleware(validateGstinSchema),
  asyncHandler(gstController.validateGstin)
);

router.get("/rates", requirePermission("gst_tax.view"), asyncHandler(gstController.listRates));
router.post(
  "/rates",
  requirePermission("gst_tax.create"),
  validateMiddleware(createRateSchema),
  asyncHandler(gstController.createRate)
);
router.put(
  "/rates/:id",
  requirePermission("gst_tax.edit"),
  validateMiddleware(updateRateSchema),
  asyncHandler(gstController.updateRate)
);
router.delete(
  "/rates/:id",
  requirePermission("gst_tax.delete"),
  validateMiddleware(idParamSchema),
  asyncHandler(gstController.deleteRate)
);

router.get(
  "/hsn",
  requirePermission("gst_tax.view"),
  validateMiddleware(hsnListSchema),
  asyncHandler(gstController.listHsn)
);
router.get(
  "/hsn/lookup/:code",
  requirePermission("gst_tax.view"),
  validateMiddleware(hsnCodeParamSchema),
  asyncHandler(gstController.lookupHsn)
);
router.post(
  "/hsn",
  requirePermission("gst_tax.create"),
  validateMiddleware(createHsnSchema),
  asyncHandler(gstController.createHsn)
);
router.put(
  "/hsn/:id",
  requirePermission("gst_tax.edit"),
  validateMiddleware(updateHsnSchema),
  asyncHandler(gstController.updateHsn)
);
router.delete(
  "/hsn/:id",
  requirePermission("gst_tax.delete"),
  validateMiddleware(idParamSchema),
  asyncHandler(gstController.deleteHsn)
);

export default router;
