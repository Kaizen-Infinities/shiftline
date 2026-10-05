import { z } from "zod";
import { SUPPORTED_LOCALES } from "@shiftline/shared";
import { passwordSchema } from "../auth/auth.validation";

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

/** POST /api/users: same account and password rules as /api/auth/register. */
export const createUserSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(3, "Full name must be at least 3 characters").max(200),
    email: z.string().email("Invalid email format").optional(),
    username: z.string().trim().min(3, "Username must be at least 3 characters").max(50),
    password: passwordSchema,
    employeeId: z.coerce.number().int().positive().nullish(),
    roleId: z.coerce.number().int().positive(),
  }),
});
