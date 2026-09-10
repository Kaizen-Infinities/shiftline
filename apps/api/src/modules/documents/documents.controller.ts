import type { Request, Response } from "express";
import { z } from "zod";

import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { DOCUMENT_PREFIXES, documentNumberService } from "./document-number.service";

const nextNumberQuery = z.object({
  docType: z.string().refine((t) => t in DOCUMENT_PREFIXES, "Unknown document type"),
  businessPlaceId: z.coerce.bigint().optional(),
  date: z.coerce.date().optional(),
});

export const documentsController = {
  /** The number the next document of this type would take, without consuming it. */
  nextNumber: async (req: Request, res: Response) => {
    const parsed = nextNumberQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid query");
    }
    const { docType, businessPlaceId, date } = parsed.data;
    const number = await documentNumberService.peek(docType, { businessPlaceId, date });
    res.json(new ApiResponse("Next document number", { docType, number }));
  },
};
