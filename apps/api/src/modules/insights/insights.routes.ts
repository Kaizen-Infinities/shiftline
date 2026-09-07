import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { insightsService, type Cached } from "./insights.service";

/**
 * /api/v1/insights (P1-05, B3): read-only, tenant-scoped aggregations for the companion app,
 * the TV wall and integrations. Cached 60 seconds per tenant; the headers say so.
 */
const router = Router();
router.use(authMiddleware, requirePermission("insights.view"));

const send = (res: Response, name: string, c: Cached<unknown>) => {
  res.setHeader("Cache-Control", `private, max-age=${c.ttl}`);
  res.setHeader("X-Cache", c.hit ? "HIT" : "MISS");
  res.json(new ApiResponse(name, c.value));
};

router.get(
  "/summary",
  asyncHandler(async (_req: Request, res: Response) =>
    send(res, "Summary", await insightsService.summary())
  )
);
router.get(
  "/accounts",
  asyncHandler(async (_req: Request, res: Response) =>
    send(res, "Accounts", await insightsService.accounts())
  )
);
router.get(
  "/ageing",
  asyncHandler(async (_req: Request, res: Response) =>
    send(res, "Ageing", await insightsService.ageing())
  )
);
router.get(
  "/field-team",
  asyncHandler(async (_req: Request, res: Response) =>
    send(res, "Field team", await insightsService.fieldTeam())
  )
);
router.get(
  "/plant",
  asyncHandler(async (_req: Request, res: Response) =>
    send(res, "Plant", await insightsService.plant())
  )
);
router.get(
  "/attention",
  asyncHandler(async (_req: Request, res: Response) =>
    send(res, "Attention", await insightsService.attention())
  )
);

export default router;
