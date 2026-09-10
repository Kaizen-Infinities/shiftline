import type { Request, Response } from "express";
import type { ZodType } from "zod";

import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { yearEndService, type Actor } from "./year-end.service";
import {
  prepareYearEndSchema,
  previewYearEndQuerySchema,
  reverseYearEndSchema,
} from "./year-end.types";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid request");
  }
  return parsed.data;
};

const actorOf = (req: Request): Actor => {
  const user = (req as Request & { user?: { userId?: string; isSuperAdmin?: boolean } }).user;
  return { userId: user?.userId, isSuperAdmin: !!user?.isSuperAdmin };
};

const idOf = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, "Invalid closing id");
  return id;
};

export const yearEndController = {
  list: async (_req: Request, res: Response) => {
    res.json(new ApiResponse("Year-end closings", await yearEndService.list()));
  },

  preview: async (req: Request, res: Response) => {
    const { fyCode } = parse(previewYearEndQuerySchema, req.query);
    res.json(new ApiResponse("Year-end preview", await yearEndService.preview(fyCode)));
  },

  prepare: async (req: Request, res: Response) => {
    const body = parse(prepareYearEndSchema, req.body ?? {});
    const row = await yearEndService.prepare(body, actorOf(req));
    res.status(201).json(new ApiResponse("Year-end closing prepared", row));
  },

  approve: async (req: Request, res: Response) => {
    const row = await yearEndService.approve(idOf(req), actorOf(req));
    res.json(new ApiResponse("Year closed", row));
  },

  reverse: async (req: Request, res: Response) => {
    const { reason } = parse(reverseYearEndSchema, req.body ?? {});
    const row = await yearEndService.reverse(idOf(req), reason, actorOf(req));
    res.json(new ApiResponse("Year-end closing reversed", row));
  },

  discard: async (req: Request, res: Response) => {
    const row = await yearEndService.discard(idOf(req), actorOf(req));
    res.json(new ApiResponse("Year-end closing discarded", row));
  },
};
