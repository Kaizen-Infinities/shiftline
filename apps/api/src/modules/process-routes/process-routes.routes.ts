import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { processRoutesService as svc } from "./process-routes.service";
import {
  cancelLotBody,
  challanOptionsQuery,
  createLotBody,
  createRouteBody,
  idParam,
  lotListQuery,
  movementBody,
  replaceStepsBody,
  routeListQuery,
  updateRouteBody,
} from "./process-routes.validation";

const actorOf = (req: Request) => ({ userId: req.user?.userId });
const idOf = (req: Request, key = "id") => idParam.parse(req.params[key]);

/**
 * /api/process-routes (TN-06): the route master. A route with lots on it is never deleted
 * (deactivate it) and its steps are fixed.
 */
const router = Router();
router.use(authMiddleware, requireFeature("production"));

router.get(
  "/options",
  requirePermission("process-routes.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Process route options", await svc.options()));
  })
);

router.get(
  "/",
  requirePermission("process-routes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Process routes", await svc.listRoutes(routeListQuery.parse(req.query)))
    );
  })
);

router.post(
  "/",
  requirePermission("process-routes.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createRouteBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Process route created", await svc.createRoute(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("process-routes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Process route", await svc.getRoute(idOf(req))));
  })
);

router.patch(
  "/:id",
  requirePermission("process-routes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateRouteBody.parse(req.body);
    res.json(new ApiResponse("Process route updated", await svc.updateRoute(idOf(req), body)));
  })
);

router.put(
  "/:id/steps",
  requirePermission("process-routes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = replaceStepsBody.parse(req.body);
    res.json(new ApiResponse("Route steps saved", await svc.replaceSteps(idOf(req), body)));
  })
);

router.delete(
  "/:id",
  requirePermission("process-routes.delete"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Process route deleted", await svc.removeRoute(idOf(req))));
  })
);

/** /api/process-lots (TN-06): lots on a route, their movements and the lot board. */
export const lotsRouter = Router();
lotsRouter.use(authMiddleware, requireFeature("production"));

lotsRouter.get(
  "/board",
  requirePermission("process-routes.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Lot board", await svc.board()));
  })
);

lotsRouter.get(
  "/challan-options",
  requirePermission("process-routes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = challanOptionsQuery.parse(req.query);
    res.json(new ApiResponse("Job-work challans", await svc.challanOptions(q)));
  })
);

lotsRouter.get(
  "/",
  requirePermission("process-routes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Lots", await svc.listLots(lotListQuery.parse(req.query))));
  })
);

lotsRouter.post(
  "/",
  requirePermission("process-routes.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createLotBody.parse(req.body);
    res.status(201).json(new ApiResponse("Lot created", await svc.createLot(body, actorOf(req))));
  })
);

lotsRouter.get(
  "/:id",
  requirePermission("process-routes.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Lot", await svc.getLot(idOf(req))));
  })
);

lotsRouter.post(
  "/:id/movements",
  requirePermission("process-routes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = movementBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse("Movement recorded", await svc.addMovement(idOf(req), body, actorOf(req)))
      );
  })
);

lotsRouter.delete(
  "/:id/movements/:movementId",
  requirePermission("process-routes.delete"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Movement taken back",
        await svc.undoMovement(idOf(req), idOf(req, "movementId"))
      )
    );
  })
);

lotsRouter.post(
  "/:id/close",
  requirePermission("process-routes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Lot closed", await svc.closeLot(idOf(req))));
  })
);

lotsRouter.post(
  "/:id/cancel",
  requirePermission("process-routes.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = cancelLotBody.parse(req.body);
    res.json(new ApiResponse("Lot cancelled", await svc.cancelLot(idOf(req), body)));
  })
);

export default router;
