import { z } from "zod";
import { plainText } from "../../utils/plainText";

export const createDepartmentSchema = z.object({
  body: z.object({
    name: plainText(
      z
        .string()
        .min(2, "Department name is required")
        .max(100)
    ),
    description: z
      .string()
      .max(500)
      .optional()
      .nullable(),
  }),
});

export const updateDepartmentSchema = z.object({
  body: z.object({
    name: plainText(
      z
        .string()
        .min(2, "Department name is required")
        .max(100)
    ),
    description: z
      .string()
      .max(500)
      .optional()
      .nullable(),
  }),

  params: z.object({
    id: z.string(),
  }),
});

export const departmentIdSchema = z.object({
  params: z.object({
    id: z.string(),
  }),
});