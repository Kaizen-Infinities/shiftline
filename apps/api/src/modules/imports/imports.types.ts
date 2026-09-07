import { GST_STATES, isValidGstin } from "@shiftline/shared";
import { z } from "zod";

/**
 * CSV import types (P1-00 part 3). Each type declares its columns (for the
 * template and header matching), the permission that allows it and a row
 * schema. Header matching is case- and punctuation-insensitive, so a sheet
 * with "Customer Code" or "customer_code" works as well as "customerCode".
 */
export const IMPORT_TYPES = [
  "customers",
  "suppliers",
  "products",
  "raw-materials",
  "opening-balances",
  "opening-stock",
] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  example: string;
  description: string;
}

export interface ImportTypeDef {
  key: ImportType;
  label: string;
  description: string;
  /** Any one of these lets a user run the import. */
  permissions: string[];
  columns: ImportColumn[];
}

export const MAX_ROWS = 5000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// ─── Cell coercions ───────────────────────────────────────────────────────────

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v;

const optionalText = (max: number) =>
  z.preprocess(emptyToUndefined, z.string().max(max).optional());
const requiredText = (max: number, label: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string({ message: `${label} is required` })
      .min(1, `${label} is required`)
      .max(max)
  );

/** "1,25,000.50" → 125000.5; blanks are undefined. */
const money = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const t = v.replace(/[,\s₹]/g, "");
    return t === "" ? undefined : Number(t);
  },
  z.number({ message: "Must be a number" }).finite().min(0, "Cannot be negative").optional()
);

const quantity = money;

const integer = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : undefined),
  z.number({ message: "Must be a whole number" }).int().min(0).optional()
);

const bool = z.preprocess(
  (v) => {
    if (typeof v !== "string" || v.trim() === "") return undefined;
    const t = v.trim().toLowerCase();
    if (["yes", "y", "true", "1", "active"].includes(t)) return true;
    if (["no", "n", "false", "0", "inactive"].includes(t)) return false;
    return v;
  },
  z.boolean({ message: "Use yes or no" }).optional()
);

const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);

const gstin = z.preprocess(
  (v) => emptyToUndefined(upper(v)),
  z.string().refine(isValidGstin, "GSTIN is not valid (format or check digit)").optional()
);
const pan = z.preprocess(
  (v) => emptyToUndefined(upper(v)),
  z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN is 5 letters, 4 digits, 1 letter")
    .optional()
);
const email = z.preprocess(emptyToUndefined, z.string().email("Invalid email").max(120).optional());
const pincode = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^\d{6}$/, "PIN code is 6 digits")
    .optional()
);

/** "9876543210; 9123456789" → ["9876543210", "9123456789"]. */
const phones = z.preprocess(
  (v) => {
    if (typeof v !== "string" || v.trim() === "") return undefined;
    return v
      .split(/[;|/]/)
      .map((p) => p.replace(/[^\d+]/g, ""))
      .filter(Boolean);
  },
  z.array(z.string().min(6, "Phone is too short").max(15)).optional()
);

const balanceType = (fallback: "DEBIT" | "CREDIT") =>
  z.preprocess(
    (v) => {
      const t = emptyToUndefined(upper(v));
      if (t === "DR") return "DEBIT";
      if (t === "CR") return "CREDIT";
      return t ?? fallback;
    },
    z.enum(["DEBIT", "CREDIT"], { message: "Use DEBIT or CREDIT" })
  );

export const stateNameToCode = (name: string | undefined): string | undefined => {
  if (!name) return undefined;
  const t = name.trim().toLowerCase();
  return GST_STATES.find((s) => s.name.toLowerCase() === t || s.alpha.toLowerCase() === t)?.code;
};

// ─── Row schemas ──────────────────────────────────────────────────────────────

export const customerRow = z.object({
  customerCode: requiredText(20, "Customer code"),
  firmName: requiredText(160, "Firm name"),
  displayName: optionalText(80),
  customerType: optionalText(100),
  customerGrade: optionalText(100),
  mobile: phones,
  email,
  gstin,
  creditLimit: money,
  creditDays: integer,
  addressLine1: optionalText(255),
  city: optionalText(100),
  state: optionalText(100),
  pincode,
  openingBalance: money,
  openingBalanceType: balanceType("DEBIT"),
  status: z.preprocess(
    (v) => emptyToUndefined(v) ?? "Active",
    z.enum(["Active", "OnHold", "Blocked", "Lead", "Inactive"], { message: "Unknown status" })
  ),
});
export type CustomerRow = z.infer<typeof customerRow>;

export const supplierRow = z.object({
  supplierCode: requiredText(20, "Supplier code"),
  legalName: requiredText(160, "Legal name"),
  displayName: optionalText(80),
  contactPerson: optionalText(80),
  mobile: phones,
  email,
  gstin,
  pan,
  gstRegType: z.preprocess(
    (v) => emptyToUndefined(upper(v)),
    z
      .enum(["REGULAR", "COMPOSITION", "UNREGISTERED"], {
        message: "Use REGULAR, COMPOSITION or UNREGISTERED",
      })
      .optional()
  ),
  billingAddressLine1: requiredText(255, "Billing address"),
  billingCity: requiredText(100, "Billing city"),
  billingState: requiredText(100, "Billing state"),
  billingPincode: z.preprocess(
    emptyToUndefined,
    z.string({ message: "PIN code is required" }).regex(/^\d{6}$/, "PIN code is 6 digits")
  ),
  stateCode: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{2}$/, "State code is two digits")
      .optional()
  ),
  openingBalance: money,
  openingBalanceType: balanceType("CREDIT"),
  status: z.preprocess(
    (v) => emptyToUndefined(v) ?? "Active",
    z.enum(["Active", "Backup", "Inactive", "Blacklisted"], { message: "Unknown status" })
  ),
});
export type SupplierRow = z.infer<typeof supplierRow>;

export const productRow = z.object({
  productCode: requiredText(20, "Product code"),
  productName: requiredText(160, "Product name"),
  description: optionalText(255),
  productType: z.preprocess(
    (v) => emptyToUndefined(upper(v)) ?? "PRODUCTION",
    z.enum(["PRODUCTION", "SALES_PRODUCTION"], { message: "Use PRODUCTION or SALES_PRODUCTION" })
  ),
  category: optionalText(20),
  rate: money,
  weightPerPiece: quantity,
  weightUom: optionalText(10),
  minimumQty: quantity,
  openingStockQty: quantity,
  openingStockStore: optionalText(20),
  isActive: bool,
});
export type ProductRow = z.infer<typeof productRow>;

export const rawMaterialRow = z.object({
  rawMaterialId: requiredText(20, "Raw material id"),
  materialName: requiredText(100, "Material name"),
  baseUom: requiredText(50, "Base UoM"),
  category: optionalText(20),
  store: requiredText(20, "Store"),
  rate: money,
  reorderLevel: quantity,
  minimumStock: quantity,
  onHandQty: quantity,
  isActive: bool,
});
export type RawMaterialRow = z.infer<typeof rawMaterialRow>;

export const openingBalanceRow = z
  .object({
    ledgerCode: requiredText(30, "Ledger code"),
    ledgerName: optionalText(160),
    ledgerType: z.preprocess(
      (v) => emptyToUndefined(upper(v)),
      z
        .enum(["ASSET", "LIABILITY", "EXPENSE", "INCOME", "EQUITY"], {
          message: "Unknown ledger type",
        })
        .optional()
    ),
    ledgerGroup: optionalText(80),
    debit: money,
    credit: money,
  })
  .superRefine((r, ctx) => {
    const d = r.debit ?? 0;
    const c = r.credit ?? 0;
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["debit"],
        message: "Enter either a debit or a credit amount",
      });
    }
  });
export type OpeningBalanceRow = z.infer<typeof openingBalanceRow>;

export const openingStockRow = z.object({
  itemType: z.preprocess(
    (v) => emptyToUndefined(upper(v)),
    z.enum(["PRODUCT", "RAW_MATERIAL"], { message: "Use PRODUCT or RAW_MATERIAL" })
  ),
  itemCode: requiredText(20, "Item code"),
  store: requiredText(20, "Store"),
  qty: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[,\s]/g, "")) : undefined),
    z.number({ message: "Quantity is required" }).finite().positive("Quantity must be positive")
  ),
  remarks: optionalText(255),
});
export type OpeningStockRow = z.infer<typeof openingStockRow>;

export const ROW_SCHEMAS: Record<ImportType, z.ZodTypeAny> = {
  customers: customerRow,
  suppliers: supplierRow,
  products: productRow,
  "raw-materials": rawMaterialRow,
  "opening-balances": openingBalanceRow,
  "opening-stock": openingStockRow,
};

// ─── Column definitions (templates + docs) ───────────────────────────────────

export const IMPORT_TYPE_DEFS: ImportTypeDef[] = [
  {
    key: "customers",
    label: "Customers",
    description:
      "Customer master with an optional opening receivable, posted against Opening Balance Equity.",
    permissions: ["customers.create"],
    columns: [
      {
        key: "customerCode",
        label: "Customer code",
        required: true,
        example: "C001",
        description: "Unique within the company, up to 20 characters",
      },
      {
        key: "firmName",
        label: "Firm name",
        required: true,
        example: "Acme Traders",
        description: "Legal or trading name",
      },
      {
        key: "displayName",
        label: "Display name",
        example: "Acme",
        description: "Short name shown in lists",
      },
      {
        key: "customerType",
        label: "Customer type",
        example: "Distributor",
        description: "Created if it does not exist",
      },
      {
        key: "customerGrade",
        label: "Customer grade",
        example: "A",
        description: "Created if it does not exist",
      },
      {
        key: "mobile",
        label: "Mobile",
        example: "9876543210; 9123456789",
        description: "One or more numbers separated by ;",
      },
      { key: "email", label: "Email", example: "accounts@acme.example", description: "" },
      {
        key: "gstin",
        label: "GSTIN",
        example: "33AAAAA0000A1Z9",
        description: "Validated including the check digit",
      },
      { key: "creditLimit", label: "Credit limit", example: "250000", description: "In rupees" },
      { key: "creditDays", label: "Credit days", example: "30", description: "Whole days" },
      {
        key: "addressLine1",
        label: "Address",
        example: "12 Market Road",
        description: "Becomes the default address",
      },
      { key: "city", label: "City", example: "Coimbatore", description: "" },
      { key: "state", label: "State", example: "Tamil Nadu", description: "Full state name" },
      { key: "pincode", label: "PIN code", example: "641001", description: "6 digits" },
      {
        key: "openingBalance",
        label: "Opening balance",
        example: "12500",
        description: "Amount the customer owes (DEBIT) or is owed (CREDIT) on the day books begin",
      },
      {
        key: "openingBalanceType",
        label: "Opening balance type",
        example: "DEBIT",
        description: "DEBIT (default) or CREDIT",
      },
      {
        key: "status",
        label: "Status",
        example: "Active",
        description: "Active, OnHold, Blocked, Lead or Inactive",
      },
    ],
  },
  {
    key: "suppliers",
    label: "Suppliers",
    description:
      "Supplier master with an optional opening payable, posted against Opening Balance Equity.",
    permissions: ["suppliers.create"],
    columns: [
      {
        key: "supplierCode",
        label: "Supplier code",
        required: true,
        example: "S001",
        description: "Unique within the company, up to 20 characters",
      },
      {
        key: "legalName",
        label: "Legal name",
        required: true,
        example: "Bharat Steels Pvt Ltd",
        description: "",
      },
      { key: "displayName", label: "Display name", example: "Bharat Steels", description: "" },
      { key: "contactPerson", label: "Contact person", example: "R. Kumar", description: "" },
      {
        key: "mobile",
        label: "Mobile",
        example: "9876543210",
        description: "One or more numbers separated by ;",
      },
      { key: "email", label: "Email", example: "sales@bharatsteels.example", description: "" },
      {
        key: "gstin",
        label: "GSTIN",
        example: "27AAAAA0000A1Z2",
        description: "Validated including the check digit; fills the state code",
      },
      { key: "pan", label: "PAN", example: "AAAAA0000A", description: "" },
      {
        key: "gstRegType",
        label: "GST registration",
        example: "REGULAR",
        description: "REGULAR, COMPOSITION or UNREGISTERED",
      },
      {
        key: "billingAddressLine1",
        label: "Billing address",
        required: true,
        example: "Plot 7, MIDC",
        description: "",
      },
      {
        key: "billingCity",
        label: "Billing city",
        required: true,
        example: "Pune",
        description: "",
      },
      {
        key: "billingState",
        label: "Billing state",
        required: true,
        example: "Maharashtra",
        description: "Full state name; also fills the state code",
      },
      {
        key: "billingPincode",
        label: "Billing PIN code",
        required: true,
        example: "411001",
        description: "6 digits",
      },
      {
        key: "stateCode",
        label: "State code",
        example: "27",
        description: "Two-digit GST state code; derived from the GSTIN or state when blank",
      },
      {
        key: "openingBalance",
        label: "Opening balance",
        example: "48000",
        description: "Amount owed to the supplier (CREDIT) or advance paid (DEBIT)",
      },
      {
        key: "openingBalanceType",
        label: "Opening balance type",
        example: "CREDIT",
        description: "CREDIT (default) or DEBIT",
      },
      {
        key: "status",
        label: "Status",
        example: "Active",
        description: "Active, Backup, Inactive or Blacklisted",
      },
    ],
  },
  {
    key: "products",
    label: "Products",
    description: "Finished products, optionally with an opening stock in a finished-goods store.",
    permissions: ["products.create"],
    columns: [
      {
        key: "productCode",
        label: "Product code",
        required: true,
        example: "P-1001",
        description: "Unique within the company",
      },
      {
        key: "productName",
        label: "Product name",
        required: true,
        example: "500 ml Bottle",
        description: "",
      },
      { key: "description", label: "Description", example: "", description: "" },
      {
        key: "productType",
        label: "Product type",
        example: "PRODUCTION",
        description: "PRODUCTION (default) or SALES_PRODUCTION",
      },
      {
        key: "category",
        label: "Category code",
        example: "BOT",
        description: "An existing product category code",
      },
      { key: "rate", label: "Rate", example: "18.50", description: "Selling rate in rupees" },
      { key: "weightPerPiece", label: "Weight per piece", example: "22", description: "" },
      { key: "weightUom", label: "Weight unit", example: "g", description: "g or kg" },
      {
        key: "minimumQty",
        label: "Minimum quantity",
        example: "1000",
        description: "Reorder trigger",
      },
      {
        key: "openingStockQty",
        label: "Opening stock",
        example: "5000",
        description: "Quantity on hand on the day books begin",
      },
      {
        key: "openingStockStore",
        label: "Opening stock store",
        example: "ST-FG",
        description: "Store id holding the opening stock; required with a quantity",
      },
      { key: "isActive", label: "Active", example: "yes", description: "yes or no" },
    ],
  },
  {
    key: "raw-materials",
    label: "Raw materials",
    description: "Raw material master with its store and an optional opening quantity.",
    permissions: ["raw_materials.create"],
    columns: [
      {
        key: "rawMaterialId",
        label: "Raw material id",
        required: true,
        example: "RM-HDPE",
        description: "Unique within the company, up to 20 characters",
      },
      {
        key: "materialName",
        label: "Material name",
        required: true,
        example: "HDPE Granules",
        description: "",
      },
      {
        key: "baseUom",
        label: "Base UoM",
        required: true,
        example: "KG",
        description: "Unit the stock is kept in",
      },
      {
        key: "category",
        label: "Category code",
        example: "POLY",
        description: "An existing raw-material category code",
      },
      {
        key: "store",
        label: "Store",
        required: true,
        example: "ST-RM",
        description: "Store id where the material is kept",
      },
      { key: "rate", label: "Rate", example: "96.00", description: "Purchase rate per base unit" },
      { key: "reorderLevel", label: "Reorder level", example: "500", description: "" },
      { key: "minimumStock", label: "Minimum stock", example: "200", description: "" },
      {
        key: "onHandQty",
        label: "Opening quantity",
        example: "1200",
        description: "Quantity on hand on the day books begin",
      },
      { key: "isActive", label: "Active", example: "yes", description: "yes or no" },
    ],
  },
  {
    key: "opening-balances",
    label: "Opening balances (ledgers)",
    description:
      "Trial-balance style opening entries for cash, bank, loan, capital, asset and expense ledgers. Customer and supplier balances come with their own imports.",
    permissions: ["accounts.create", "chart-of-accounts.create"],
    columns: [
      {
        key: "ledgerCode",
        label: "Ledger code",
        required: true,
        example: "CASH-001",
        description: "Existing ledger code, or a new one when name and type are given",
      },
      {
        key: "ledgerName",
        label: "Ledger name",
        example: "Cash in Hand",
        description: "Needed only for a new ledger",
      },
      {
        key: "ledgerType",
        label: "Ledger type",
        example: "ASSET",
        description: "ASSET, LIABILITY, EXPENSE, INCOME or EQUITY (new ledgers)",
      },
      {
        key: "ledgerGroup",
        label: "Ledger group",
        example: "Cash in Hand",
        description: "Group name (new ledgers)",
      },
      { key: "debit", label: "Debit", example: "25000", description: "Debit balance in rupees" },
      {
        key: "credit",
        label: "Credit",
        example: "",
        description: "Credit balance in rupees (one of debit or credit)",
      },
    ],
  },
  {
    key: "opening-stock",
    label: "Opening stock",
    description: "Quantities on hand per store for products and raw materials that already exist.",
    permissions: ["finished_goods_stocks.create", "raw_material_stocks.create", "stores.edit"],
    columns: [
      {
        key: "itemType",
        label: "Item type",
        required: true,
        example: "PRODUCT",
        description: "PRODUCT or RAW_MATERIAL",
      },
      {
        key: "itemCode",
        label: "Item code",
        required: true,
        example: "P-1001",
        description: "Product code or raw material id",
      },
      { key: "store", label: "Store", required: true, example: "ST-FG", description: "Store id" },
      {
        key: "qty",
        label: "Quantity",
        required: true,
        example: "5000",
        description: "Positive quantity in the item's unit",
      },
      { key: "remarks", label: "Remarks", example: "Physical count 31 Mar", description: "" },
    ],
  },
];

export const importTypeDef = (key: string): ImportTypeDef | undefined =>
  IMPORT_TYPE_DEFS.find((d) => d.key === key);
