import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { bankingService } from "./banking.service";
import { STATEMENT_FORMATS } from "./statement.parse";

/**
 * /api/banking (P1-20): statement import, matching, the BRS and the cheque register.
 * The statement arrives as text in the body rather than as a file upload, so a paste from the
 * bank's portal works as well as a saved CSV.
 */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });
const idParam = z.string().uuid();

// ── Statements ────────────────────────────────────────────────────────────────
router.get(
  "/statements",
  requirePermission("banking.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ bankAccountId: z.string().uuid().optional() }).parse(req.query);
    res.json(new ApiResponse("Bank statements", await bankingService.statements(q.bankAccountId)));
  })
);

router.post(
  "/statements/import",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        bankAccountId: z.string().uuid(),
        format: z.enum(STATEMENT_FORMATS),
        csv: z.string().min(1).max(8_000_000),
        fileName: z.string().max(160).optional().nullable(),
        columnMap: z.record(z.string(), z.array(z.string())).optional(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse(
          "Statement imported",
          await bankingService.importStatement(body, actorOf(req))
        )
      );
  })
);

router.get(
  "/lines",
  requirePermission("banking.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        bankAccountId: z.string().uuid().optional(),
        status: z.enum(["UNMATCHED", "MATCHED", "IGNORED"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Statement lines", await bankingService.lines(q)));
  })
);

router.get(
  "/lines/:id/candidates",
  requirePermission("banking.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Possible matches",
        await bankingService.candidatesFor(idParam.parse(req.params.id))
      )
    );
  })
);

router.post(
  "/lines/:id/match",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ voucherId: z.coerce.number().int() }).parse(req.body);
    res.json(
      new ApiResponse("Matched", await bankingService.match(id, body.voucherId, actorOf(req)))
    );
  })
);

router.post(
  "/lines/:id/unmatch",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Unmatched", await bankingService.unmatch(idParam.parse(req.params.id)))
    );
  })
);

router.post(
  "/lines/:id/ignore",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    const body = z.object({ note: z.string().min(1).max(255) }).parse(req.body);
    res.json(new ApiResponse("Ignored", await bankingService.ignore(id, body.note)));
  })
);

router.post(
  "/auto-match",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ bankAccountId: z.string().uuid() }).parse(req.body);
    res.json(
      new ApiResponse(
        "Matched what it was sure about",
        await bankingService.autoMatch(body.bankAccountId, actorOf(req))
      )
    );
  })
);

router.get(
  "/brs",
  requirePermission("banking.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({ bankAccountId: z.string().uuid(), asOn: z.coerce.date().optional() })
      .parse(req.query);
    res.json(
      new ApiResponse(
        "Reconciliation",
        await bankingService.brs(q.bankAccountId, q.asOn ?? new Date())
      )
    );
  })
);

// ── Cheques ───────────────────────────────────────────────────────────────────
router.get(
  "/cheques",
  requirePermission("banking.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        kind: z.enum(["RECEIVED", "ISSUED"]).optional(),
        status: z.enum(["IN_HAND", "DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED"]).optional(),
        dueBy: z.coerce.date().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Cheques", await bankingService.cheques(q)));
  })
);

router.get(
  "/cheques/due",
  requirePermission("banking.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z.object({ on: z.coerce.date().optional() }).parse(req.query);
    res.json(new ApiResponse("Cheques due", await bankingService.dueToday(q.on ?? new Date())));
  })
);

router.post(
  "/cheques",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({
        kind: z.enum(["RECEIVED", "ISSUED"]),
        chequeNo: z.string().min(1).max(20),
        chequeDate: z.string().min(1),
        amount: z.coerce.number().positive(),
        bankName: z.string().max(120).optional().nullable(),
        partyName: z.string().max(160).optional().nullable(),
        customerId: z.string().uuid().optional().nullable(),
        supplierId: z.coerce.number().int().optional().nullable(),
        bankAccountId: z.string().uuid().optional().nullable(),
        refDocType: z.string().max(30).optional().nullable(),
        refDocId: z.string().max(40).optional().nullable(),
        notes: z.string().max(255).optional().nullable(),
      })
      .parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Cheque recorded", await bankingService.addCheque(body, actorOf(req))));
  })
);

router.post(
  "/cheques/:id/status",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    const body = z
      .object({
        status: z.enum(["DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED"]),
        on: z.string().optional(),
        bankAccountId: z.string().uuid().optional().nullable(),
        bounceCharges: z.coerce.number().min(0).optional(),
        bounceReason: z.string().max(160).optional().nullable(),
      })
      .parse(req.body);
    res.json(new ApiResponse("Updated", await bankingService.updateCheque(id, body, actorOf(req))));
  })
);

router.post(
  "/cheques/:id/re-present",
  requirePermission("banking.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    res.json(
      new ApiResponse("Cheque re-presented", await bankingService.rePresent(id, actorOf(req)))
    );
  })
);

export default router;
