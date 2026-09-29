import { z } from "zod";
import { SUPPORTED_LOCALES } from "@shiftline/shared";

/**
 * PATCH /api/users/me/locale (TN-04). Strict: only `locale` is accepted, so a caller cannot
 * name another user (the target is always the signed-in user from the token).
 */
export const updateMyLocaleSchema = z.object({
  body: z
    .object({
      locale: z.enum(SUPPORTED_LOCALES, { message: "Language must be one of: en, ta" }),
    })
    .strict(),
});

export type UpdateMyLocaleDto = z.infer<typeof updateMyLocaleSchema>["body"];
