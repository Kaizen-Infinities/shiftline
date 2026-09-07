import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  cancelSchema,
  consolidateSchema,
  ewayBillService,
  extendSchema,
  generateSchema,
  listSchema,
  partBSchema,
} from "./eway-bill.service";
import { EWB_CANCEL_REASONS, EXTEND_REASONS, PART_B_REASONS } from "./eway-bill.types";

/** /api/eway-bills (P1-12): generate, Part B, extend, cancel, consolidate, register. */
const router = Router();
router.use(authMiddleware);
const idParam = z.string().uuid();
const actorOf = (req: Request) => ({ userId: req.user?.userId });

router.get("/reasons", requirePermission("eway-bill.view"), (_req, res) => {
  res.json(
    new ApiResponse("Reason codes", {
      cancel: EWB_CANCEL_REASONS,
      partB: PART_B_REASONS,
      extend: EXTEND_REASONS,
    })
  );
});
router.get(
  "/",
  requirePermission("eway-bill.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("E-way bills", await ewayBillService.list(listSchema.parse(req.query)))
    );
  })
);
router.get(
  "/consolidated",
  requirePermission("eway-bill.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Trip sheets", await ewayBillService.listConsolidated()));
  })
);
router.post(
  "/consolidated",
  requirePermission("eway-bill.generate"),
  asyncHandler(async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        new ApiResponse(
          "Trip sheet generated",
          await ewayBillService.consolidate(consolidateSchema.parse(req.body), actorOf(req))
        )
      );
  })
);
router.get(
  "/document/:docType/:docRef",
  requirePermission("eway-bill.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const docType = z.enum(["INV", "CHL"]).parse(req.params.docType);
    const docRef = z.string().min(1).max(40).parse(req.params.docRef);
    res.json(new ApiResponse("E-way bills", await ewayBillService.forDocument(docType, docRef)));
  })
);
router.post(
  "/generate",
  requirePermission("eway-bill.generate"),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await ewayBillService.generate(generateSchema.parse(req.body), actorOf(req));
    res
      .status(row.status === "ACTIVE" ? 201 : 200)
      .json(
        new ApiResponse(
          row.status === "ACTIVE" ? "E-way bill generated" : "E-way bill refused",
          row
        )
      );
  })
);
router.get(
  "/:id",
  requirePermission("eway-bill.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("E-way bill", await ewayBillService.get(idParam.parse(req.params.id)))
    );
  })
);
router.post(
  "/:id/part-b",
  requirePermission("eway-bill.update"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Part B updated",
        await ewayBillService.updatePartB(
          idParam.parse(req.params.id),
          partBSchema.parse(req.body),
          actorOf(req)
        )
      )
    );
  })
);
router.post(
  "/:id/extend",
  requirePermission("eway-bill.update"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Validity extended",
        await ewayBillService.extend(
          idParam.parse(req.params.id),
          extendSchema.parse(req.body),
          actorOf(req)
        )
      )
    );
  })
);
router.post(
  "/:id/cancel",
  requirePermission("eway-bill.cancel"),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason, remarks } = cancelSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "E-way bill cancelled",
        await ewayBillService.cancel(idParam.parse(req.params.id), reason, remarks, actorOf(req))
      )
    );
  })
);

export default router;
