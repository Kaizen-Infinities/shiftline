import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { assertMonth, gstr1Service } from "./gstr1.service";
import { gstr3bService } from "./gstr3b.service";
import { itcService } from "./itc.service";

/** /api/gst-returns (P1-13): returns computed from the books, per GSTIN and period. */
const router = Router();
router.use(authMiddleware);
const periodQuery = z.object({
  period: z.string().transform(assertMonth),
  gstin: z.string().trim().toUpperCase().length(15).optional(),
});
const fileBody = periodQuery.extend({
  submissionRef: z.string().trim().max(120).optional().nullable(),
});
/** A hand call on one credit; it outranks the computed classification and survives a rebuild. */
const classifyBody = z.object({
  status: z.enum(["ELIGIBLE", "INELIGIBLE"]),
  reason: z.string().trim().min(3, "Say why the credit is reclassified").max(255),
});
const idParam = z.string().uuid();
const actorOf = (req: Request) => ({ userId: req.user?.userId });

router.get(
  "/gstins",
  requirePermission("gst-returns.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    const scopes = await gstr1Service.scopes();
    res.json(
      new ApiResponse(
        "Registrations",
        scopes.map((s) => ({
          gstin: s.gstin,
          name: s.name,
          stateCode: s.stateCode,
          businessPlaceId: s.filingPlaceId === null ? null : String(s.filingPlaceId),
        }))
      )
    );
  })
);
router.get(
  "/gstr1",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    res.json(new ApiResponse("GSTR-1", await gstr1Service.build(q.period, q.gstin)));
  })
);
router.get(
  "/gstr1/json",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    const ret = await gstr1Service.build(q.period, q.gstin);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="GSTR1_${ret.gstin}_${ret.fp}.json"`
    );
    res.json(ret.json);
  })
);
router.post(
  "/gstr1/register",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-1 registered for approval",
        await gstr1Service.register(q.period, q.gstin, actorOf(req))
      )
    );
  })
);
router.post(
  "/gstr1/filed",
  requirePermission("gst-returns.file"),
  asyncHandler(async (req: Request, res: Response) => {
    const b = fileBody.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-1 marked filed",
        await gstr1Service.markFiled(b.period, b.gstin, b.submissionRef ?? null, actorOf(req))
      )
    );
  })
);

router.get(
  "/gstr3b",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    res.json(new ApiResponse("GSTR-3B", await gstr3bService.build(q.period, q.gstin)));
  })
);
router.post(
  "/gstr3b/register",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-3B registered for approval",
        await gstr3bService.register(q.period, q.gstin, actorOf(req))
      )
    );
  })
);
router.post(
  "/gstr3b/filed",
  requirePermission("gst-returns.file"),
  asyncHandler(async (req: Request, res: Response) => {
    const b = fileBody.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-3B marked filed",
        await gstr3bService.markFiled(b.period, b.gstin, b.submissionRef ?? null, actorOf(req))
      )
    );
  })
);
router.get(
  "/itc",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    // The ledger is rebuilt from the documents before it is read, so it is never stale.
    await gstr3bService.build(q.period, q.gstin);
    res.json(new ApiResponse("Input tax credit ledger", await itcService.forPeriod(q.period)));
  })
);
router.patch(
  "/itc/:id",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = classifyBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Credit reclassified",
        await itcService.classify(idParam.parse(req.params.id), body, actorOf(req))
      )
    );
  })
);

export default router;
