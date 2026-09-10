import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireSuperAdmin } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { impersonationListSchema, impersonationService } from "./impersonation.service";

/** /api/platform/impersonations: history and the console-side stop (super admin only). */
const router = Router();
router.use(authMiddleware, requireSuperAdmin());

router.get(
  "/",
  validateMiddleware(impersonationListSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query as unknown as { companyId?: string; active?: string; limit: number };
    res.json(
      new ApiResponse(
        "Impersonation sessions",
        await impersonationService.list({
          companyId: q.companyId,
          active: q.active === undefined ? undefined : q.active === "true",
          limit: Number(q.limit) || 50,
        })
      )
    );
  })
);

const endSchema = z.object({ params: z.object({ id: z.string().uuid() }) });
router.post(
  "/:id/end",
  validateMiddleware(endSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await impersonationService.end(String(req.params.id), {
      adminUserId: req.user!.userId,
      reason: "ended by admin",
    });
    res.json(new ApiResponse("Impersonation ended", row));
  })
);

export default router;
