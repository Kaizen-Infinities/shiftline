import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { renderClaimPdf } from "./msme-claims.pdf";
import { msmeClaimsService } from "./msme-claims.service";
import {
  createBody,
  eligibleQuery,
  idParam,
  listQuery,
  recomputeBody,
  settingsBody,
  statusBody,
} from "./msme-claims.validation";

/**
 * /api/msme/receivable-claims (TN-05): section 15 overdue invoices, section 16 interest and the
 * claim a supplier files on MSME Samadhaan or with an MSEFC. No DELETE: a claim is withdrawn.
 */
const router = Router();
router.use(authMiddleware, requireFeature("accounts"));
const actorOf = (req: Request) => ({ userId: req.user?.userId });

router.get(
  "/settings",
  requirePermission("msme-claims.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("MSME claim settings", await msmeClaimsService.settings()));
  })
);

router.put(
  "/settings",
  requirePermission("msme-claims.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = settingsBody.parse(req.body);
    res.json(
      new ApiResponse(
        "MSME claim settings saved",
        await msmeClaimsService.updateSettings(body, actorOf(req))
      )
    );
  })
);

router.get(
  "/eligible",
  requirePermission("msme-claims.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = eligibleQuery.parse(req.query);
    res.json(new ApiResponse("Invoices past section 15", await msmeClaimsService.eligible(q)));
  })
);

router.get(
  "/",
  requirePermission("msme-claims.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    res.json(new ApiResponse("MSME claims", await msmeClaimsService.list(q)));
  })
);

router.post(
  "/",
  requirePermission("msme-claims.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Claim raised", await msmeClaimsService.create(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("msme-claims.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("MSME claim", await msmeClaimsService.get(idParam.parse(req.params.id)))
    );
  })
);

router.patch(
  "/:id/status",
  requirePermission("msme-claims.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = statusBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Claim updated",
        await msmeClaimsService.updateStatus(idParam.parse(req.params.id), body)
      )
    );
  })
);

router.post(
  "/:id/recompute",
  requirePermission("msme-claims.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = recomputeBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Claim recomputed",
        await msmeClaimsService.recompute(idParam.parse(req.params.id), body.asOf)
      )
    );
  })
);

router.get(
  "/:id/pdf",
  requirePermission("msme-claims.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const data = await msmeClaimsService.statementData(idParam.parse(req.params.id));
    const { buffer, filename } = await renderClaimPdf(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  })
);

export default router;
