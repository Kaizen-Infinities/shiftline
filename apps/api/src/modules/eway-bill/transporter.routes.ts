import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  transporterSchema,
  transporterService,
  transporterUpdateSchema,
} from "./transporter.service";

/** /api/transporters (P1-12): the transporter master. */
const router = Router();
router.use(authMiddleware);
const idParam = z.string().uuid();

router.get(
  "/",
  requirePermission("transporters.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Transporters",
        await transporterService.list({ includeInactive: req.query.includeInactive === "true" })
      )
    );
  })
);
router.post(
  "/",
  requirePermission("transporters.create"),
  asyncHandler(async (req: Request, res: Response) => {
    res
      .status(201)
      .json(
        new ApiResponse(
          "Transporter created",
          await transporterService.create(transporterSchema.parse(req.body))
        )
      );
  })
);
router.get(
  "/:id",
  requirePermission("transporters.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("Transporter", await transporterService.get(idParam.parse(req.params.id)))
    );
  })
);
router.put(
  "/:id",
  requirePermission("transporters.edit"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Transporter updated",
        await transporterService.update(
          idParam.parse(req.params.id),
          transporterUpdateSchema.parse(req.body)
        )
      )
    );
  })
);
router.delete(
  "/:id",
  requirePermission("transporters.delete"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Transporter retired",
        await transporterService.retire(idParam.parse(req.params.id))
      )
    );
  })
);

export default router;
