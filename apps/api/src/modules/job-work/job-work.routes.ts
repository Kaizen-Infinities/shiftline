import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { jobWorkService } from "./job-work.service";
import { challanPrintData } from "./job-work.print";
import { generateDeliveryChallanHtml } from "../../templates/deliveryChallanTemplate";
import { generatePdfFromHtml } from "../../utils/pdfGenerator";
import { ewayBillService, transportSchema } from "../eway-bill/eway-bill.service";

/** /api/job-work (P1-14): the job worker master, delivery challans and ITC-04. */
const router = Router();
router.use(authMiddleware);
const actorOf = (req: Request) => ({ userId: req.user?.userId });

const KINDS = [
  "JOB_WORK_OUT",
  "JOB_WORK_RETURN",
  "BRANCH_TRANSFER",
  "EXHIBITION",
  "LINE_SALES",
  "OTHER",
] as const;

const workerBody = z.object({
  id: z.string().uuid().optional(),
  code: z.string().max(20).optional(),
  name: z.string().min(1).max(160),
  gstin: z.string().max(15).optional().nullable(),
  stateCode: z
    .string()
    .regex(/^\d{2}$/)
    .optional()
    .nullable(),
  addressLine1: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  pincode: z.string().max(10).optional().nullable(),
  contactPerson: z.string().max(120).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().max(120).optional().nullable(),
  processType: z.string().max(80).optional().nullable(),
  isActive: z.boolean().optional(),
});

const challanBody = z.object({
  kind: z.enum(KINDS),
  challanDate: z.string().min(1),
  jobWorkerId: z.string().uuid().optional().nullable(),
  fromJobWorkerId: z.string().uuid().optional().nullable(),
  parentChallanId: z.string().uuid().optional().nullable(),
  businessPlaceId: z.union([z.string(), z.number()]).optional().nullable(),
  toBusinessPlaceId: z.union([z.string(), z.number()]).optional().nullable(),
  storeId: z.string().max(20).optional().nullable(),
  purpose: z.string().max(255).optional().nullable(),
  capitalGoods: z.boolean().optional(),
  transporterName: z.string().max(120).optional().nullable(),
  vehicleNumber: z.string().max(20).optional().nullable(),
  remarks: z.string().max(500).optional().nullable(),
  items: z
    .array(
      z.object({
        itemType: z
          .enum(["RAW_MATERIAL", "FINISHED_GOODS", "SEMI_FINISHED", "CONSUMABLE", "WASTAGE"])
          .optional(),
        rawMaterialId: z.string().max(20).optional().nullable(),
        productItemId: z.union([z.string(), z.number()]).optional().nullable(),
        description: z.string().max(255).optional().nullable(),
        uom: z.string().max(20).optional().nullable(),
        hsnCode: z.string().max(8).optional().nullable(),
        quantity: z.coerce.number().positive(),
        rate: z.coerce.number().min(0).optional().nullable(),
        gstRate: z.coerce.number().min(0).max(100).optional().nullable(),
        parentItemId: z.string().uuid().optional().nullable(),
        scrap: z.coerce.number().min(0).optional(),
      })
    )
    .min(1),
});

const cancelBody = z.object({
  reason: z.string().trim().min(3, "Say why the challan is cancelled").max(255),
});

// ── The job worker master ─────────────────────────────────────────────────────
router.get(
  "/workers",
  requirePermission("job-work.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Job workers", await jobWorkService.listWorkers(req.query.all === "true"))
    );
  })
);

router.post(
  "/workers",
  requirePermission("job-work.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = workerBody.parse(req.body);
    res.json(
      new ApiResponse("Job worker saved", await jobWorkService.upsertWorker(body, actorOf(req)))
    );
  })
);

// ── Challans ──────────────────────────────────────────────────────────────────
router.get(
  "/challans",
  requirePermission("job-work.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        kind: z.enum(KINDS).optional(),
        status: z.enum(["OPEN", "PART_RETURNED", "CLOSED", "CANCELLED"]).optional(),
        jobWorkerId: z.string().uuid().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        overdueOnly: z
          .string()
          .optional()
          .transform((v) => v === "true"),
      })
      .parse(req.query);
    res.json(new ApiResponse("Challans", await jobWorkService.list(q)));
  })
);

router.get(
  "/challans/:id",
  requirePermission("job-work.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(new ApiResponse("Challan", await jobWorkService.get(id)));
  })
);

router.post(
  "/challans",
  requirePermission("job-work.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = challanBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Challan raised", await jobWorkService.create(body, actorOf(req))));
  })
);

router.post(
  "/challans/:id/receive",
  requirePermission("job-work.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z
      .object({
        receivedOn: z.string().optional(),
        lines: z
          .array(
            z.object({
              itemId: z.string().uuid(),
              returned: z.coerce.number().min(0).optional(),
              consumed: z.coerce.number().min(0).optional(),
              scrap: z.coerce.number().min(0).optional(),
              directSupply: z.coerce.number().min(0).optional(),
              directSupplyInvoiceNo: z.string().trim().max(30).optional().nullable(),
              directSupplyInvoiceDate: z.string().optional().nullable(),
            })
          )
          .min(1),
      })
      .parse(req.body);
    res.json(
      new ApiResponse("Goods received", await jobWorkService.receive(id, body, actorOf(req)))
    );
  })
);

router.post(
  "/challans/:id/cancel",
  requirePermission("job-work.cancel"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const { reason } = cancelBody.parse(req.body);
    res.json(
      new ApiResponse("Challan cancelled", await jobWorkService.cancel(id, reason, actorOf(req)))
    );
  })
);

router.post(
  "/challans/:id/eway-bill",
  requirePermission("job-work.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = transportSchema.parse(req.body);
    res
      .status(201)
      .json(
        new ApiResponse(
          "E-way bill raised",
          await ewayBillService.generate({ ...body, docType: "JWC", docRef: id }, actorOf(req))
        )
      );
  })
);

/** The document the driver carries, with the e-way bill number where a checkpost looks. */
router.get(
  "/challans/:id/pdf",
  requirePermission("job-work.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);
    const data = await challanPrintData(id);
    const html = generateDeliveryChallanHtml(data);
    if (req.query.html === "true") {
      res.type("html").send(html);
      return;
    }
    const pdf = await generatePdfFromHtml(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${data.challanNo.replace(/\//g, "-")}.pdf"`
    );
    res.send(pdf);
  })
);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get(
  "/register",
  requirePermission("job-work.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = z
      .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        jobWorkerId: z.string().uuid().optional(),
      })
      .parse(req.query);
    res.json(new ApiResponse("Job work register", await jobWorkService.register(q)));
  })
);

const periodQuery = z.object({
  period: z.string().regex(/^\d{4}-H[12]$/),
  businessPlaceId: z.union([z.string(), z.number()]).optional().nullable(),
});

router.get(
  "/itc04",
  requirePermission("job-work.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.query);
    res.json(new ApiResponse("ITC-04", await jobWorkService.itc04(q.period, q.businessPlaceId)));
  })
);

/** Registers the half-year, for one business place's GSTIN, on the filing gate — same shape as
 * GSTR-1's per-GSTIN gate in `gst-period.ts` (P2-18). */
router.post(
  "/itc04/register",
  requirePermission("job-work.manage"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = periodQuery.parse(req.body);
    res.json(
      new ApiResponse(
        "ITC-04 registered",
        await jobWorkService.registerItc04(q.period, actorOf(req), q.businessPlaceId)
      )
    );
  })
);

/** Marks the half-year filed once it is approved on the gate and the hash still matches. */
router.post(
  "/itc04/mark-filed",
  requirePermission("job-work.file"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = periodQuery
      .extend({ submissionRef: z.string().trim().max(120).optional().nullable() })
      .parse(req.body);
    res.json(
      new ApiResponse(
        "ITC-04 marked filed",
        await jobWorkService.markItc04Filed(
          body.period,
          body.submissionRef ?? null,
          actorOf(req),
          body.businessPlaceId
        )
      )
    );
  })
);

export default router;
