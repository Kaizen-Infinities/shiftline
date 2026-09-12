/**
 * Feature registry (P1-01). A feature is a sellable slice of the product; each
 * permission-registry module belongs to exactly one feature, so the API can gate
 * every route from its permission check and the web app can hide what a plan
 * does not include, without per-route wiring. `core` is always on.
 */
export interface FeatureDef {
  key: string;
  name: string;
  description: string;
  /** Permission-registry modules unlocked by this feature. */
  modules: readonly string[];
}

export const FEATURES: readonly FeatureDef[] = [
  {
    key: "core",
    name: "Core",
    description: "Company, users and roles, masters, dashboard, notifications, imports",
    modules: [
      "dash-overview",
      "dash-trend",
      "dash-tasks",
      "dash-recent-sales",
      "dash-top-products",
      "users",
      "roles",
      "departments",
      "permissions",
      "role-permissions",
      "profile",
      "company-settings",
      "whatsapp",
      "email-config",
      "invoice-settings",
      "retention",
      "account-export",
      "employees",
      "shifts",
      "customers",
      "customer-types",
      "customer-grades",
      "suppliers",
      "products",
      "sales_products",
      "categories",
      "sub-categories",
      "uoms",
      "product-images",
      "colors",
      "sizes",
      "product-pricing",
    ],
  },
  {
    key: "sales",
    name: "Sales and dispatch",
    description: "Quotations, sales orders, tax invoices, returns, dispatch, GST on documents",
    modules: [
      "sales-orders",
      "draft-orders",
      "quotations",
      "pending-quotations",
      "sales-invoices",
      "sales-returns",
      "advances",
      "currencies",
      "job-work",
      "goods-dispatch",
      "sales-reports",
      "gst_tax",
    ],
  },
  {
    key: "purchase",
    name: "Purchase",
    description: "Purchase orders, GRN and supplier bills, expenses, purchase returns",
    modules: [
      "purchaseOrders",
      "invoice",
      "expenses",
      "purchase-returns",
      "supplierpricelist",
      "purchase-reports",
    ],
  },
  {
    key: "inventory",
    name: "Inventory",
    description: "Raw materials, stores, stock movements, adjustments, end-of-day stock",
    modules: [
      "raw_materials",
      "raw_material_categories",
      "wastage-store",
      "raw_material_stocks",
      "raw_material_transactions",
      "finished_goods_stocks",
      "finished_goods_transactions",
      "wastage-stock",
      "stock-adjustments",
      "eod-stock",
      "stores",
      "store-types",
      "locations",
      "inventory-reports",
      "dash-inventory",
      "bill_of_materials",
    ],
  },
  {
    key: "production",
    name: "Production",
    description: "Machines, production orders, weekly and daily planning, hourly output, OEE",
    modules: [
      "machines",
      "machine-assignments",
      "production_orders",
      "weekly_programs",
      "daily-machine-planning",
      "hourly_productions",
      "production-wastages",
      "shift-execution",
      "oee-dashboard",
      "production-reports",
      "dash-machines",
    ],
  },
  {
    key: "accounts",
    name: "Accounts",
    description: "Ledgers, vouchers, receivables and payables, petty cash, audit reports",
    modules: [
      "accounts",
      "payable",
      "receivable",
      "vouchers",
      "petty-cash",
      "chart-of-accounts",
      "audit-reports",
      "year-end",
      "filings",
      "tally",
    ],
  },
  {
    key: "payroll",
    name: "Payroll",
    description: "Attendance, salary runs, advances, statutory deductions",
    modules: [
      "payroll",
      "payroll-run",
      "payroll-settings",
      "payroll-attendance",
      "payroll-advance",
      "payroll-extended-comp",
    ],
  },
  {
    key: "field-app",
    name: "Field app",
    description: "Sales executives' mobile app: visits, orders, collections, live map",
    modules: ["mobile-app"],
  },
  {
    key: "gst-compliance",
    name: "GST compliance",
    description: "E-invoicing, e-way bills and GST returns from the books",
    modules: ["e-invoice", "eway-bill", "transporters", "gst-returns", "tds"],
  },
  {
    key: "insights",
    name: "Insights API",
    description: "Read-only aggregations for TV walls and external dashboards (P1-05)",
    modules: ["insights"],
  },
  {
    key: "api-access",
    name: "API access",
    description: "Integration tokens for third-party systems",
    modules: [],
  },
];

export const FEATURE_KEYS: readonly string[] = FEATURES.map((f) => f.key);

const MODULE_TO_FEATURE: ReadonlyMap<string, string> = new Map(
  FEATURES.flatMap((f) => f.modules.map((m) => [m, f.key] as [string, string]))
);

/** Feature a permission-registry module belongs to; unknown modules count as core. */
export const featureForModule = (module: string): string => MODULE_TO_FEATURE.get(module) ?? "core";

/** Feature behind a permission key such as `production_orders.view`. */
export const featureForPermission = (permission: string): string =>
  featureForModule(permission.split(".")[0] ?? "");

export interface PlanTierDef {
  code: string;
  name: string;
  description: string;
  features: readonly string[];
  /** Seats: active users plus pending invitations; null means unlimited. */
  seatLimit: number | null;
  /** API requests per tenant per 15 minutes; null means the platform default. */
  apiLimit: number | null;
  priceInrMonthly: number | null;
  sortOrder: number;
}

/** Default catalogue; the platform stores it in `plans` and may edit it without a deploy. */
export const PLAN_TIERS: readonly PlanTierDef[] = [
  {
    code: "STARTER",
    name: "Starter",
    description: "Sales, purchase and inventory for a small unit",
    features: ["core", "sales", "purchase", "inventory"],
    seatLimit: 5,
    apiLimit: 600,
    priceInrMonthly: 2999,
    sortOrder: 1,
  },
  {
    code: "GROWTH",
    name: "Growth",
    description: "Adds production planning, books of account and the field app",
    features: [
      "core",
      "sales",
      "purchase",
      "inventory",
      "production",
      "accounts",
      "field-app",
      "gst-compliance",
    ],
    seatLimit: 25,
    apiLimit: 3000,
    priceInrMonthly: 7999,
    sortOrder: 2,
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    description: "Everything, including payroll, insights and API access",
    features: FEATURE_KEYS,
    seatLimit: null,
    apiLimit: 12000,
    priceInrMonthly: null,
    sortOrder: 3,
  },
];

export const DEFAULT_PLAN_CODE = "STARTER";
export const TRIAL_DAYS = 14;
