import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { tallyService } from "./tally.service";

/**
 * /api/tally (P1-06): the XML the tenant's accountant imports into Tally.
 *
 * Generating a file changes nothing, so those are GETs. Recording that a file was handed over
 * does change something — it moves the incremental watermark — so that is a run, and confirming
 * it is a separate act, because nothing here can see whether Tally accepted anything.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const idParam = z.string().uuid();
const NAME_KINDS = ["GROUP", "LEDGER", "UNIT", "STOCK_ITEM", "VOUCHER_TYPE"] as const;
const SCOPES = ["MASTERS", "VOUCHERS", "BOTH"] as const;

const window = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  incremental: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true"),
  tallyCompany: z.string().max(160).optional().nullable(),
});

const sendXml = (res: Response, fileName: string, xml: string) => {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(xml);
};

// ── Settings ──────────────────────────────────────────────────────────────────
router.get(
  "/settings",
  requirePermission("tally.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Tally settings", await tallyService.settings()));
  })
);

router.put(
  "/settings",
  requirePermission("tally.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ autoExportEnabled: z.boolean() }).parse(req.body);
    res.json(
      new ApiResponse("Tally settings saved", await tallyService.updateSettings(body, actorOf(req)))
    );
  })
);

// ── Files ─────────────────────────────────────────────────────────────────────
router.get(
  "/masters",
  requirePermission("tally.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ tallyCompany: z.string().max(160).optional() }).parse(req.query);
    const file = await tallyService.masters(q.tallyCompany ?? null);
    sendXml(res, "tally-masters.xml", file.xml);
  })
);

router.get(
  "/vouchers",
  requirePermission("tally.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = window.parse(req.query);
    const sinceAt = q.incremental ? await tallyService.watermark() : null;
    const file = await tallyService.vouchers({
      from: q.from,
      to: q.to,
      sinceAt,
      tallyCompany: q.tallyCompany,
    });
    sendXml(res, `tally-vouchers-${q.from.toISOString().slice(0, 10)}.xml`, file.xml);
  })
);

router.get(
  "/preview",
  requirePermission("tally.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = window.extend({ scope: z.enum(SCOPES).optional() }).parse(req.query);
    res.json(new ApiResponse("Tally export preview", await tallyService.preview(q)));
  })
);

// ── Runs ──────────────────────────────────────────────────────────────────────
router.get(
  "/runs",
  requirePermission("tally.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Tally export runs", await tallyService.runs()));
  })
);

router.post(
  "/runs",
  requirePermission("tally.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = window
      .extend({
        scope: z.enum(SCOPES).optional(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    const { run } = await tallyService.createRun(body, actorOf(req));
    res.status(201).json(new ApiResponse("Export ready", run));
  })
);

router.get(
  "/runs/:id",
  requirePermission("tally.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Tally export run", await tallyService.run(idParam.parse(req.params.id)))
    );
  })
);

router.get(
  "/runs/:id/file",
  requirePermission("tally.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const out = await tallyService.fileFor(idParam.parse(req.params.id));
    // The accountant is about to import this a second time; say so if the books have moved.
    res.setHeader("X-Books-Changed-Since-Run", out.changedSinceRun ? "true" : "false");
    sendXml(res, `tally-${out.run.scope.toLowerCase()}-${out.run.id.slice(0, 8)}.xml`, out.xml);
  })
);

router.post(
  "/runs/:id/confirm",
  requirePermission("tally.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    res.json(new ApiResponse("Marked imported", await tallyService.confirm(id, actorOf(req))));
  })
);

router.post(
  "/runs/:id/discard",
  requirePermission("tally.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ reason: z.string().min(1).max(255) }).parse(req.body);
    res.json(new ApiResponse("Discarded", await tallyService.discard(id, body.reason)));
  })
);

// ── Name mapping ──────────────────────────────────────────────────────────────
router.get(
  "/mappings",
  requirePermission("tally.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Tally name mappings", await tallyService.mappings()));
  })
);

router.post(
  "/mappings",
  requirePermission("tally.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        kind: z.enum(NAME_KINDS),
        sourceCode: z.string().min(1).max(60),
        tallyName: z.string().min(1).max(160),
        tallyParent: z.string().max(160).optional().nullable(),
        isExported: z.boolean().optional(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Mapping saved", await tallyService.saveMapping(body, actorOf(req))));
  })
);

router.delete(
  "/mappings/:id",
  requirePermission("tally.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Mapping removed",
        await tallyService.deleteMapping(idParam.parse(req.params.id))
      )
    );
  })
);

export default router;
