import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";

import { requireAnyPermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { importsService } from "./imports.service";
import { IMPORT_TYPES, MAX_FILE_BYTES, importTypeDef } from "./imports.types";

export const importTypeSchema = z.object({
  params: z.object({ type: z.enum(IMPORT_TYPES) }),
});

export const runImportSchema = z.object({
  params: z.object({ type: z.enum(IMPORT_TYPES) }),
  query: z.object({
    dryRun: z
      .preprocess((v) => (v === undefined ? "true" : v), z.enum(["true", "false", "1", "0"]))
      .transform((v) => v === "true" || v === "1"),
  }),
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okName = /\.(csv|txt)$/i.test(file.originalname);
    const okType =
      /^(text\/csv|text\/plain|application\/vnd\.ms-excel|application\/csv|application\/octet-stream)$/i.test(
        file.mimetype
      );
    if (okName || okType) cb(null, true);
    else cb(new ApiError(400, "Upload a .csv file"));
  },
});

/** Multer errors become 4xx; the field is `file`. */
export const uploadCsv = (req: Request, res: Response, next: NextFunction) =>
  csvUpload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new ApiError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.message));
    }
    next(err);
  });

/** The import type decides which permission is needed. */
export const requireImportPermission = (req: Request, res: Response, next: NextFunction) => {
  const def = importTypeDef(String(req.params.type));
  if (!def) return next(new ApiError(404, "Unknown import type"));
  return requireAnyPermission(...def.permissions)(req, res, next);
};

const userCan = (req: Request, permissions: string[]) => {
  const user = req.user;
  if (!user) return false;
  if (user.isSuperAdmin || user.userId?.startsWith("admin_")) return true;
  return Array.isArray(user.permissions) && permissions.some((p) => user.permissions.includes(p));
};

export const importsController = {
  /** Import types the caller may run, with their columns (drives the web page and the templates). */
  types: async (req: Request, res: Response) => {
    const types = importsService.types().filter((d) => userCan(req, d.permissions));
    res.json(new ApiResponse("Import types", types));
  },

  template: async (req: Request, res: Response) => {
    const type = String(req.params.type);
    const csv = importsService.template(type);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="shiftline-${type}-template.csv"`);
    res.send(csv);
  },

  /** `?dryRun=true` (default) validates only; `?dryRun=false` imports when no row has an error. */
  run: async (req: Request, res: Response) => {
    const type = String(req.params.type);
    const { dryRun } = req.query as unknown as { dryRun: boolean };
    const file = (req as Request & { file?: Express.Multer.File }).file;
    const inline = typeof req.body?.csv === "string" ? (req.body.csv as string) : undefined;
    if (!file && !inline) throw new ApiError(400, "Attach the CSV as the `file` field");
    const csv = file ? file.buffer.toString("utf8") : inline!;

    const analysis = await importsService.analyse(type, csv);
    if (dryRun) {
      return res.json(new ApiResponse("Dry run complete", analysis.report));
    }
    if (analysis.report.errors > 0) {
      return res.status(400).json({
        success: false,
        message: "Fix the rows marked as errors before importing",
        data: analysis.report,
      });
    }
    const report = await importsService.commit(analysis, req.user!.userId);
    res
      .status(report.failed ? 207 : 201)
      .json(
        new ApiResponse(
          report.failed
            ? `Imported ${report.imported} row(s); stopped at row ${report.failed.row}`
            : `Imported ${report.imported} row(s)`,
          report
        )
      );
  },
};
