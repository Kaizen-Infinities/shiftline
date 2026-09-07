import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  importTypeSchema,
  importsController,
  requireImportPermission,
  runImportSchema,
  uploadCsv,
} from "./imports.controller";

/** /api/imports: CSV templates, dry-run validation and import per master type. */
const router = Router();

router.use(authMiddleware);
router.get("/types", asyncHandler(importsController.types));
router.get(
  "/templates/:type",
  validateMiddleware(importTypeSchema),
  requireImportPermission,
  asyncHandler(importsController.template)
);
router.post(
  "/:type",
  validateMiddleware(importTypeSchema),
  requireImportPermission,
  uploadCsv,
  validateMiddleware(runImportSchema),
  asyncHandler(importsController.run)
);

export default router;
