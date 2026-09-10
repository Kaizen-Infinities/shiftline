import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { configSchema, eInvoiceConfigService } from "./e-invoice.config.service";
import {
  cancelSchema,
  docTypeSchema,
  eInvoiceService,
  generateSchema,
  listSchema,
} from "./e-invoice.service";
import { CANCEL_REASONS } from "./e-invoice.types";

/** /api/e-invoice (P1-11): IRN requests per document and the tenant's GSP settings. */
const router = Router();
router.use(authMiddleware);
const idParam = z.string().uuid();
const actorOf = (req: Request) => ({ userId: req.user?.userId });

router.get(
  "/settings",
  requirePermission("e-invoice.settings"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("E-invoice settings", await eInvoiceConfigService.get()));
  })
);
router.put(
  "/settings",
  requirePermission("e-invoice.settings"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "E-invoice settings saved",
        await eInvoiceConfigService.update(configSchema.parse(req.body), actorOf(req))
      )
    );
  })
);
router.post(
  "/settings/verify",
  requirePermission("e-invoice.settings"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Verification", await eInvoiceConfigService.verify()));
  })
);
router.get("/cancel-reasons", requirePermission("e-invoice.view"), (_req, res) => {
  res.json(new ApiResponse("Cancellation reasons", CANCEL_REASONS));
});
router.get(
  "/",
  requirePermission("e-invoice.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("E-invoices", await eInvoiceService.list(listSchema.parse(req.query)))
    );
  })
);
router.get(
  "/document/:docType/:docId",
  requirePermission("e-invoice.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const docType = docTypeSchema.parse(req.params.docType);
    const docId = idParam.parse(req.params.docId);
    const row = await eInvoiceService.forDocument(docType, docId);
    res.json(new ApiResponse("E-invoice", row));
  })
);
router.get(
  "/applicability",
  requirePermission("e-invoice.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        buyerGstin: z.string().max(15).optional(),
      })
      .parse(req.query);
    res.json(
      new ApiResponse(
        "Applicability",
        await eInvoiceService.applicability(new Date(`${q.date}T00:00:00Z`), q.buyerGstin || null)
      )
    );
  })
);
router.post(
  "/generate",
  requirePermission("e-invoice.generate"),
  asyncHandler(async (req: Request, res: Response) => {
    const { docType, docId } = generateSchema.parse(req.body);
    const { row, queued } = await eInvoiceService.request(docType, docId, actorOf(req));
    res
      .status(queued ? 202 : 200)
      .json(new ApiResponse(queued ? "IRN requested" : "IRN", { ...row, queued }));
  })
);
router.get(
  "/:id",
  requirePermission("e-invoice.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("E-invoice", await eInvoiceService.get(idParam.parse(req.params.id))));
  })
);
router.post(
  "/:id/cancel",
  requirePermission("e-invoice.cancel"),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason, remarks } = cancelSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "IRN cancelled",
        await eInvoiceService.cancel(idParam.parse(req.params.id), reason, remarks, actorOf(req))
      )
    );
  })
);

export default router;
