import { RetentionAction, RetentionDataClass } from "@prisma/client";

/**
 * Statutory floors and defaults per data class. Books of account and anything
 * that feeds a filing must be kept for eight financial years (Companies Act
 * s.128(5); GST s.36 is shorter, income-tax assessments can reach further
 * back), so every books-adjacent class floors at 2,922 days and defaults to
 * RETAIN. Operational classes (sessions, login attempts, sync tombstones) may
 * be purged after a short floor that keeps security investigations possible.
 */
export const EIGHT_YEARS_DAYS = 2922;

export interface RetentionClassSpec {
  /** Smallest retentionDays a tenant may configure. */
  minDays: number;
  defaultDays: number;
  defaultAction: RetentionAction;
  /** Whether the sweep can archive/purge this class today; false means report only. */
  purgeable: boolean;
  description: string;
}

export const RETENTION_CLASSES: Record<RetentionDataClass, RetentionClassSpec> = {
  BOOKS: {
    minDays: EIGHT_YEARS_DAYS,
    defaultDays: EIGHT_YEARS_DAYS,
    defaultAction: "RETAIN",
    purgeable: false,
    description: "Vouchers, journal items, invoices, GRNs, returns and their ledgers",
  },
  FILINGS: {
    minDays: EIGHT_YEARS_DAYS,
    defaultDays: EIGHT_YEARS_DAYS,
    defaultAction: "RETAIN",
    purgeable: false,
    description: "GST, TDS and payroll filings and their approval records (from Phase 1)",
  },
  PAYROLL: {
    minDays: EIGHT_YEARS_DAYS,
    defaultDays: EIGHT_YEARS_DAYS,
    defaultAction: "RETAIN",
    purgeable: false,
    description: "Payroll runs, payslips and statutory registers",
  },
  AUDIT_LOGS: {
    minDays: EIGHT_YEARS_DAYS,
    defaultDays: EIGHT_YEARS_DAYS,
    defaultAction: "RETAIN",
    purgeable: true,
    description: "Audit trail entries (MCA Rule 3(1)); archive before purge",
  },
  EOD_SNAPSHOTS: {
    minDays: EIGHT_YEARS_DAYS,
    defaultDays: EIGHT_YEARS_DAYS,
    defaultAction: "RETAIN",
    purgeable: true,
    description: "End-of-day stock snapshots (stock register)",
  },
  SESSIONS: {
    minDays: 30,
    defaultDays: 90,
    defaultAction: "PURGE",
    purgeable: true,
    description: "Expired and signed-out user sessions",
  },
  LOGIN_ATTEMPTS: {
    minDays: 90,
    defaultDays: 365,
    defaultAction: "PURGE",
    purgeable: true,
    description: "Login attempt history for this tenant's users",
  },
  SYNC_TOMBSTONES: {
    minDays: 30,
    defaultDays: 30,
    defaultAction: "PURGE",
    purgeable: true,
    description: "Mobile sync records and soft-deleted mobile rows",
  },
};

export const RETENTION_DATA_CLASSES = Object.keys(RETENTION_CLASSES) as RetentionDataClass[];

/** Login attempts that belong to no tenant (unknown usernames, platform admins). */
export const PLATFORM_LOGIN_ATTEMPT_DAYS = 365;
