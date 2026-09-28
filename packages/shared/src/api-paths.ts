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
    // A light typeahead (P2-15) behind "employees.search" rather than "employees.view", for
    // screens (leave, fines) that need to pick an employee without holding payroll.view.
    search: "/employees/search",
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
    /** The signed-in user's UI language (TN-04). */
    myLocale: "/users/me/locale",
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
    gstr2bSettings: "/gst-returns/gstr2b/settings",
    /** `${gstr2bFollowUpBase}/<period>/follow-up` and `.../follow-up/preview`. */
    gstr2bFollowUpBase: "/gst-returns/gstr2b",
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
  labour: {
    base: "/labour",
    holidays: "/labour/holidays",
    leaveTypes: "/labour/leave-types",
    leaveBalances: "/labour/leave-balances",
    gratuity: "/labour/gratuity",
    bonus: "/labour/bonus",
    settlements: "/labour/settlements",
  },
  registers: {
    base: "/registers",
    musterRoll: "/registers/muster-roll",
    wages: "/registers/wages",
    overtime: "/registers/overtime",
    fines: "/registers/fines",
    deductions: "/registers/deductions",
    advances: "/registers/advances",
  },
  fines: {
    base: "/fines",
  },
  payments: {
    base: "/payments",
    links: "/payments/links",
    settings: "/payments/settings",
  },
  sms: {
    base: "/sms",
    settings: "/sms/settings",
    templates: "/sms/templates",
    messages: "/sms/messages",
    send: "/sms/send",
    preview: "/sms/preview",
    otp: "/sms/otp",
  },
  payrollStatutory: {
    base: "/payroll-statutory",
    rules: "/payroll-statutory/rules",
    declarations: "/payroll-statutory/declarations",
    runs: "/payroll-statutory/runs",
  },
  banking: {
    base: "/banking",
    statements: "/banking/statements",
    lines: "/banking/lines",
    brs: "/banking/brs",
    cheques: "/banking/cheques", // ← service appends /:id/re-present
    autoMatch: "/banking/auto-match",
  },
  costing: {
    base: "/costing",
    valuation: "/costing/valuation",
    costCentres: "/costing/cost-centres",
    budgets: "/costing/budgets",
    costSheets: "/costing/cost-sheets",
    settings: "/costing/settings",
  },
  fx: {
    base: "/fx",
    rates: "/fx/rates",
    exposure: "/fx/exposure",
    revaluations: "/fx/revaluations",
    billsOfEntry: "/fx/bills-of-entry",
  },
  assets: {
    base: "/assets",
    classes: "/assets/classes",
    register: "/assets/register",
    itBlocks: "/assets/it-blocks",
    depreciation: "/assets/depreciation",
    opening: "/assets/opening",
    openingImport: "/assets/opening/import",
    openingTemplate: "/assets/opening/template.csv",
    capitalise: "/assets/capitalise",
    depreciationRuns: "/assets/depreciation-runs",
  },
  msme: {
    base: "/msme",
    bills: "/msme/bills",
    disallowance: "/msme/disallowance",
    form1: "/msme/form1",
    paymentWarning: "/msme/payment-warning",
  },
  tally: {
    base: "/tally",
    masters: "/tally/masters",
    vouchers: "/tally/vouchers",
    preview: "/tally/preview",
    mappings: "/tally/mappings",
    runs: "/tally/runs",
    settings: "/tally/settings",
  },
  jobWork: {
    base: "/job-work",
    workers: "/job-work/workers",
    challans: "/job-work/challans",
    register: "/job-work/register",
    itc04: "/job-work/itc04",
    itc04Register: "/job-work/itc04/register",
    itc04MarkFiled: "/job-work/itc04/mark-filed",
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
  projectJobs: {
    base: "/project-jobs", // ← service appends /:id, /:id/summary, /:id/stages[/order|/:stageId], /:id/costs[/post|/:costId], /:id/billings
    stagePlans: "/project-jobs/stage-plans",
  },
  msmeClaims: {
    base: "/msme/receivable-claims", // ← service appends /:id, /:id/status, /:id/recompute, /:id/pdf
    eligible: "/msme/receivable-claims/eligible",
    settings: "/msme/receivable-claims/settings",
  },
  orderTna: {
    base: "/order-tna", // ← service appends /:id, /:id/milestones[/:milestoneId]
    templates: "/order-tna/templates",
    alerts: "/order-tna/alerts",
  },
  deliverySchedules: {
    base: "/delivery-schedules",
    due: "/delivery-schedules/due",
    adherence: "/delivery-schedules/adherence",
    lines: "/delivery-schedules/lines", // ← base; service appends /:lineId[/dispatches]
    dispatches: "/delivery-schedules/dispatches", // ← base; service appends /:dispatchId
  },
  asn: {
    base: "/asn", // ← service appends /:id, /:id/status, /:id/export, /:id/labels
    prefill: "/asn/prefill",
    invoices: "/asn/invoices",
    formats: "/asn/export-formats",
    partMaps: "/asn/part-maps", // ← service appends /:id
  },
  leave: {
    base: "/leave",
    requests: "/leave/requests",
    calendar: "/leave/calendar",
    me: "/leave/me",
  },
  shiftExecution: {
    supervisorOverride: "/shift-execution/supervisor-override",
  },
  machineGateway: {
    base: "/machine-gateways",
    testConnection: "/machine-gateways", // ← base; service appends /:id/test-connection
    signalMap: "/machine-gateways", // ← base; service appends /:id/signal-map
  },
  machineTelemetry: {
    base: "/machine-telemetry",
    signals: "/machine-telemetry/signals",
    cycles: "/machine-telemetry/cycles",
    health: "/machine-telemetry/health",
  },
  exportIncentives: {
    base: "/export-incentives",
    claims: "/export-incentives/claims",
    claimsSummary: "/export-incentives/claims/summary",
    claimFromInvoice: "/export-incentives/claims/from-invoice", // ← service appends /:salesInvoiceId
    authorisations: "/export-incentives/authorisations",
  },
};

export type ApiPaths = typeof API_PATHS;
