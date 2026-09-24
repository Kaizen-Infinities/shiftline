import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { deliveryScheduleService as svc } from "./delivery-schedules.service";
import {
  addLinesBody,
  adherenceQuery,
  createScheduleBody,
  dispatchBody,
  dueQuery,
  idParam,
  listQuery,
  updateLineBody,
  updateScheduleBody,
} from "./delivery-schedules.validation";

/**
 * /api/delivery-schedules (TN-02): OEM delivery schedules, dispatches against their lines, the
 * dispatch planner's due list and the adherence / OTIF rating.
 */
const router = Router();
router.use(authMiddleware);
router.use(requireFeature("sales"));
const actorOf = (req: Request) => ({ userId: req.user?.userId });

// Static paths first so "/due" and "/adherence" never match "/:id".
router.get(
  "/due",
  requirePermission("delivery-schedules.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = dueQuery.parse(req.query);
    res.json(new ApiResponse("Schedule lines due", await svc.due(q.days, q.asOf)));
  })
);

router.get(
  "/adherence",
  requirePermission("delivery-schedules.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = adherenceQuery.parse(req.query);
    res.json(new ApiResponse("Schedule adherence", await svc.adherence(q)));
  })
);

router.patch(
  "/lines/:lineId",
  requirePermission("delivery-schedules.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateLineBody.parse(req.body);
    res.json(
      new ApiResponse("Line updated", await svc.updateLine(idParam.parse(req.params.lineId), body))
    );
  })
);

router.delete(
  "/lines/:lineId",
  requirePermission("delivery-schedules.delete"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Line removed", await svc.deleteLine(idParam.parse(req.params.lineId)))
    );
  })
);

router.post(
  "/lines/:lineId/dispatches",
  requirePermission("delivery-schedules.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = dispatchBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse(
          "Dispatch recorded",
          await svc.addDispatch(idParam.parse(req.params.lineId), body, actorOf(req))
        )
      );
  })
);

router.delete(
  "/dispatches/:dispatchId",
  requirePermission("delivery-schedules.delete"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Dispatch removed",
        await svc.deleteDispatch(idParam.parse(req.params.dispatchId))
      )
    );
  })
);

router.get(
  "/",
  requirePermission("delivery-schedules.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    res.json(new ApiResponse("Delivery schedules", await svc.list(q)));
  })
);

router.post(
  "/",
  requirePermission("delivery-schedules.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createScheduleBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Delivery schedule created", await svc.create(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("delivery-schedules.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Delivery schedule", await svc.get(idParam.parse(req.params.id))));
  })
);

router.patch(
  "/:id",
  requirePermission("delivery-schedules.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateScheduleBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Delivery schedule updated",
        await svc.update(idParam.parse(req.params.id), body)
      )
    );
  })
);

router.post(
  "/:id/lines",
  requirePermission("delivery-schedules.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const { lines } = addLinesBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse("Lines added", await svc.addLines(idParam.parse(req.params.id), lines))
      );
  })
);

export default router;
