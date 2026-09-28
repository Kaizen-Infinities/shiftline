import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { buyerAuditsService } from "./buyer-audits.service";
import {
  actionBody,
  cancelBody,
  createBody,
  findingBody,
  idParam,
  listQuery,
  ownersQuery,
  readinessQuery,
  updateActionBody,
  updateBody,
  updateFindingBody,
} from "./buyer-audits.validation";

/**
 * /api/buyer-audits (TN-08): buyer social-compliance audits, their findings and corrective
 * actions, and the readiness report. No DELETE: an audit is cancelled with a reason, and a
 * corrective action only moves forward.
 */
const router = Router();
router.use(authMiddleware, requireFeature("payroll"));
const actorOf = (req: Request) => ({ userId: req.user?.userId });

router.get(
  "/readiness",
  requirePermission("buyer-audits.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = readinessQuery.parse(req.query);
    res.json(new ApiResponse("Audit readiness", await buyerAuditsService.readiness(q)));
  })
);

router.get(
  "/readiness/export",
  requirePermission("buyer-audits.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = readinessQuery.parse(req.query);
    const { csv, fileName } = await buyerAuditsService.readinessCsv(q);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(csv);
  })
);

router.get(
  "/owners",
  requirePermission("buyer-audits.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = ownersQuery.parse(req.query);
    res.json(new ApiResponse("Action owners", await buyerAuditsService.owners(q.q)));
  })
);

router.get(
  "/",
  requirePermission("buyer-audits.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    res.json(new ApiResponse("Buyer audits", await buyerAuditsService.list(q)));
  })
);

router.post(
  "/",
  requirePermission("buyer-audits.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Audit planned", await buyerAuditsService.create(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("buyer-audits.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Buyer audit", await buyerAuditsService.get(idParam.parse(req.params.id)))
    );
  })
);

router.patch(
  "/:id",
  requirePermission("buyer-audits.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Audit updated",
        await buyerAuditsService.update(idParam.parse(req.params.id), body)
      )
    );
  })
);

router.post(
  "/:id/cancel",
  requirePermission("buyer-audits.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = cancelBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Audit cancelled",
        await buyerAuditsService.cancel(idParam.parse(req.params.id), body)
      )
    );
  })
);

router.post(
  "/:id/findings",
  requirePermission("buyer-audits.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = findingBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse(
          "Finding recorded",
          await buyerAuditsService.addFinding(idParam.parse(req.params.id), body)
        )
      );
  })
);

router.patch(
  "/:id/findings/:findingId",
  requirePermission("buyer-audits.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateFindingBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Finding updated",
        await buyerAuditsService.updateFinding(
          idParam.parse(req.params.id),
          idParam.parse(req.params.findingId),
          body
        )
      )
    );
  })
);

router.post(
  "/:id/findings/:findingId/actions",
  requirePermission("buyer-audits.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = actionBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse(
          "Corrective action added",
          await buyerAuditsService.addAction(
            idParam.parse(req.params.id),
            idParam.parse(req.params.findingId),
            body,
            actorOf(req)
          )
        )
      );
  })
);

router.patch(
  "/:id/actions/:actionId",
  requirePermission("buyer-audits.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateActionBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Corrective action updated",
        await buyerAuditsService.updateAction(
          idParam.parse(req.params.id),
          idParam.parse(req.params.actionId),
          body,
          actorOf(req)
        )
      )
    );
  })
);

export default router;
