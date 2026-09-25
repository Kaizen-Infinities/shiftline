import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { assertMonth, gstr1Service } from "./gstr1.service";
import { gstr3bService } from "./gstr3b.service";
import { itcService } from "./itc.service";
import { gstr2bService } from "./gstr2b.service";
import { imsService } from "./ims.service";
import { gstr9Service } from "./gstr9.service";
import { complianceService } from "./compliance.service";
import { gstr2bSettingsSchema, gstr2bSettingsService } from "./gstr2b-settings.service";
import { followUpBody, supplierFollowUpService } from "./supplier-followup.service";

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

/** GSTR-2B (P1-13c): what the suppliers filed, and how it lines up with the purchase register. */
const matchQuery = periodQuery.extend({
  status: z.enum(["MATCHED", "MISMATCH", "MISSING_IN_2B", "MISSING_IN_BOOKS"]).optional(),
});
router.get(
  "/gstr2b",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = matchQuery.parse(req.query);
    res.json(new ApiResponse("GSTR-2B", await gstr2bService.list(q.period, q.gstin, q.status)));
  })
);
router.get(
  "/gstr2b/summary",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    res.json(
      new ApiResponse("GSTR-2B reconciliation", await gstr2bService.reconcile(q.period, q.gstin))
    );
  })
);
router.post(
  "/gstr2b/import",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse({ period: req.body?.period, gstin: req.body?.gstin });
    const json = req.body?.json;
    if (!json || typeof json !== "object") {
      throw new ApiError(400, "Send the portal's 2B file as `json`", "NO_FILE");
    }
    res.json(
      new ApiResponse("GSTR-2B imported", await gstr2bService.importJson(q.period, q.gstin, json))
    );
  })
);
router.post(
  "/gstr2b/pull",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.body);
    res.json(new ApiResponse("GSTR-2B pulled", await gstr2bService.pull(q.period, q.gstin)));
  })
);

/** Per-tenant matching tolerances (P2-10), read by `reconcile` in place of the constant. */
router.get(
  "/gstr2b/settings",
  requirePermission("gst-returns.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("GSTR-2B settings", await gstr2bSettingsService.get()));
  })
);
router.put(
  "/gstr2b/settings",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = gstr2bSettingsSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-2B settings saved",
        await gstr2bSettingsService.update(body, actorOf(req))
      )
    );
  })
);

/** Chasing a supplier over what the reconciliation named (P2-10). */
router.post(
  "/gstr2b/:period/follow-up/preview",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const period = assertMonth(String(req.params.period));
    const body = followUpBody.parse(req.body);
    res.json(
      new ApiResponse("Follow-up preview", await supplierFollowUpService.preview(period, body))
    );
  })
);
router.post(
  "/gstr2b/:period/follow-up",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const period = assertMonth(String(req.params.period));
    const body = followUpBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Follow-up sent",
        await supplierFollowUpService.send(period, body, actorOf(req))
      )
    );
  })
);

/** The Invoice Management System: the decision on every inward record, and its deadline. */
const imsQuery = periodQuery.extend({
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]).optional(),
});
router.get(
  "/ims",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = imsQuery.parse(req.query);
    res.json(new ApiResponse("IMS records", await imsService.list(q.period, q.gstin, q.status)));
  })
);
router.get(
  "/ims/pending",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    res.json(new ApiResponse("Undecided records", await imsService.pendingRisk(q.period, q.gstin)));
  })
);
router.post(
  "/ims/:id/act",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        status: z.enum(["PENDING", "ACCEPTED", "REJECTED"]),
        reason: z.string().trim().max(255).optional().nullable(),
      })
      .parse(req.body);
    const row = await imsService.act(z.string().uuid().parse(req.params.id), body, actorOf(req));
    res.json(new ApiResponse("Decision recorded", row));
  })
);
router.post(
  "/ims/rule",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = periodQuery
      .extend({ rule: z.enum(["ACCEPT_MATCHED", "ACCEPT_WITHIN_TOLERANCE"]) })
      .parse(req.body);
    res.json(
      new ApiResponse(
        "Rule applied",
        await imsService.applyRule(body.period, body.gstin, body.rule, actorOf(req))
      )
    );
  })
);
router.post(
  "/ims/register",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.body);
    res.json(
      new ApiResponse(
        "IMS decisions registered for approval",
        await imsService.register(q.period, q.gstin, actorOf(req))
      )
    );
  })
);
router.post(
  "/ims/push",
  requirePermission("gst-returns.file"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.body);
    res.json(
      new ApiResponse("IMS actions pushed", await imsService.push(q.period, q.gstin, actorOf(req)))
    );
  })
);

/** GSTR-9 working papers (P1-13d): the twelve months added up the way the annual return asks. */
const fyQuery = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/, "Financial year must look like 2026-27"),
  gstin: z.string().trim().toUpperCase().length(15).optional(),
});
router.get(
  "/gstr9",
  requirePermission("gst-returns.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = fyQuery.parse(req.query);
    res.json(new ApiResponse("GSTR-9", await gstr9Service.build(q.fy, q.gstin)));
  })
);
router.post(
  "/gstr9/register",
  requirePermission("gst-returns.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = fyQuery.parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-9 registered for approval",
        await gstr9Service.register(q.fy, q.gstin, actorOf(req))
      )
    );
  })
);
router.post(
  "/gstr9/filed",
  requirePermission("gst-returns.file"),
  asyncHandler(async (req: Request, res: Response) => {
    const b = fyQuery
      .extend({ submissionRef: z.string().trim().max(120).optional().nullable() })
      .parse(req.body);
    res.json(
      new ApiResponse(
        "GSTR-9 marked filed",
        await gstr9Service.markFiled(b.fy, b.gstin, b.submissionRef ?? null, actorOf(req))
      )
    );
  })
);

/** The compliance calendar: what is due, when, and how far along it is. */
router.get(
  "/calendar",
  requirePermission("filings.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Compliance calendar", await complianceService.calendar(q)));
  })
);

export default router;
