import { z } from "zod";

/**
 * Names and codes are plain text. Angle brackets are refused so markup saved on a master record
 * cannot reach a print template, export or e-mail as HTML (R2H-B12). React already escapes these
 * on screen; this keeps the stored value clean as well.
 */
export const PLAIN_TEXT_MESSAGE = "Angle brackets < and > are not allowed";

export const plainText = (schema: z.ZodString) =>
  schema.refine((value) => !/[<>]/.test(value), PLAIN_TEXT_MESSAGE);
