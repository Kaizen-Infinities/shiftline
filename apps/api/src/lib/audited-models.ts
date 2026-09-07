/**
 * Models whose rows are written to `audit_log` by database trigger (P0-13, MCA Companies
 * (Accounts) Rules 3(1)): books of account, tax documents, payroll and the masters they depend
 * on. `scripts/gen-audit-migration.ts` turns this list into the trigger migration; the audit
 * trail viewer (`modules/audit-trail`) reads it to name the entities a tenant can filter by.
 * Add a model here, then generate a new migration.
 */
export const AUDITED_MODELS = [
  // books
  "Voucher",
  "JournalItem",
  "AccountLedger",
  "LedgerGroup",
  "AccountingPeriod",
  "BankAccount",
  "OpeningBalance",
  "YearEndClosing",
  // documents
  "SalesInvoice",
  "SalesInvoiceItem",
  "SalesInvoicePayment",
  "GrnInvoice",
  "GrnInvoiceItem",
  "SalesReturn",
  "PurchaseReturn",
  "Expense",
  "PettyCashEntry",
  "StockAdjustment",
  // payroll
  "PayrollRun",
  "Payslip",
  "EmployeePayrollConfig",
  // masters
  "Company",
  "BusinessPlace",
  "InvoiceSetting",
  "Customer",
  "Supplier",
  "Product",
  "RawMaterial",
  "User",
  "Role",
  "RolePermission",
  "RetentionPolicy",
  "MobileCollection",
  "Invitation",
  "Plan",
  "Subscription",
  "FeatureFlagOverride",
  "HsnCode",
  "GstRate",
] as const;

export type AuditedModel = (typeof AUDITED_MODELS)[number];
