import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { leaveService } from "./leave.service";
import {
  calendarQuery,
  createRequestBody,
  decisionBody,
  idParam,
  listRequestsQuery,
} from "./leave.validation";

/**
 * /api/leave (P2-09): dated leave requests with approval and a calendar, on top of the ledger
 * `labour.service.ts` keeps.
 */
const router = Router();
router.use(authMiddleware);
/** `canManage`: may act for other employees and cancel approved leave (leave.approve). */
const actorOf = (req: Request) => ({
  userId: req.user?.userId,
  canManage:
    !!req.user?.isSuperAdmin ||
    (Array.isArray(req.user?.permissions) && req.user.permissions.includes("leave.approve")),
});

router.get(
  "/requests",
  requirePermission("leave.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listRequestsQuery.parse(req.query);
    res.json(new ApiResponse("Leave requests", await leaveService.listRequests(q)));
  })
);

router.post(
  "/requests",
  requirePermission("leave.request"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createRequestBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse("Leave requested", await leaveService.createRequest(body, actorOf(req)))
      );
  })
);

router.post(
  "/requests/:id/approve",
  requirePermission("leave.approve"),
  asyncHandler(async (req: Request, res: Response) => {
    const { comments } = decisionBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Leave approved",
        await leaveService.approve(idParam.parse(req.params.id), actorOf(req), comments)
      )
    );
  })
);

router.post(
  "/requests/:id/reject",
  requirePermission("leave.approve"),
  asyncHandler(async (req: Request, res: Response) => {
    const { comments } = decisionBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Leave rejected",
        await leaveService.reject(idParam.parse(req.params.id), actorOf(req), comments)
      )
    );
  })
);

router.post(
  "/requests/:id/cancel",
  requirePermission("leave.request"),
  asyncHandler(async (req: Request, res: Response) => {
    const { comments } = decisionBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Leave cancelled",
        await leaveService.cancel(idParam.parse(req.params.id), actorOf(req), comments)
      )
    );
  })
);

router.get(
  "/calendar",
  requirePermission("leave.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = calendarQuery.parse(req.query);
    res.json(
      new ApiResponse("Leave calendar", await leaveService.calendar(q.month, q.departmentId))
    );
  })
);

router.get(
  "/me",
  requirePermission("leave.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) throw new ApiError(401, "Unauthorized");
    res.json(new ApiResponse("Your leave", await leaveService.me(userId)));
  })
);

export default router;
