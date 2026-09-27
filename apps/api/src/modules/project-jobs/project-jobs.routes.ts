import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { projectJobsService } from "./project-jobs.service";
import {
  addBillingBody,
  addCostBody,
  addStageBody,
  createBody,
  idParam,
  listQuery,
  postCostsBody,
  reorderBody,
  updateBody,
  updateStageBody,
} from "./project-jobs.validation";

/**
 * /api/project-jobs (TN-09): job / project costing per body-building or fabrication job.
 * DELETE works only while a job has no cost and no billing; after that it is cancelled
 * (`status CANCELLED`). Cost lines are append-style: only a DRAFT line can be removed.
 */
const router = Router();
router.use(authMiddleware, requireFeature("production"));
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const id = (req: Request) => idParam.parse(req.params.id);

router.get(
  "/stage-plans",
  requirePermission("project-jobs.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Stage plans", projectJobsService.stagePlans()));
  })
);

router.get(
  "/",
  requirePermission("project-jobs.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    res.json(new ApiResponse("Jobs", await projectJobsService.list(q)));
  })
);

router.post(
  "/",
  requirePermission("project-jobs.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Job created", await projectJobsService.create(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("project-jobs.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Job", await projectJobsService.get(id(req))));
  })
);

router.get(
  "/:id/summary",
  requirePermission("project-jobs.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Job summary", await projectJobsService.summary(id(req))));
  })
);

router.patch(
  "/:id",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateBody.parse(req.body);
    res.json(new ApiResponse("Job updated", await projectJobsService.update(id(req), body)));
  })
);

router.delete(
  "/:id",
  requirePermission("project-jobs.delete"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Job deleted", await projectJobsService.remove(id(req))));
  })
);

router.post(
  "/:id/stages",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = addStageBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Stage added", await projectJobsService.addStage(id(req), body)));
  })
);

router.put(
  "/:id/stages/order",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = reorderBody.parse(req.body);
    res.json(
      new ApiResponse("Stages reordered", await projectJobsService.reorderStages(id(req), body))
    );
  })
);

router.patch(
  "/:id/stages/:stageId",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateStageBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Stage updated",
        await projectJobsService.updateStage(id(req), idParam.parse(req.params.stageId), body)
      )
    );
  })
);

router.post(
  "/:id/costs",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = addCostBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse("Cost added", await projectJobsService.addCost(id(req), body, actorOf(req)))
      );
  })
);

router.post(
  "/:id/costs/post",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = postCostsBody.parse(req.body ?? {});
    res.json(new ApiResponse("Costs posted", await projectJobsService.postCosts(id(req), body)));
  })
);

router.delete(
  "/:id/costs/:costId",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Cost removed",
        await projectJobsService.removeCost(id(req), idParam.parse(req.params.costId))
      )
    );
  })
);

router.post(
  "/:id/billings",
  requirePermission("project-jobs.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = addBillingBody.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse(
          "Billing added",
          await projectJobsService.addBilling(id(req), body, actorOf(req))
        )
      );
  })
);

export default router;
