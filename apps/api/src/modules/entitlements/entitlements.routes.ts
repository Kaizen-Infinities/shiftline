import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/ApiResponse";
import { entitlementService } from "./entitlement.service";

/** /api/entitlements: the caller's own plan, features, seats and status. */
const router = Router();
router.use(authMiddleware);
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(new ApiResponse("Entitlements", await entitlementService.resolve()));
  })
);

export default router;
