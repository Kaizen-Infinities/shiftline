import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { exportIncentivesService as svc } from "./export-incentives.service";
import {
  createAuthorisationBody,
  createClaimBody,
  createEntryBody,
  fromInvoiceBody,
  idParam,
  listClaimsQuery,
  updateAuthorisationBody,
  updateClaimBody,
} from "./export-incentives.validation";

/**
 * /api/export-incentives (TN-01): RoDTEP / RoSCTL / drawback claims per shipping bill, and EPCG /
 * Advance Authorisation licences with their export-obligation progress.
 */
const router = Router();
router.use(authMiddleware);
router.use(requireFeature("exports"));
const userOf = (req: Request) => req.user?.userId;

// ── Claims ────────────────────────────────────────────────────────────────────
router.get(
  "/claims/summary",
  requirePermission("export-incentives.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Export incentive summary", await svc.summary()));
  })
);

router.get(
  "/claims",
  requirePermission("export-incentives.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listClaimsQuery.parse(req.query);
    res.json(new ApiResponse("Export incentive claims", await svc.listClaims(q)));
  })
);

router.post(
  "/claims",
  requirePermission("export-incentives.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createClaimBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Claim recorded", await svc.createClaim(body, userOf(req))));
  })
);

router.post(
  "/claims/from-invoice/:salesInvoiceId",
  requirePermission("export-incentives.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.salesInvoiceId);
    const body = fromInvoiceBody.parse(req.body ?? {});
    res
      .status(201)
      .json(new ApiResponse("Claim recorded", await svc.createFromInvoice(id, body, userOf(req))));
  })
);

router.patch(
  "/claims/:id",
  requirePermission("export-incentives.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateClaimBody.parse(req.body);
    res.json(
      new ApiResponse("Claim updated", await svc.updateClaim(idParam.parse(req.params.id), body))
    );
  })
);

router.delete(
  "/claims/:id",
  requirePermission("export-incentives.delete"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("Claim deleted", await svc.deleteClaim(idParam.parse(req.params.id))));
  })
);

// ── Authorisations ────────────────────────────────────────────────────────────
router.get(
  "/authorisations",
  requirePermission("export-incentives.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Authorisations", await svc.listAuthorisations()));
  })
);

router.post(
  "/authorisations",
  requirePermission("export-incentives.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createAuthorisationBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Authorisation recorded", await svc.createAuthorisation(body)));
  })
);

router.get(
  "/authorisations/:id",
  requirePermission("export-incentives.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Authorisation", await svc.getAuthorisation(idParam.parse(req.params.id)))
    );
  })
);

router.patch(
  "/authorisations/:id",
  requirePermission("export-incentives.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateAuthorisationBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Authorisation updated",
        await svc.updateAuthorisation(idParam.parse(req.params.id), body)
      )
    );
  })
);

router.post(
  "/authorisations/:id/entries",
  requirePermission("export-incentives.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createEntryBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Entry added", await svc.addEntry(idParam.parse(req.params.id), body)));
  })
);

router.delete(
  "/authorisations/:id/entries/:entryId",
  requirePermission("export-incentives.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Entry removed",
        await svc.removeEntry(idParam.parse(req.params.id), idParam.parse(req.params.entryId))
      )
    );
  })
);

export default router;
