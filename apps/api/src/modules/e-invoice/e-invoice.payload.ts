import { GST_STATES } from "@shiftline/shared";

import { prisma } from "../../config/prisma";
import { requireTenantId } from "../../lib/tenant-context";
import { ApiError } from "../../utils/ApiError";
import type {
  EInvoiceDocType,
  IrnAddress,
  IrnItem,
  IrnRequest,
  IrnShipTo,
} from "./e-invoice.types";

/**
 * Builds the IRP request (schema 1.1) from a Shiftline document. The seller is the issuing
 * business place when it has its own GSTIN, else the company; the buyer is the customer or
 * supplier as recorded on the document (the GSTIN snapshot on the document wins over the
 * master). Ship-to is sent when the document carries a shipping address. Lines keep the
 * HSN and the split that was computed when the document was posted.
 */
type Num = number | string | { toString(): string } | null | undefined;
const n = (v: Num): number => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const q = (v: Num): number => Math.round((Number(v ?? 0) || 0) * 1000) / 1000;
const dt = (d: Date) => {
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
};
const str = (v: unknown, max: number, fallback = ""): string => {
  const s = (typeof v === "string" ? v : v == null ? "" : String(v)).trim();
  return (s || fallback).slice(0, max);
};
const pin = (v: unknown): number => {
  const p = Number(
    String(v ?? "")
      .replace(/\D/g, "")
      .slice(0, 6)
  );
  return p >= 100000 ? p : 999999;
};
/** NIC unit quantity codes; anything unknown goes as OTH. */
const UQC: Record<string, string> = {
  NOS: "NOS",
  NO: "NOS",
  PCS: "PCS",
  PC: "PCS",
  PIECE: "PCS",
  PIECES: "PCS",
  KG: "KGS",
  KGS: "KGS",
  KILOGRAM: "KGS",
  KILOGRAMS: "KGS",
  G: "GMS",
  GM: "GMS",
  GMS: "GMS",
  GRAM: "GMS",
  MT: "TON",
  TON: "TON",
  TONNE: "TON",
  L: "LTR",
  LTR: "LTR",
  LITRE: "LTR",
  LITER: "LTR",
  M: "MTR",
  MTR: "MTR",
  METER: "MTR",
  METRE: "MTR",
  BOX: "BOX",
  BAG: "BAG",
  BAGS: "BAG",
  SET: "SET",
  SETS: "SET",
  ROLL: "ROL",
  ROL: "ROL",
  PAIR: "PRS",
  PRS: "PRS",
  DOZ: "DOZ",
  DOZEN: "DOZ",
  BUNDLE: "BDL",
  BDL: "BDL",
  DRUM: "DRM",
  CAN: "CAN",
  SQM: "SQM",
  SQF: "SQF",
  CBM: "CBM",
  UNIT: "UNT",
  UNT: "UNT",
  HR: "HRS",
  HRS: "HRS",
  DAY: "DAY",
};
export const unitCode = (name: unknown): string =>
  UQC[
    String(name ?? "")
      .trim()
      .toUpperCase()
  ] ?? "OTH";

interface AddressJson {
  addressLine1?: string;
  line1?: string;
  addressLine2?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}
const addr = (a: unknown): AddressJson => (a && typeof a === "object" ? (a as AddressJson) : {});
const stateCodeOf = (stateName: unknown): string | null => {
  if (typeof stateName !== "string" || !stateName) return null;
  const hit = GST_STATES.find((s) => s.name.toLowerCase() === stateName.trim().toLowerCase());
  return hit?.code ?? null;
};

export interface SellerSource {
  gstin: string;
  legalName: string;
  tradeName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  pincode?: string | null;
  stateCode: string;
  phone?: string | null;
  email?: string | null;
}

export const sellerFor = async (businessPlaceId: bigint | null): Promise<SellerSource> => {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: requireTenantId() } });
  const place = businessPlaceId
    ? await prisma.businessPlace.findUnique({ where: { id: businessPlaceId } })
    : null;
  const placeAddr = addr(place?.address);
  const gstin = place?.gstin ?? company.gstin ?? null;
  if (!gstin)
    throw new ApiError(409, "The company has no GSTIN; e-invoicing needs one", "NO_GSTIN");
  const stateCode = gstin.slice(0, 2);
  return {
    gstin,
    legalName: company.legalName ?? company.companyName,
    tradeName: company.companyName,
    addressLine1: place?.gstin ? (placeAddr.addressLine1 ?? placeAddr.line1) : company.addressLine1,
    addressLine2: place?.gstin ? (placeAddr.addressLine2 ?? placeAddr.line2) : null,
    city: place?.gstin ? placeAddr.city : company.city,
    pincode: place?.gstin ? placeAddr.pincode : company.zipcode,
    stateCode,
    phone: place?.phone ?? company.phone,
    email: place?.email ?? company.email,
  };
};

const sellerBlock = (s: SellerSource): IrnAddress => ({
  Gstin: s.gstin,
  LglNm: str(s.legalName, 100, "Seller"),
  TrdNm: str(s.tradeName, 100) || undefined,
  Addr1: str(s.addressLine1, 100, "-"),
  Addr2: str(s.addressLine2, 100) || undefined,
  Loc: str(s.city, 50, "-"),
  Pin: pin(s.pincode),
  Stcd: s.stateCode,
  Ph: str(s.phone, 12) || undefined,
  Em: str(s.email, 100) || undefined,
});

const supTyp = (supplyType: string): string => {
  switch (supplyType) {
    case "SEZ":
      return "SEZWP";
    case "EXPORT":
      return "EXPWP";
    case "DEEMED_EXPORT":
      return "DEXP";
    default:
      return "B2B";
  }
};

interface LineSource {
  description?: string | null;
  name?: string | null;
  hsnCode?: string | null;
  uom?: string | null;
  quantity: Num;
  unitPrice: Num;
  discountAmount?: Num;
  taxableAmount: Num;
  cgstRate?: Num;
  cgstAmount: Num;
  sgstRate?: Num;
  sgstAmount: Num;
  igstRate?: Num;
  igstAmount: Num;
  taxRate?: Num;
  cessRate?: Num;
  cessAmount?: Num;
}

const itemBlock = (l: LineSource, i: number): IrnItem => {
  const gross = n(Number(l.quantity) * Number(l.unitPrice));
  const rate = n(
    l.taxRate ?? (Number(l.igstRate ?? 0) || Number(l.cgstRate ?? 0) + Number(l.sgstRate ?? 0))
  );
  const hsn = str(l.hsnCode, 8);
  const total = n(
    Number(l.taxableAmount) +
      Number(l.cgstAmount) +
      Number(l.sgstAmount) +
      Number(l.igstAmount) +
      Number(l.cessAmount ?? 0)
  );
  return {
    SlNo: String(i + 1),
    PrdDesc: str(l.description || l.name, 300, "Item"),
    IsServc: hsn.startsWith("99") ? "Y" : "N",
    HsnCd: hsn,
    Qty: q(l.quantity),
    Unit: unitCode(l.uom),
    UnitPrice: n(l.unitPrice),
    TotAmt: gross,
    Discount: n(l.discountAmount ?? 0),
    AssAmt: n(l.taxableAmount),
    GstRt: rate,
    IgstAmt: n(l.igstAmount),
    CgstAmt: n(l.cgstAmount),
    SgstAmt: n(l.sgstAmount),
    CesRt: n(l.cessRate ?? 0),
    CesAmt: n(l.cessAmount ?? 0),
    TotItemVal: total,
  };
};

const valBlock = (items: IrnItem[], grandTotal: Num, otherCharges: Num): IrnRequest["ValDtls"] => {
  const sum = (k: keyof IrnItem) => n(items.reduce((s, it) => s + Number(it[k]), 0));
  const itemsTotal = sum("TotItemVal");
  const total = n(grandTotal);
  const oth = n(otherCharges);
  return {
    AssVal: sum("AssAmt"),
    CgstVal: sum("CgstAmt"),
    SgstVal: sum("SgstAmt"),
    IgstVal: sum("IgstAmt"),
    CesVal: sum("CesAmt"),
    Discount: 0,
    OthChrg: oth,
    RndOffAmt: n(total - itemsTotal - oth),
    TotInvVal: total,
  };
};

const sundryTotal = (billSundry: unknown): number => {
  if (!Array.isArray(billSundry)) return 0;
  return billSundry.reduce(
    (s: number, x) => s + (Number((x as { amount?: unknown })?.amount) || 0),
    0
  );
};

export interface BuiltPayload {
  request: IrnRequest;
  docType: EInvoiceDocType;
  docId: string;
  docNo: string;
  docDate: Date;
  sellerGstin: string;
  buyerGstin: string;
}

const buyerFromCustomer = (
  customer: {
    firmName: string;
    displayName?: string | null;
    gstin: string | null;
    email?: string | null;
    stateCode?: string | null;
    addresses: { address: unknown; is_default: boolean; state_code: string }[];
  },
  gstinSnapshot: string | null,
  placeOfSupply: string | null
): IrnAddress & { Pos: string } => {
  const gstin = gstinSnapshot ?? customer.gstin;
  if (!gstin) {
    throw new ApiError(
      409,
      "The buyer has no GSTIN; e-invoicing covers B2B documents only",
      "B2C_DOCUMENT"
    );
  }
  const entry = customer.addresses.find((a) => a.is_default) ?? customer.addresses[0];
  const a = addr(entry?.address);
  const stcd = gstin.slice(0, 2);
  return {
    Gstin: gstin,
    LglNm: str(customer.firmName, 100, "Buyer"),
    TrdNm: str(customer.displayName, 100) || undefined,
    Addr1: str(a.addressLine1 ?? a.line1, 100, "-"),
    Addr2: str(a.addressLine2 ?? a.line2, 100) || undefined,
    Loc: str(a.city, 50, "-"),
    Pin: pin(a.pincode),
    Stcd: stcd,
    // The code stored on the document wins; never re-derived from a free-text state name.
    Pos: placeOfSupply ?? customer.stateCode ?? entry?.state_code ?? stcd,
    Em: str(customer.email, 100) || undefined,
  };
};

export const buildSalesInvoicePayload = async (invoiceId: string): Promise<BuiltPayload> => {
  const inv = await prisma.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { include: { addresses: true } },
      items: {
        include: { product: { select: { productName: true, uom: { select: { uomName: true } } } } },
      },
    },
  });
  if (!inv) throw new ApiError(404, "Sales invoice not found");
  if (inv.cancelledAt)
    throw new ApiError(409, `Invoice ${inv.invoiceNo} is cancelled`, "DOCUMENT_CANCELLED");
  const seller = await sellerFor(inv.businessPlaceId);
  const buyer = buyerFromCustomer(inv.customer, inv.customerGstin, inv.placeOfSupply);
  const items = inv.items.map((l, i) =>
    itemBlock(
      {
        description: l.description,
        name: l.product?.productName,
        hsnCode: l.hsnCode,
        uom: l.product?.uom?.uomName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountAmount: l.discountAmount,
        taxableAmount: l.taxableAmount,
        cgstRate: l.cgstRate,
        cgstAmount: l.cgstAmount,
        sgstRate: l.sgstRate,
        sgstAmount: l.sgstAmount,
        igstRate: l.igstRate,
        igstAmount: l.igstAmount,
        cessRate: l.cessRate,
        cessAmount: l.cessAmount,
      },
      i
    )
  );
  const ship: IrnShipTo | undefined = inv.shippingAddressLine1
    ? {
        Gstin: buyer.Gstin,
        LglNm: buyer.LglNm,
        Addr1: str(inv.shippingAddressLine1, 100, "-"),
        Loc: str(inv.shippingCity, 50, "-"),
        Pin: pin(inv.shippingPincode),
        Stcd: stateCodeOf(inv.shippingState) ?? buyer.Pos,
      }
    : undefined;
  const request: IrnRequest = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: supTyp(inv.supplyType), RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: str(inv.invoiceNo, 16), Dt: dt(inv.invoiceDate) },
    SellerDtls: sellerBlock(seller),
    BuyerDtls: buyer,
    ...(ship && { ShipDtls: ship }),
    ItemList: items,
    ValDtls: valBlock(items, inv.grandTotal, sundryTotal(inv.billSundry)),
  };
  return {
    request,
    docType: "INV",
    docId: inv.id,
    docNo: inv.invoiceNo,
    docDate: inv.invoiceDate,
    sellerGstin: seller.gstin,
    buyerGstin: buyer.Gstin,
  };
};

export const buildSalesReturnPayload = async (returnId: string): Promise<BuiltPayload> => {
  const ret = await prisma.salesReturn.findUnique({
    where: { id: returnId },
    include: {
      customer: { include: { addresses: true } },
      salesInvoice: { select: { invoiceNo: true, invoiceDate: true } },
      items: {
        include: { product: { select: { productName: true, uom: { select: { uomName: true } } } } },
      },
    },
  });
  if (!ret) throw new ApiError(404, "Sales return not found");
  if (ret.cancelledAt)
    throw new ApiError(409, `Credit note ${ret.returnNo} is cancelled`, "DOCUMENT_CANCELLED");
  if (!ret.creditNoteNo) {
    throw new ApiError(
      409,
      `Return ${ret.returnNo} has no GST credit note number`,
      "NO_NOTE_NUMBER"
    );
  }
  const seller = await sellerFor(ret.businessPlaceId);
  const buyer = buyerFromCustomer(ret.customer, ret.customerGstin, ret.placeOfSupply);
  const items = ret.items.map((l, i) =>
    itemBlock(
      {
        name: l.product?.productName,
        hsnCode: l.hsnCode,
        uom: l.product?.uom?.uomName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxableAmount: l.taxableAmount,
        taxRate: l.taxRate,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
      },
      i
    )
  );
  const request: IrnRequest = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: supTyp(ret.supplyType), RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "CRN", No: str(ret.creditNoteNo, 16), Dt: dt(ret.returnDate) },
    SellerDtls: sellerBlock(seller),
    BuyerDtls: buyer,
    ItemList: items,
    ValDtls: valBlock(items, ret.grandTotal, 0),
    ...(ret.salesInvoice && {
      RefDtls: {
        PrecDocDtls: [
          { InvNo: str(ret.salesInvoice.invoiceNo, 16), InvDt: dt(ret.salesInvoice.invoiceDate) },
        ],
      },
    }),
  };
  return {
    request,
    docType: "CRN",
    docId: ret.id,
    docNo: ret.creditNoteNo,
    docDate: ret.returnDate,
    sellerGstin: seller.gstin,
    buyerGstin: buyer.Gstin,
  };
};

export const buildPurchaseReturnPayload = async (returnId: string): Promise<BuiltPayload> => {
  const ret = await prisma.purchaseReturn.findUnique({
    where: { id: returnId },
    include: {
      supplier: true,
      grnInvoice: { select: { invoiceNo: true, grnDate: true } },
      items: { include: { rawMaterial: { select: { materialName: true, baseUom: true } } } },
    },
  });
  if (!ret) throw new ApiError(404, "Purchase return not found");
  if (ret.cancelledAt)
    throw new ApiError(409, `Debit note ${ret.returnNo} is cancelled`, "DOCUMENT_CANCELLED");
  if (!ret.debitNoteNo) {
    throw new ApiError(
      409,
      `Return ${ret.returnNo} has no GST debit note number`,
      "NO_NOTE_NUMBER"
    );
  }
  const seller = await sellerFor(ret.businessPlaceId);
  const gstin = ret.supplierGstin ?? ret.supplier.gstin;
  if (!gstin) {
    throw new ApiError(
      409,
      "The supplier has no GSTIN; e-invoicing covers B2B documents only",
      "B2C_DOCUMENT"
    );
  }
  const buyer: IrnAddress & { Pos: string } = {
    Gstin: gstin,
    LglNm: str(ret.supplier.legalName, 100, "Supplier"),
    Addr1: str(ret.supplier.billingAddressLine1, 100, "-"),
    Loc: str(ret.supplier.billingCity, 50, "-"),
    Pin: pin(ret.supplier.billingPincode),
    Stcd: gstin.slice(0, 2),
    Pos: ret.placeOfSupply ?? gstin.slice(0, 2),
  };
  const items = ret.items.map((l, i) =>
    itemBlock(
      {
        name: l.rawMaterial?.materialName,
        hsnCode: l.hsnCode,
        uom: l.rawMaterial?.baseUom,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        taxableAmount: l.taxableAmount,
        taxRate: l.taxRate,
        cgstAmount: l.cgstAmount,
        sgstAmount: l.sgstAmount,
        igstAmount: l.igstAmount,
      },
      i
    )
  );
  const request: IrnRequest = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: supTyp(ret.supplyType), RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "DBN", No: str(ret.debitNoteNo, 16), Dt: dt(ret.returnDate) },
    SellerDtls: sellerBlock(seller),
    BuyerDtls: buyer,
    ItemList: items,
    ValDtls: valBlock(items, ret.grandTotal, 0),
    ...(ret.grnInvoice && {
      RefDtls: {
        PrecDocDtls: [
          { InvNo: str(ret.grnInvoice.invoiceNo, 16), InvDt: dt(ret.grnInvoice.grnDate) },
        ],
      },
    }),
  };
  return {
    request,
    docType: "DBN",
    docId: ret.id,
    docNo: ret.debitNoteNo,
    docDate: ret.returnDate,
    sellerGstin: seller.gstin,
    buyerGstin: gstin,
  };
};

export const buildPayload = (docType: EInvoiceDocType, docId: string): Promise<BuiltPayload> => {
  switch (docType) {
    case "INV":
      return buildSalesInvoicePayload(docId);
    case "CRN":
      return buildSalesReturnPayload(docId);
    case "DBN":
      return buildPurchaseReturnPayload(docId);
    default:
      // "JWC" (job-work challan) never raises an e-invoice — a challan carries no tax.
      throw new ApiError(400, `${docType} does not raise an e-invoice`);
  }
};
