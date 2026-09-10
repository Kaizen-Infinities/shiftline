import { Request, Response } from "express";
import { z } from "zod";

import { ApiResponse } from "../../utils/ApiResponse";
import { gstService } from "./gst.service";

const rate = z.coerce.number().min(0).max(100);

export const hsnListSchema = z.object({
  query: z.object({
    search: z.string().trim().max(60).optional(),
    type: z.enum(["HSN", "SAC"]).optional(),
    includeInactive: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }),
});

export const hsnCodeParamSchema = z.object({
  params: z.object({ code: z.string().regex(/^\d{4,8}$/) }),
});
export const idParamSchema = z.object({ params: z.object({ id: z.string().uuid() }) });

export const createHsnSchema = z.object({
  body: z.object({
    code: z
      .string()
      .trim()
      .regex(/^\d{4}(\d{2})?(\d{2})?$/, "4, 6 or 8 digits"),
    type: z.enum(["HSN", "SAC"]).optional(),
    description: z.string().trim().min(2).max(255),
    gstRate: rate,
    cessRate: rate.optional(),
    isActive: z.boolean().optional(),
  }),
});
export const updateHsnSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: createHsnSchema.shape.body.omit({ code: true }).partial(),
});

export const createRateSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(40),
    rate,
    cessRate: rate.optional(),
    isActive: z.boolean().optional(),
  }),
});
export const updateRateSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: createRateSchema.shape.body.partial(),
});

export const validateGstinSchema = z.object({
  body: z.object({ gstin: z.string().trim().min(15).max(15) }),
});

export const gstController = {
  states: async (_req: Request, res: Response) => {
    res.json(new ApiResponse("GST states", gstService.states()));
  },
  validateGstin: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "GSTIN checked",
        gstService.validateGstin((req.body as { gstin: string }).gstin)
      )
    );
  },

  listRates: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("GST slabs", await gstService.listRates(req.query.includeInactive === "true"))
    );
  },
  createRate: async (req: Request, res: Response) => {
    res
      .status(201)
      .json(new ApiResponse("GST slab created", await gstService.createRate(req.body)));
  },
  updateRate: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "GST slab updated",
        await gstService.updateRate(String(req.params.id), req.body)
      )
    );
  },
  deleteRate: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse("GST slab deactivated", await gstService.deleteRate(String(req.params.id)))
    );
  },

  listHsn: async (req: Request, res: Response) => {
    const q = req.query as unknown as {
      search?: string;
      type?: "HSN" | "SAC";
      includeInactive: boolean;
      limit?: number;
    };
    res.json(new ApiResponse("HSN/SAC codes", await gstService.listHsn(q)));
  },
  lookupHsn: async (req: Request, res: Response) => {
    res.json(new ApiResponse("HSN/SAC", await gstService.lookupHsn(String(req.params.code))));
  },
  createHsn: async (req: Request, res: Response) => {
    res.status(201).json(new ApiResponse("HSN/SAC created", await gstService.createHsn(req.body)));
  },
  updateHsn: async (req: Request, res: Response) => {
    res.json(
      new ApiResponse(
        "HSN/SAC updated",
        await gstService.updateHsn(String(req.params.id), req.body)
      )
    );
  },
  deleteHsn: async (req: Request, res: Response) => {
    res.json(new ApiResponse("HSN/SAC removed", await gstService.deleteHsn(String(req.params.id))));
  },
};
