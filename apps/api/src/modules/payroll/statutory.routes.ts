import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { statutoryPayrollService } from "./statutory.service";

/**
 * /api/payroll-statutory (P1-16): the statutory half of a payroll run and the files it produces.
 * The files are downloads because a portal wants a file, not JSON.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const runId = z.coerce.number().int();

const sendText = (res: Response, fileName: string, text: string) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(text);
};

// ── State rules ───────────────────────────────────────────────────────────────
router.get(
  "/rules",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Statutory rules",
        await statutoryPayrollService.rules(req.query.all === "true")
      )
    );
  })
);

router.post(
  "/rules",
  requirePermission("payroll-settings.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        stateCode: z.string().length(2),
        stateName: z.string().min(1).max(80),
        ptSlabs: z
          .array(
            z.object({
              upTo: z.coerce.number(),
              amount: z.coerce.number().min(0),
              month: z.coerce.number().int().min(1).max(12).optional(),
            })
          )
          .optional(),
        ptEnabled: z.boolean().optional(),
        lwfEmployee: z.coerce.number().min(0).optional(),
        lwfEmployer: z.coerce.number().min(0).optional(),
        lwfFrequency: z.enum(["MONTHLY", "HALF_YEARLY", "ANNUAL"]).optional(),
        lwfMonths: z.array(z.coerce.number().int().min(1).max(12)).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Rule saved", await statutoryPayrollService.upsertRule(body)));
  })
);

// ── Tax declarations ──────────────────────────────────────────────────────────
router.get(
  "/declarations/:fyCode",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const fyCode = z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .parse(req.params.fyCode);
    res.json(new ApiResponse("Declarations", await statutoryPayrollService.declarations(fyCode)));
  })
);

router.post(
  "/declarations",
  requirePermission("payroll.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        employeeId: z.string().min(1),
        fyCode: z.string().regex(/^\d{4}-\d{2}$/),
        regime: z.enum(["OLD", "NEW"]),
        declarations: z.record(z.string(), z.coerce.number()).optional(),
        proofsVerified: z.boolean().optional(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res.json(
      new ApiResponse(
        "Declaration saved",
        await statutoryPayrollService.setDeclaration(body, actorOf(req))
      )
    );
  })
);

// ── A run's statutory half ────────────────────────────────────────────────────
router.post(
  "/runs/:id/compute",
  requirePermission("payroll-run.create"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Worked out",
        await statutoryPayrollService.compute(runId.parse(req.params.id), actorOf(req))
      )
    );
  })
);

router.get(
  "/runs/:id/summary",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Statutory summary",
        await statutoryPayrollService.summary(runId.parse(req.params.id))
      )
    );
  })
);

router.get(
  "/runs/:id/ecr",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = runId.parse(req.params.id);
    const out = await statutoryPayrollService.ecr(id);
    // The count of members left out is the thing to notice, so it travels on a header rather
    // than being buried in a file the accountant will not read.
    res.setHeader("X-Members-Skipped", String(out.skipped.length));
    sendText(res, `ECR-${id}.txt`, out.text);
  })
);

router.get(
  "/runs/:id/esic",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = runId.parse(req.params.id);
    const out = await statutoryPayrollService.esicFile(id);
    res.setHeader("X-Members-Skipped", String(out.skipped.length));
    sendText(res, `ESIC-${id}.csv`, out.text);
  })
);

router.get(
  "/runs/:id/bank-transfer",
  requirePermission("payroll-run.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = runId.parse(req.params.id);
    const out = await statutoryPayrollService.bankTransferFile(id);
    res.setHeader("X-Employees-Skipped", String(out.skipped.length));
    res.setHeader("X-Transfer-Total", String(out.total));
    sendText(res, `SALARY-${id}.csv`, out.text);
  })
);

router.get(
  "/runs/:id/pt-summary",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Professional tax",
        await statutoryPayrollService.ptSummary(runId.parse(req.params.id))
      )
    );
  })
);

router.get(
  "/runs/:id/24q",
  requirePermission("payroll.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Form 24Q rows",
        await statutoryPayrollService.form24QRows(runId.parse(req.params.id))
      )
    );
  })
);

router.post(
  "/runs/:id/post-journal",
  requirePermission("payroll-run.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Posted",
        await statutoryPayrollService.postJournal(runId.parse(req.params.id), actorOf(req))
      )
    );
  })
);

router.post(
  "/runs/:id/register-filings",
  requirePermission("filings.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Registered for approval",
        await statutoryPayrollService.registerFilings(runId.parse(req.params.id), actorOf(req))
      )
    );
  })
);

export default router;
