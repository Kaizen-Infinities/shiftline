import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { accountExportService } from "./account-export.service";

/**
 * /api/account-export (P1-03): request, list and download a full account export. The signed
 * `download` link needs no login and expires with the file; everything else is authenticated.
 */
const router = Router();
const idParam = z.string().uuid();

const send = async (
  res: Response,
  file: { stream: NodeJS.ReadableStream; fileName: string; size: number }
) => {
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  file.stream.pipe(res);
};

// Signed link (no auth): token in the query string, 24-hour life.
router.get(
  "/:id/download",
  asyncHandler(async (req: Request, res: Response) => {
    const id = idParam.parse(req.params.id);
    const token = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(req.query.token);
    await send(res, await accountExportService.fileFor(id, token));
  })
);

router.use(authMiddleware);

router.get(
  "/",
  requirePermission("account-export.view"),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Account exports", await accountExportService.list()));
  })
);
router.post(
  "/",
  requirePermission("account-export.create"),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await accountExportService.request(req.user?.userId);
    res
      .status(result.queued ? 202 : 201)
      .json(new ApiResponse(result.queued ? "Export queued" : "Export ready", result));
  })
);
router.get(
  "/:id",
  requirePermission("account-export.view"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "Account export",
        await accountExportService.get(idParam.parse(req.params.id))
      )
    );
  })
);
router.get(
  "/:id/file",
  requirePermission("account-export.view"),
  asyncHandler(async (req: Request, res: Response) => {
    await send(res, await accountExportService.fileFor(idParam.parse(req.params.id)));
  })
);

export default router;
