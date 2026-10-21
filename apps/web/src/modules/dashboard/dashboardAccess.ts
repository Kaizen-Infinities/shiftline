/**
 * Which dashboard feeds a role may read (SET-B07). The dashboard requests a feed only when this
 * says so; the keys mirror what the API accepts on each endpoint.
 */

/** GET /api/dashboard/summary accepts any of these widget keys. */
export const DASHBOARD_WIDGET_KEYS = [
  "dash-overview.view",
  "dash-trend.view",
  "dash-tasks.view",
  "dash-inventory.view",
  "dash-machines.view",
  "dash-top-products.view",
  "dash-recent-sales.view",
] as const;

/** GET /api/payroll/employees and /attendance accept any payroll view key. */
export const PAYROLL_VIEW_KEYS = [
  "payroll.view",
  "payroll-run.view",
  "payroll-settings.view",
  "payroll-attendance.view",
  "payroll-advance.view",
] as const;

export interface DashboardAccess {
  /** Summary feeding the order, plan, stock and customer tiles. */
  summary: boolean;
  /** Bank, cash, receivables and payables (GET /api/dashboard/accounts-summary). */
  accounts: boolean;
  /** Live field positions (GET /api/mobile/admin/positions). */
  fieldPositions: boolean;
  /** Payroll employees and attendance on the workforce tile. */
  payroll: boolean;
  /** Shift list on the workforce tile. */
  shifts: boolean;
}

/** `canAny` is the usePermission helper; a super admin passes every check. */
export const dashboardAccess = (canAny: (...keys: string[]) => boolean): DashboardAccess => ({
  summary: canAny(...DASHBOARD_WIDGET_KEYS),
  accounts: canAny("accounts.view", "vouchers.view"),
  fieldPositions: canAny("mobile-app.manage", "dash-overview.view"),
  payroll: canAny(...PAYROLL_VIEW_KEYS),
  shifts: canAny("shifts.view"),
});
