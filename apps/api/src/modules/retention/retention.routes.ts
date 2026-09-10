import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { retentionController } from "./retention.controller";
import { listSweepsSchema, runSweepSchema, upsertPolicySchema } from "./retention.validation";

const router = Router();
router.use(authMiddleware);

router.get(
  "/policies",
  requirePermission("retention.view"),
  asyncHandler(retentionController.listPolicies)
);
router.put(
  "/policies/:dataClass",
  requirePermission("retention.edit"),
  validateMiddleware(upsertPolicySchema),
  asyncHandler(retentionController.upsertPolicy)
);
router.get(
  "/sweeps",
  requirePermission("retention.view"),
  validateMiddleware(listSweepsSchema),
  asyncHandler(retentionController.listSweeps)
);
router.post(
  "/sweeps",
  requirePermission("retention.edit"),
  validateMiddleware(runSweepSchema),
  asyncHandler(retentionController.runSweep)
);

export default router;
