import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { orderTnaService } from "./order-tna.service";
import {
  addMilestoneBody,
  alertsQuery,
  createBody,
  idParam,
  listQuery,
  updateBody,
  updateMilestoneBody,
} from "./order-tna.validation";

/**
 * /api/order-tna (TN-03): export order time-and-action calendar. No DELETE: an order is
 * cancelled by setting `status CANCELLED`.
 */
const router = Router();
router.use(authMiddleware, requireFeature("production"));
const actorOf = (req: Request) => ({ userId: req.user?.userId });

router.get(
  "/templates",
  requirePermission("order-tna.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("T&A templates", orderTnaService.templates()));
  })
);

router.get(
  "/alerts",
  requirePermission("order-tna.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = alertsQuery.parse(req.query);
    res.json(new ApiResponse("T&A alerts", await orderTnaService.alerts(q)));
  })
);

router.get(
  "/",
  requirePermission("order-tna.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    res.json(new ApiResponse("T&A plans", await orderTnaService.list(q)));
  })
);

router.post(
  "/",
  requirePermission("order-tna.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("T&A plan created", await orderTnaService.create(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("order-tna.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("T&A plan", await orderTnaService.get(idParam.parse(req.params.id))));
  })
);

router.patch(
  "/:id",
  requirePermission("order-tna.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateBody.parse(req.body);
    res.json(
      new ApiResponse(
        "T&A plan updated",
        await orderTnaService.update(idParam.parse(req.params.id), body)
      )
    );
  })
);

router.post(
  "/:id/milestones",
  requirePermission("order-tna.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = addMilestoneBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse(
          "Milestone added",
          await orderTnaService.addMilestone(idParam.parse(req.params.id), body)
        )
      );
  })
);

router.patch(
  "/:id/milestones/:milestoneId",
  requirePermission("order-tna.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateMilestoneBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Milestone updated",
        await orderTnaService.updateMilestone(
          idParam.parse(req.params.id),
          idParam.parse(req.params.milestoneId),
          body
        )
      )
    );
  })
);

export default router;
