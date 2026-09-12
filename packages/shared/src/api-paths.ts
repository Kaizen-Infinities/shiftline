/** API path table shared by the web app and (later) the mobile app. */
export const API_PATHS = {
  auth: {
    login: "/auth/login",
    getCurrentUser: "/auth/me",
    logout: "/auth/logout",
    refresh: "/auth/refresh",
    sessions: "/auth/sessions",
    logoutAllSessions: "/auth/logout-all-sessions",
  },
  department: {
    base: "/departments",
  },
  customer: {
    base: "/customers",
  },
  supplier: {
    base: "/suppliers",
  },
  employee: {
    base: "/employees",
    nextCode: "/employees/next-code",
    me: "/employees/me",
  },
  designation: {
    base: "/designations",
  },
  shift: {
    base: "/shifts",
    nextId: "/shifts/next-id",
  },
  role: {
    base: "/roles",
  },
  permission: {
    base: "/permissions",
    rolePermissions: "/role-permissions/role",
    assignRolePermissions: "/role-permissions/assign",
    removeRolePermissions: "/role-permissions/remove",
  },
  user: {
    base: "/users",
  },
  product: {
    base: "/products",
    productNextId: "/products/next-id",
    uom: "/product/uoms",
    uomNextId: "/product/uoms/next-id",
    getActiveUom: "/product/uoms/active",
  },
  store: {
    base: "/stores",
    nextId: "/stores/next-id",
  },
  storeType: {
    base: "/store-types",
    nextId: "/store-types/next-id",
  },
  rawMaterial: {
    base: "/raw-materials",
    nextId: "/raw-materials/next-id",
  },
  rawMaterialStock: {
    base: "/raw-material-stocks",
  },
  machine: {
    base: "/machines",
    nextId: "/machines/next-id",
  },
  weeklyProgram: {
    base: "/weekly-machine-programs",
    nextId: "/weekly-machine-programs/next-id",
  },
  productionOrder: {
    base: "/production-orders",
    nextId: "/production-orders/next-id",
  },
  hourlyProduction: {
    base: "/hourly-productions",
  },
  productionWastage: {
    base: "/production-wastages",
  },
  productPricing: {
    base: "/product-pricing",
  },
  salesOrder: {
    addSalesOrder: "/sales-orders",
    getAllSalesOrder: "/sales-orders",
    updateSalesOrder: "/sales-orders",
    deleteSalesOrder: "/sales-orders",
    getNextOrderNo: "/sales-orders/next-code",
    getById: "/sales-orders", // ← new (base; service appends /:id)
    getStatus: "/sales-orders", // ← new (base; service appends /:id/status)
    updateDiscounts: "/sales-orders", // ← new (base; service appends /:id/discounts)
    submitMdApproval: "/sales-orders", // ← new (base; service appends /:id/submit-md-approval)
    reopen: "/sales-orders", // ← new (base; service appends /:id/reopen)
    mdApprove: "/sales-orders", // ← new (base; service appends /:id/md-approve)
    customerApprove: "/sales-orders",
  },
  billOfMaterial: {
    base: "/bill-of-materials",
  },
  salesProduct: {
    base: "/sales-products",
    nextId: "/sales-products/next-id",
  },
  purchaseOrder: {
    base: "/purchase-orders",
    nextId: "/purchase-orders/next-id",
  },
  suppliermaterialprice: {
    base: "/supplier-material-prices",
    nextId: "/supplier-material-prices/next-id",
  },
  onboarding: {
    base: "/onboarding",
  },
  imports: {
    base: "/imports",
  },
  gst: {
    base: "/gst",
  },
  documents: {
    base: "/documents",
    nextNumber: "/documents/next-number",
  },
  auditTrail: {
    base: "/audit-trail",
    filters: "/audit-trail/filters",
    export: "/audit-trail/export",
  },
  yearEnd: {
    base: "/year-end",
    preview: "/year-end/preview",
    prepare: "/year-end/prepare",
    periodControl: "/accounts/period-control",
  },
  books: {
    dayBook: "/accounts/day-book",
    cashBook: "/accounts/cash-book",
    bankBook: "/accounts/bank-book",
    cashFlow: "/accounts/cash-flow",
    statements: "/accounts/statements",
  },
  accountExport: {
    base: "/account-export",
  },
  filings: {
    registry: "/filings/registry",
    approvals: "/filings/approvals",
  },
  insights: {
    base: "/v1/insights",
  },
  eInvoice: {
    base: "/e-invoice",
    settings: "/e-invoice/settings",
  },
  ewayBill: {
    base: "/eway-bills",
    consolidated: "/eway-bills/consolidated",
  },
  transporters: {
    base: "/transporters",
  },
  gstReturns: {
    base: "/gst-returns",
    gstins: "/gst-returns/gstins",
    gstr1: "/gst-returns/gstr1",
    gstr2b: "/gst-returns/gstr2b",
    gstr2bSummary: "/gst-returns/gstr2b/summary",
    gstr2bImport: "/gst-returns/gstr2b/import",
    gstr2bPull: "/gst-returns/gstr2b/pull",
    ims: "/gst-returns/ims",
    imsPending: "/gst-returns/ims/pending",
    imsRule: "/gst-returns/ims/rule",
    imsRegister: "/gst-returns/ims/register",
    imsPush: "/gst-returns/ims/push",
    gstr3b: "/gst-returns/gstr3b",
    gstr9: "/gst-returns/gstr9",
    calendar: "/gst-returns/calendar",
    itc: "/gst-returns/itc",
  },
  status: "/status",
  notifications: {
    base: "/notifications",
  },
  entitlements: {
    base: "/entitlements",
  },
  platform: {
    tenants: "/platform/tenants",
    plans: "/platform/plans",
    backups: "/platform/backups",
  },
  company: {
    base: "/companies",
  },
  grnInvoice: {
    base: "/grn-invoices",
    nextCode: "/grn-invoices/next-code",
  },
  invoiceSettings: {
    base: "/invoice-settings",
  },
  salesInvoice: {
    base: "/sales-invoices",
  },
  advances: {
    base: "/advances",
    open: "/advances/open",
  },
  currencies: {
    base: "/currencies",
    rates: "/currencies/rates",
  },
  tds: {
    base: "/tds",
    sections: "/tds/sections",
    preview: "/tds/preview",
    deductions: "/tds/deductions",
    challans: "/tds/challans",
    returns: "/tds/returns",
    form16a: "/tds/form16a",
  },
  tally: {
    base: "/tally",
    masters: "/tally/masters",
    vouchers: "/tally/vouchers",
    preview: "/tally/preview",
    mappings: "/tally/mappings",
    runs: "/tally/runs",
  },
  jobWork: {
    base: "/job-work",
    workers: "/job-work/workers",
    challans: "/job-work/challans",
    register: "/job-work/register",
    itc04: "/job-work/itc04",
  },
  goodsDispatch: {
    base: "/goods-dispatches",
    nextNumber: "/goods-dispatches/next-number",
    eligibleOrders: "/goods-dispatches/eligible-orders",
  },

  productShiftRecord: {
    base: "/product-shift-records",
  },

  productCapacityHistory: {
    base: "/product-capacity-history",
  },

  email: {
    base: "/email-config",
  },
  category: {
    base: "/categories",
    nextCode: "/categories/next-code",
  },
  inventory: {
    eodStock: "/inventory/eod-stock",
  },
};

export type ApiPaths = typeof API_PATHS;
