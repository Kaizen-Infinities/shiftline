import { GST_STATE_BY_CODE, isValidGstin } from "@shiftline/shared";
import { z } from "zod";

/**
 * Onboarding wizard (P1-00 part 2). `Company.onboardingStep` holds the next step
 * to complete; every step may be revisited until the owner completes onboarding.
 */
export const ONBOARDING_STEPS = [
  "company",
  "gst",
  "financial-year",
  "bank",
  "users",
  "review",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const STEP_LABELS: Record<OnboardingStep, string> = {
  company: "Company details",
  gst: "GST and places of business",
  "financial-year": "Financial year",
  bank: "Bank accounts",
  users: "Invite your team",
  review: "Review and finish",
};

/** Bump when the terms change; the accepted version is kept with the timestamp. */
export const TOS_VERSION = "2026-09";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const gstinField = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isValidGstin, "GSTIN is not valid (format or check digit)");

export const stateCodeField = z
  .string()
  .regex(/^\d{2}$/, "State code is two digits")
  .refine((c) => GST_STATE_BY_CODE.has(c), "Unknown GST state code");

export const companyStepSchema = z.object({
  body: z.object({
    companyName: trimmed(160).min(2, "Company name is required"),
    legalName: optionalTrimmed(160),
    shortName: optionalTrimmed(60),
    email: z.string().trim().email().max(120).optional().nullable().or(z.literal("")),
    phone: optionalTrimmed(20),
    website: z.string().trim().url().max(200).optional().nullable().or(z.literal("")),
    addressLine1: optionalTrimmed(255),
    city: optionalTrimmed(100),
    state: optionalTrimmed(100),
    zipcode: optionalTrimmed(20),
    country: optionalTrimmed(100),
  }),
});
export type CompanyStepInput = z.infer<typeof companyStepSchema>["body"];

export const businessPlaceInput = z.object({
  id: z.string().regex(/^\d+$/).optional().nullable(),
  code: trimmed(20).min(1, "Code is required").toUpperCase(),
  name: trimmed(120).min(1, "Name is required"),
  type: z.enum(["HEAD_OFFICE", "BRANCH_OFFICE", "FACTORY", "WAREHOUSE", "RETAIL_STORE"]),
  gstPlaceCode: stateCodeField,
  /** Separate GSTIN for a branch registration; blank places reuse the company's (head office). */
  gstin: gstinField.optional().nullable().or(z.literal("")),
  phone: optionalTrimmed(20),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal("")),
  addressLine1: optionalTrimmed(255),
  city: optionalTrimmed(100),
  zipcode: optionalTrimmed(20),
  isHeadOffice: z.boolean().optional().default(false),
});

export const GST_REGISTRATION_TYPES = ["REGULAR", "COMPOSITION", "UNREGISTERED"] as const;

export const gstStepSchema = z.object({
  body: z
    .object({
      registrationType: z.enum(GST_REGISTRATION_TYPES),
      gstin: gstinField.optional().nullable().or(z.literal("")),
      businessPlaces: z.array(businessPlaceInput).min(1, "At least the head office is required"),
    })
    .superRefine((b, ctx) => {
      if (b.registrationType !== "UNREGISTERED" && !b.gstin) {
        ctx.addIssue({
          code: "custom",
          path: ["gstin"],
          message: "GSTIN is required for a registered business",
        });
      }
      const heads = b.businessPlaces.filter((p) => p.isHeadOffice || p.type === "HEAD_OFFICE");
      if (heads.length !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["businessPlaces"],
          message: "Exactly one place must be the head office",
        });
      }
      const codes = new Set<string>();
      for (const p of b.businessPlaces) {
        if (codes.has(p.code)) {
          ctx.addIssue({
            code: "custom",
            path: ["businessPlaces"],
            message: `Duplicate place code ${p.code}`,
          });
        }
        codes.add(p.code);
      }
      for (const p of b.businessPlaces) {
        if (p.gstin && p.gstin.slice(0, 2) !== p.gstPlaceCode) {
          ctx.addIssue({
            code: "custom",
            path: ["businessPlaces"],
            message: `Place ${p.code}: the GSTIN state does not match its state`,
          });
        }
      }
      if (b.gstin && heads[0] && heads[0].gstPlaceCode !== b.gstin.slice(0, 2)) {
        ctx.addIssue({
          code: "custom",
          path: ["gstin"],
          message: "The GSTIN state code must match the head office state",
        });
      }
    }),
});
export type GstStepInput = z.infer<typeof gstStepSchema>["body"];

const isoDate = z.coerce.date();

export const financialYearStepSchema = z.object({
  body: z
    .object({
      /** First day of the financial year; must be the first of a month. */
      fyStart: isoDate,
      /** Date from which books are kept in Shiftline (opening balances); defaults to fyStart. */
      booksBeginOn: isoDate.optional().nullable(),
    })
    .superRefine((b, ctx) => {
      if (b.fyStart.getUTCDate() !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["fyStart"],
          message: "The financial year starts on the first day of a month",
        });
      }
      if (b.booksBeginOn) {
        const end = new Date(Date.UTC(b.fyStart.getUTCFullYear() + 1, b.fyStart.getUTCMonth(), 0));
        if (b.booksBeginOn < b.fyStart || b.booksBeginOn > end) {
          ctx.addIssue({
            code: "custom",
            path: ["booksBeginOn"],
            message: "Books must begin within the financial year",
          });
        }
      }
    }),
});
export type FinancialYearStepInput = z.infer<typeof financialYearStepSchema>["body"];

export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const bankAccountInput = z.object({
  /** Existing bank ledger to update (for example the provisioned Main Bank Account). */
  ledgerId: z.coerce.number().int().positive().optional().nullable(),
  name: trimmed(160).min(2, "Account name is required"),
  bankName: trimmed(120).min(2, "Bank name is required"),
  accountName: optionalTrimmed(160),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{6,34}$/, "Account number is 6–34 letters or digits")
    .optional()
    .nullable()
    .or(z.literal("")),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IFSC_REGEX, "IFSC is 4 letters, 0, then 6 characters")
    .optional()
    .nullable()
    .or(z.literal("")),
  branch: optionalTrimmed(120),
  upiId: optionalTrimmed(80),
  openingBalance: z.coerce.number().min(0).max(1e13).optional().default(0),
  isDefault: z.boolean().optional().default(false),
});

export const bankStepSchema = z.object({
  body: z.object({
    accounts: z.array(bankAccountInput).max(20),
  }),
});
export type BankStepInput = z.infer<typeof bankStepSchema>["body"];

export const usersStepSchema = z.object({
  body: z.object({
    invitations: z
      .array(
        z.object({
          email: z.string().trim().email().max(120),
          fullName: optionalTrimmed(160),
          roleCode: trimmed(40).min(1),
        })
      )
      .max(50),
  }),
});
export type UsersStepInput = z.infer<typeof usersStepSchema>["body"];

export const acceptTosSchema = z.object({
  body: z.object({
    /** Must match the current terms version so a stale page cannot accept old terms. */
    version: z.literal(TOS_VERSION),
  }),
});
