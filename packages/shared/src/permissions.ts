/**
 * PERMISSION REGISTRY — single source of truth for permission keys.
 * Consumed by the API (middleware, bootstrap) and the web app (routes, sidebar, role matrix).
 * Key format: <module>.<action>, e.g. "users.view".
 */
export interface ModulePermission {
  module: string;
  actions: string[];
  description: string;
}

export const PERMISSION_REGISTRY: ModulePermission[] = [
  // ── Dashboard Widgets ────────────────────────────────────────────────────────
  { module: "dash-overview", actions: ["view"], description: "Dashboard Overview Stats" },
  { module: "dash-trend", actions: ["view"], description: "Dashboard Sales & Purchase Trend" },
  { module: "dash-tasks", actions: ["view"], description: "Dashboard Today's Tasks" },
  { module: "dash-inventory", actions: ["view"], description: "Dashboard Stock / Inventory" },
  { module: "dash-machines", actions: ["view"], description: "Dashboard Machine Overview" },
  { module: "dash-top-products", actions: ["view"], description: "Dashboard Top Products" },
  { module: "dash-recent-sales", actions: ["view"], description: "Dashboard Recent Sales Orders" },

  // ── Administration ──────────────────────────────────────────────────────────
  {
    module: "users",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "System Users",
  },
  {
    module: "roles",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "User Roles",
  },
  {
    module: "departments",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Departments",
  },
  {
    module: "permissions",
    actions: ["view", "create", "edit", "delete"],
    description: "Permissions",
  },
  { module: "role-permissions", actions: ["view", "edit"], description: "Role Permission Mapping" },
  { module: "profile", actions: ["view", "edit"], description: "User Profile" },
  { module: "company-settings", actions: ["view", "edit"], description: "Company Settings" },
  {
    module: "gst_tax",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "GST Tax Rates",
  },
  { module: "whatsapp", actions: ["view", "edit"], description: "WhatsApp Settings" },
  { module: "email-config", actions: ["view", "edit"], description: "Email Config" },
  { module: "invoice-settings", actions: ["view", "edit"], description: "Invoice Settings" },
  { module: "retention", actions: ["view", "edit"], description: "Data Retention" },
  { module: "account-export", actions: ["view", "create"], description: "Account Export" },
  {
    module: "mobile-app",
    actions: ["view", "create", "manage"],
    description: "Field App (sync, collections, route planning)",
  },
  {
    module: "insights",
    actions: ["view"],
    description: "Insights API (companion app, TV wall, integrations)",
  },
  {
    module: "e-invoice",
    actions: ["view", "generate", "cancel", "settings"],
    description: "E-invoicing (IRN, signed QR, cancellation, GSP credentials)",
  },
  {
    module: "eway-bill",
    actions: ["view", "generate", "update", "cancel"],
    description: "E-way bills (generate, Part B, extend, cancel, consolidate)",
  },
  {
    module: "transporters",
    actions: ["view", "create", "edit", "delete"],
    description: "Transporter master",
  },
  {
    module: "gst-returns",
    actions: ["view", "prepare", "file"],
    description: "GST returns from the books (GSTR-1, 3B, 2B, IMS, GSTR-9)",
  },
  {
    module: "payments",
    actions: ["view", "create", "cancel", "settings"],
    description: "Payment links and gateway settings",
  },
  {
    module: "sms",
    actions: ["view", "send", "settings"],
    description: "SMS, DLT templates and one-time passwords",
  },

  // ── HR & Organization ───────────────────────────────────────────────────────
  {
    module: "employees",
    // "search" (P2-15) is a lighter key than "view": a typeahead over id/code/name/department/
    // business place for the HR screens that need to pick an employee (leave, fines) but do not
    // hold payroll.view — granted to every role that already holds leave.view, fines.view or
    // payroll.view (see provisioning.service.ts).
    actions: ["view", "create", "edit", "delete", "export", "search"],
    description: "Employees",
  },
  {
    module: "machines",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Machines",
  },
  {
    module: "machine-assignments",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Machine Assignments",
  },
  {
    module: "shifts",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Shift Management",
  },

  // ── Product Setup ───────────────────────────────────────────────────────────
  {
    module: "products",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Product Master",
  },
  {
    module: "sales_products",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Sales Products",
  },
  {
    module: "categories",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Categories",
  },
  {
    module: "sub-categories",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Sub Categories",
  },
  {
    module: "uoms",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Units of Measure",
  },
  {
    module: "raw_materials",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Raw Materials",
  },
  {
    module: "raw_material_categories",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "RM Categories",
  },
  {
    module: "wastage-store",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Wastage Store",
  },
  { module: "product-images", actions: ["view", "edit", "delete"], description: "Product Images" },
  {
    module: "colors",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Colors",
  },
  {
    module: "sizes",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Sizes",
  },
  {
    module: "product-pricing",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Product Pricing",
  },

  // ── Purchase ────────────────────────────────────────────────────────────────
  {
    module: "suppliers",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Suppliers",
  },
  {
    module: "supplierpricelist",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Supplier Pricing",
  },
  {
    module: "purchaseOrders",
    actions: ["view", "create", "edit", "delete", "export", "whatsapp-email"],
    description: "Purchase Orders",
  },
  {
    module: "invoice",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Bill & Invoice",
  },
  {
    module: "expenses",
    actions: ["view", "create", "edit", "delete", "export", "approve"],
    description: "Expenses",
  },
  {
    module: "purchase-returns",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Purchase Returns",
  },

  // ── Customer masters ───────────────────────────────────────────────────────
  {
    module: "customer-types",
    actions: ["view", "create", "edit", "delete"],
    description: "Customer Types",
  },
  {
    module: "customer-grades",
    actions: ["view", "create", "edit", "delete"],
    description: "Customer Grades",
  },

  // ── Sales ───────────────────────────────────────────────────────────────────
  {
    module: "customers",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Customers",
  },
  {
    module: "sales-orders",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Sales Orders",
  },
  {
    module: "draft-orders",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Draft Orders",
  },
  {
    module: "quotations",
    actions: ["view", "create", "edit", "delete", "export", "whatsapp-email"],
    description: "Quotations",
  },
  { module: "pending-quotations", actions: ["view", "edit"], description: "Sales MD Approvals" },
  {
    module: "sales-invoices",
    actions: ["view", "create", "edit", "delete", "export", "whatsapp-email"],
    description: "Sales Invoice",
  },
  {
    module: "sales-returns",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Sales Returns",
  },
  {
    module: "advances",
    actions: ["view", "create", "refund", "export"],
    description: "Advances received (receipt vouchers, adjustment, refund)",
  },
  {
    module: "currencies",
    actions: ["view", "edit"],
    description: "Currency master and exchange rates",
  },
  {
    module: "job-work",
    actions: ["view", "create", "manage", "export", "cancel", "file"],
    description: "Job work, delivery challans and ITC-04",
  },
  {
    module: "tds",
    actions: ["view", "create", "manage", "pay", "prepare", "file"],
    description: "TDS and TCS: sections, deductions, challans, 26Q/27Q and Form 16A",
  },
  {
    module: "banking",
    actions: ["view", "manage"],
    description: "Bank statements, reconciliation and the cheque register",
  },
  {
    module: "costing",
    actions: ["view", "manage"],
    description: "Stock valuation, cost centres, budgets and cost sheets",
  },
  {
    module: "imports",
    actions: ["view", "create", "manage"],
    description: "Imports: bills of entry, customs duty and landed cost",
  },
  {
    module: "assets",
    actions: ["view", "create", "manage", "depreciate", "dispose"],
    description: "Fixed assets: the register, depreciation and the year-end reports",
  },
  {
    module: "tally",
    actions: ["view", "export", "manage"],
    description: "Tally XML export: masters, vouchers and the name mapping",
  },

  // ── Production ──────────────────────────────────────────────────────
  {
    module: "production_orders",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Production Orders",
  },
  {
    module: "weekly_programs",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Weekly Schedules",
  },
  {
    module: "daily-machine-planning",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Daily Planning",
  },
  {
    module: "hourly_productions",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Hourly Reports",
  },
  {
    module: "production-wastages",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Production Wastage",
  },
  {
    module: "goods-dispatch",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Goods Dispatch",
  },
  { module: "shift-execution", actions: ["view", "edit"], description: "Shift Execution Board" },
  { module: "oee-dashboard", actions: ["view", "export"], description: "OEE Dashboard" },
  {
    module: "bill_of_materials",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Bill of Materials",
  },

  // ── Inventory ───────────────────────────────────────────────────────────────
  {
    module: "raw_material_stocks",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Raw Material Stock",
  },
  {
    module: "raw_material_transactions",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "RM Transactions",
  },
  {
    module: "finished_goods_stocks",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Finished Goods Stock",
  },
  {
    module: "finished_goods_transactions",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "FG Transactions",
  },
  {
    module: "wastage-stock",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Wastage Stock",
  },
  {
    module: "stock-adjustments",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Stock Adjustments",
  },
  { module: "eod-stock", actions: ["view", "create", "edit", "export"], description: "EOD Stock" },

  // ── Store ──────────────────────────────────────────────────────────────────
  {
    module: "stores",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Storage Stores",
  },
  {
    module: "store-types",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Store Types",
  },
  {
    module: "locations",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Locations",
  },

  // ── Reports ─────────────────────────────────────────────────────────────────
  { module: "sales-reports", actions: ["view", "export"], description: "Sales Reports" },
  { module: "purchase-reports", actions: ["view", "export"], description: "Purchase Reports" },
  { module: "inventory-reports", actions: ["view", "export"], description: "Inventory Reports" },
  { module: "production-reports", actions: ["view", "export"], description: "Production Reports" },
  { module: "audit-reports", actions: ["view", "export"], description: "Audit Reports" },
  { module: "year-end", actions: ["view", "prepare", "approve"], description: "Year-End Closing" },
  {
    module: "filings",
    actions: ["view", "prepare", "approve", "submit"],
    description: "Filing Approvals",
  },

  // ── Accounts ─────────────────────────────────────────────────────────────────
  {
    module: "accounts",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Accounts",
  },
  {
    module: "payable",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Accounts Payable",
  },
  {
    module: "receivable",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Accounts Receivable",
  },
  {
    module: "vouchers",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Vouchers",
  },
  {
    module: "petty-cash",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Petty Cash",
  },
  {
    module: "chart-of-accounts",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Chart of Accounts",
  },

  // ── Payroll ──────────────────────────────────────────────────────────────────
  {
    module: "payroll",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Payroll Dashboard",
  },
  {
    module: "payroll-run",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Payroll Run",
  },
  {
    module: "payroll-settings",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Payroll Settings",
  },
  {
    module: "payroll-attendance",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Attendance",
  },
  {
    module: "payroll-advance",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Salary Advance",
  },
  {
    module: "payroll-extended-comp",
    actions: ["view", "export"],
    description: "Extended Compensation",
  },
  {
    module: "leave",
    actions: ["view", "request", "approve"],
    description: "Leave Requests and Calendar",
  },
  {
    module: "registers",
    actions: ["view", "export"],
    description:
      "Inspector's Registers (muster roll, wages, overtime, fines, deductions, advances)",
  },
  {
    module: "fines",
    actions: ["view", "manage", "approve"],
    description: "Fines and Deductions",
  },

  // ── Shop floor (Phase 2) ────────────────────────────────────────────────────
  {
    module: "machine-telemetry",
    actions: ["view", "configure", "ingest"],
    description: "Machine telemetry: gateways, signal maps, cycles",
  },

  // ── Exports (TN-01) ─────────────────────────────────────────────────────────
  {
    module: "export-incentives",
    actions: ["view", "create", "edit", "delete", "export"],
    description: "Export incentives and EPCG/AA authorisations",
  },
];

/**
 * Generates the flat permission records ready for DB insert.
 * Called by bootstrapAdmin on every server start (idempotent via skipDuplicates).
 */
export const generatePermissions = () =>
  PERMISSION_REGISTRY.flatMap(({ module, actions, description }) =>
    actions.map((action) => ({
      key: `${module}.${action}`,
      module,
      action,
      description: `Can ${action} ${description}`,
    }))
  );

/** Every permission key in the registry, e.g. "users.view". */
export const ALL_PERMISSION_KEYS: string[] = PERMISSION_REGISTRY.flatMap(({ module, actions }) =>
  actions.map((action) => `${module}.${action}`)
);

export const isKnownPermission = (key: string): boolean => ALL_PERMISSION_KEYS.includes(key);
