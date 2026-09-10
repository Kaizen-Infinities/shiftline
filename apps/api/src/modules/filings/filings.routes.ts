import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { FILINGS } from "@shiftline/shared";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  draftSchema,
  filingApprovalService,
  listSchema,
  rejectSchema,
  submittedSchema,
} from "./filing-approval.service";

/** /api/filings (P1-04): the approval gates and the registry of statutory filings. */
const router = Router();
router.use(authMiddleware);
const idParam = z.string().uuid();
const actorOf = (req: Request) => ({
  userId: req.user?.userId,
  isSuperAdmin: Boolean(req.user?.isSuperAdmin),
});

router.get("/registry", requirePermission("filings.view"), (_req, res) => {
  res.json(new ApiResponse("Filings", FILINGS));
});
router.get(
  "/approvals",
  requirePermission("filings.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Filing approvals",
        await filingApprovalService.list(listSchema.parse(req.query))
      )
    );
  })
);
router.post(
  "/approvals",
  requirePermission("filings.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    const row = await filingApprovalService.upsertDraft(draftSchema.parse(req.body), actorOf(req));
    res.status(201).json(new ApiResponse("Draft registered", row));
  })
);
router.get(
  "/approvals/:id",
  requirePermission("filings.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Filing approval",
        await filingApprovalService.get(idParam.parse(req.params.id))
      )
    );
  })
);
router.post(
  "/approvals/:id/send",
  requirePermission("filings.prepare"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Sent for approval",
        await filingApprovalService.sendForApproval(idParam.parse(req.params.id), actorOf(req))
      )
    );
  })
);
router.post(
  "/approvals/:id/approve",
  requirePermission("filings.approve"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Approved",
        await filingApprovalService.approve(idParam.parse(req.params.id), actorOf(req))
      )
    );
  })
);
router.post(
  "/approvals/:id/reject",
  requirePermission("filings.approve"),
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = rejectSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "Rejected",
        await filingApprovalService.reject(idParam.parse(req.params.id), reason, actorOf(req))
      )
    );
  })
);
router.post(
  "/approvals/:id/submitted",
  requirePermission("filings.submit"),
  asyncHandler(async (req: Request, res: Response) => {
    const { submissionRef } = submittedSchema.parse(req.body);
    res.json(
      new ApiResponse(
        "Marked submitted",
        await filingApprovalService.markSubmitted(
          idParam.parse(req.params.id),
          submissionRef,
          actorOf(req)
        )
      )
    );
  })
);

export default router;
