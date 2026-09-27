import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requireFeature } from "../../middleware/feature.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { asnService as svc } from "./asn.service";
import {
  createAsnBody,
  createPartMapBody,
  exportQuery,
  idParam,
  labelsQuery,
  listQuery,
  partMapListQuery,
  prefillQuery,
  statusBody,
  updateAsnBody,
  updatePartMapBody,
} from "./asn.validation";

/**
 * /api/asn (TN-07): the customer part-number map, advance shipping notices raised from a sales
 * invoice, their export through `providers/`, and packing labels with a QR code per pack.
 * No DELETE for an ASN: it is cancelled with `POST /:id/status { status: "CANCELLED" }`.
 */
const router = Router();
router.use(authMiddleware, requireFeature("sales"));
const actorOf = (req: Request) => ({ userId: req.user?.userId });

// ── Part map (static paths before "/:id") ────────────────────────────────────
router.get(
  "/part-maps",
  requirePermission("asn.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = partMapListQuery.parse(req.query);
    res.json(new ApiResponse("Customer part numbers", await svc.listPartMaps(q)));
  })
);

router.post(
  "/part-maps",
  requirePermission("asn.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createPartMapBody.parse(req.body);
    res
      .status(201)
      .json(new ApiResponse("Part number mapped", await svc.createPartMap(body, actorOf(req))));
  })
);

router.patch(
  "/part-maps/:id",
  requirePermission("asn.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updatePartMapBody.parse(req.body);
    res.json(
      new ApiResponse(
        "Part mapping updated",
        await svc.updatePartMap(idParam.parse(req.params.id), body)
      )
    );
  })
);

router.delete(
  "/part-maps/:id",
  requirePermission("asn.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Part mapping removed", await svc.deletePartMap(idParam.parse(req.params.id)))
    );
  })
);

router.get(
  "/export-formats",
  requirePermission("asn.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("ASN export formats", svc.exportFormats()));
  })
);

router.get(
  "/prefill",
  requirePermission("asn.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = prefillQuery.parse(req.query);
    res.json(new ApiResponse("ASN proposal", await svc.prefill(q.salesInvoiceId)));
  })
);

// ── ASN ─────────────────────────────────────────────────────────────────────
router.get(
  "/",
  requirePermission("asn.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = listQuery.parse(req.query);
    res.json(new ApiResponse("ASNs", await svc.list(q)));
  })
);

router.post(
  "/",
  requirePermission("asn.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = createAsnBody.parse(req.body);
    res.status(201).json(new ApiResponse("ASN created", await svc.create(body, actorOf(req))));
  })
);

router.get(
  "/:id",
  requirePermission("asn.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(new ApiResponse("ASN", await svc.get(idParam.parse(req.params.id))));
  })
);

router.patch(
  "/:id",
  requirePermission("asn.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = updateAsnBody.parse(req.body);
    res.json(new ApiResponse("ASN updated", await svc.update(idParam.parse(req.params.id), body)));
  })
);

router.post(
  "/:id/status",
  requirePermission("asn.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    const body = statusBody.parse(req.body);
    res.json(
      new ApiResponse(
        "ASN status changed",
        await svc.setStatus(idParam.parse(req.params.id), body, actorOf(req))
      )
    );
  })
);

router.get(
  "/:id/export",
  requirePermission("asn.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    const q = exportQuery.parse(req.query);
    const file = await svc.export(id, q.format);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    res.send(file.body);
  })
);

router.get(
  "/:id/labels",
  requirePermission("asn.export"),
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    const q = labelsQuery.parse(req.query);
    const { fileName, pdf } = await svc.labelsPdf(id, q.size);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    res.send(pdf);
  })
);

export default router;
