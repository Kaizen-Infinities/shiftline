import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { onboardingController } from "./onboarding.controller";
import {
  acceptTosSchema,
  bankStepSchema,
  companyStepSchema,
  financialYearStepSchema,
  gstStepSchema,
  usersStepSchema,
} from "./onboarding.types";

/**
 * /api/onboarding. Any signed-in member may read the state (the wizard page shows
 * colleagues that setup is still in progress); writing needs company-settings.edit.
 */
const router = Router();

router.use(authMiddleware);
router.get("/", asyncHandler(onboardingController.state));

router.use(requirePermission("company-settings.edit"));
router.put(
  "/company",
  validateMiddleware(companyStepSchema),
  asyncHandler(onboardingController.saveCompany)
);
router.put("/gst", validateMiddleware(gstStepSchema), asyncHandler(onboardingController.saveGst));
router.put(
  "/financial-year",
  validateMiddleware(financialYearStepSchema),
  asyncHandler(onboardingController.saveFinancialYear)
);
router.put(
  "/bank",
  validateMiddleware(bankStepSchema),
  asyncHandler(onboardingController.saveBank)
);
router.put(
  "/users",
  validateMiddleware(usersStepSchema),
  asyncHandler(onboardingController.saveUsers)
);
router.post(
  "/accept-tos",
  validateMiddleware(acceptTosSchema),
  asyncHandler(onboardingController.acceptTos)
);
router.post("/complete", asyncHandler(onboardingController.complete));

export default router;
