import { Router } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { documentsController } from "./documents.controller";

/** Document numbering (P1-08): forms show the number a save would take. */
const router = Router();
router.use(authMiddleware);

router.get("/next-number", asyncHandler(documentsController.nextNumber));

export default router;
