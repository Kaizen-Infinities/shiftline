import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { buildSalesInvoicePayload, sellerFor, unitCode } from "../e-invoice/e-invoice.payload";
import type { IrnRequest } from "../e-invoice/e-invoice.types";
import type { EwbDocType, EwbItem, EwbRequest, EwbTransport } from "./eway-bill.types";

/**
 * Builds the e-way bill request from a Shiftline document. A tax invoice reuses the IRN
 * payload (same seller, buyer, ship-to and lines); a goods dispatch is a delivery challan
 * from the issuing place to the destination store's place, valued at the product's rate.
 */
const n = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;
const pinOf = (v: unknown) => {
  const p = Number(
    String(v ?? "")
      .replace(/\D/g, "")
      .slice(0, 6)
  );
  return p >= 100000 ? p : 999999;
};
const dt = (d: Date) => {
  const x = new Date(d);
  return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`;
};

export interface BuiltEwb {
  request: EwbRequest;
  docType: EwbDocType;
  docRef: string;
  docNo: string;
  docDate: Date;
  fromGstin: string;
  toGstin: string | null;
  totalValue: number;
  /** The IRN of the document when it has a live one; the bill is then raised through it. */
  irn: string | null;
  eInvoiceId: string | null;
}

const transportFields = (t: EwbTransport) => ({
  transporterId: t.transporterId || undefined,
  transporterName: t.transporterName || undefined,
  transDocNo: t.transDocNo || undefined,
  transMode: t.transMode,
  transDistance: String(t.distanceKm || 0),
  transDocDate: t.transDocDate || undefined,
  vehicleNo: t.vehicleNo || undefined,
  vehicleType: t.vehicleType,
});

const fromIrnRequest = (r: IrnRequest, t: EwbTransport, docType: "INV" | "CHL"): EwbRequest => {
  const ship = r.ShipDtls;
  const to = ship ?? r.BuyerDtls;
  const items: EwbItem[] = r.ItemList.map((i) => ({
    productName: i.PrdDesc.slice(0, 100),
    hsnCode: i.HsnCd,
    quantity: i.Qty,
    qtyUnit: i.Unit,
    taxableAmount: i.AssAmt,
    cgstRate: i.CgstAmt > 0 ? i.GstRt / 2 : 0,
    sgstRate: i.SgstAmt > 0 ? i.GstRt / 2 : 0,
    igstRate: i.IgstAmt > 0 ? i.GstRt : 0,
    cessRate: i.CesRt,
  }));
  return {
    supplyType: "O",
    subSupplyType: docType === "INV" ? "1" : "8",
    ...(docType === "CHL" && { subSupplyDesc: "Delivery challan" }),
    docType,
    docNo: r.DocDtls.No,
    docDate: r.DocDtls.Dt,
    fromGstin: r.SellerDtls.Gstin,
    fromTrdName: r.SellerDtls.TrdNm ?? r.SellerDtls.LglNm,
    fromAddr1: r.SellerDtls.Addr1,
    fromAddr2: r.SellerDtls.Addr2,
    fromPlace: r.SellerDtls.Loc,
    fromPincode: r.SellerDtls.Pin,
    fromStateCode: Number(r.SellerDtls.Stcd),
    actFromStateCode: Number(r.SellerDtls.Stcd),
    toGstin: r.BuyerDtls.Gstin,
    toTrdName: to.TrdNm ?? to.LglNm,
    toAddr1: to.Addr1,
    toAddr2: to.Addr2,
    toPlace: to.Loc,
    toPincode: to.Pin,
    toStateCode: Number(r.BuyerDtls.Pos),
    actToStateCode: Number(to.Stcd),
    totalValue: r.ValDtls.AssVal,
    cgstValue: r.ValDtls.CgstVal,
    sgstValue: r.ValDtls.SgstVal,
    igstValue: r.ValDtls.IgstVal,
    cessValue: r.ValDtls.CesVal,
    totInvValue: r.ValDtls.TotInvVal,
    ...transportFields(t),
    itemList: items,
  };
};

export const buildInvoiceEwb = async (invoiceId: string, t: EwbTransport): Promise<BuiltEwb> => {
  const built = await buildSalesInvoicePayload(invoiceId);
  const live = await prisma.eInvoice.findFirst({
    where: { docType: "INV", docId: invoiceId, status: "GENERATED" },
    select: { id: true, irn: true },
  });
  return {
    request: fromIrnRequest(built.request, t, "INV"),
    docType: "INV",
    docRef: built.docId,
    docNo: built.docNo,
    docDate: built.docDate,
    fromGstin: built.sellerGstin,
    toGstin: built.buyerGstin,
    totalValue: built.request.ValDtls.TotInvVal,
    irn: live?.irn ?? null,
    eInvoiceId: live?.id ?? null,
  };
};

/** A goods dispatch moves finished goods between the company's own places on a delivery challan. */
export const buildDispatchEwb = async (dispatchId: bigint, t: EwbTransport): Promise<BuiltEwb> => {
  const d = await prisma.goodsDispatch.findUnique({
    where: { id: dispatchId },
    include: {
      items: {
        include: {
          product: {
            select: {
              productName: true,
              rate: true,
              gstRate: true,
              hsnCode: { select: { code: true } },
              uom: { select: { uomName: true } },
            },
          },
        },
      },
      store: { include: { businessPlace: true } },
    },
  });
  if (!d) throw new ApiError(404, "Goods dispatch not found");
  if (d.status === "GATE_REJECTED" || d.status === "STORE_REJECTED") {
    throw new ApiError(409, `Dispatch ${d.dispatchNumber} was rejected`, "DOCUMENT_CANCELLED");
  }
  const seller = await sellerFor(d.businessPlaceId);
  const toPlace = d.store?.businessPlace ?? null;
  const toAddr = (toPlace?.address ?? {}) as {
    addressLine1?: string;
    line1?: string;
    city?: string;
    pincode?: string;
  };
  const toGstin = toPlace?.gstin ?? seller.gstin;
  const toStcd = toGstin.slice(0, 2);
  const items: EwbItem[] = d.items.map((i) => {
    const qty = Number(i.dispatchQty);
    const rate = Number(i.product?.rate ?? 0);
    const gst = Number(i.product?.gstRate ?? 0);
    const intra = toStcd === seller.stateCode;
    return {
      productName: (i.product?.productName ?? "Item").slice(0, 100),
      hsnCode: i.product?.hsnCode?.code ?? "",
      quantity: qty,
      qtyUnit: unitCode(i.product?.uom?.uomName),
      taxableAmount: n(qty * rate),
      cgstRate: intra ? gst / 2 : 0,
      sgstRate: intra ? gst / 2 : 0,
      igstRate: intra ? 0 : gst,
      cessRate: 0,
    };
  });
  const taxable = n(items.reduce((s, i) => s + i.taxableAmount, 0));
  const cgst = n(items.reduce((s, i) => s + (i.taxableAmount * i.cgstRate) / 100, 0));
  const sgst = n(items.reduce((s, i) => s + (i.taxableAmount * i.sgstRate) / 100, 0));
  const igst = n(items.reduce((s, i) => s + (i.taxableAmount * i.igstRate) / 100, 0));
  const total = n(taxable + cgst + sgst + igst);
  const request: EwbRequest = {
    supplyType: "O",
    subSupplyType: "5",
    subSupplyDesc: "For own use",
    docType: "CHL",
    docNo: d.dispatchNumber.slice(0, 16),
    docDate: dt(d.dispatchDate),
    fromGstin: seller.gstin,
    fromTrdName: (seller.tradeName ?? seller.legalName).slice(0, 100),
    fromAddr1: (seller.addressLine1 ?? "-").slice(0, 100),
    fromPlace: (seller.city ?? "-").slice(0, 50),
    fromPincode: pinOf(seller.pincode),
    fromStateCode: Number(seller.stateCode),
    actFromStateCode: Number(seller.stateCode),
    toGstin,
    toTrdName: (toPlace?.name ?? d.store?.storeName ?? seller.legalName).slice(0, 100),
    toAddr1: (toAddr.addressLine1 ?? toAddr.line1 ?? "-").slice(0, 100),
    toPlace: (toAddr.city ?? d.store?.storeName ?? "-").slice(0, 50),
    toPincode: pinOf(toAddr.pincode ?? seller.pincode),
    toStateCode: Number(toStcd),
    actToStateCode: Number(toStcd),
    totalValue: taxable,
    cgstValue: cgst,
    sgstValue: sgst,
    igstValue: igst,
    cessValue: 0,
    totInvValue: total,
    ...transportFields(t),
    itemList: items,
  };
  return {
    request,
    docType: "CHL",
    docRef: String(d.id),
    docNo: d.dispatchNumber,
    docDate: d.dispatchDate,
    fromGstin: seller.gstin,
    toGstin,
    totalValue: total,
    irn: null,
    eInvoiceId: null,
  };
};

/**
 * A job-work (or other) delivery challan raised by `modules/job-work`. Same shape as a goods
 * dispatch's challan, valued off the challan's own lines instead of a `GoodsDispatch`.
 */
export const buildJobWorkChallanEwb = async (
  challanId: string,
  t: EwbTransport
): Promise<BuiltEwb> => {
  const c = await prisma.deliveryChallan.findUnique({
    where: { id: challanId },
    include: { items: true, jobWorker: true },
  });
  if (!c) throw new ApiError(404, "Job-work challan not found");
  if (c.cancelledAt) {
    throw new ApiError(409, `Challan ${c.challanNo} was cancelled`, "DOCUMENT_CANCELLED");
  }
  const seller = await sellerFor(c.businessPlaceId);
  // `toBusinessPlaceId` has no Prisma relation field (see the challan schema); fetch it directly.
  const toPlace = c.toBusinessPlaceId
    ? await prisma.businessPlace.findUnique({ where: { id: c.toBusinessPlaceId } })
    : null;
  const toGstin = c.jobWorker?.gstin ?? toPlace?.gstin ?? seller.gstin;
  const toStcd = c.placeOfSupply ?? toGstin?.slice(0, 2) ?? seller.stateCode;
  const items: EwbItem[] = c.items.map((i) => {
    const qty = Number(i.quantitySent);
    const rate = Number(i.rate ?? 0);
    const gst = Number(i.gstRate ?? 0);
    const intra = toStcd === seller.stateCode;
    return {
      productName: (i.description ?? "Item").slice(0, 100),
      hsnCode: i.hsnCode ?? "",
      quantity: qty,
      qtyUnit: unitCode(i.uom),
      taxableAmount: n(qty * rate),
      cgstRate: intra ? gst / 2 : 0,
      sgstRate: intra ? gst / 2 : 0,
      igstRate: intra ? 0 : gst,
      cessRate: 0,
    };
  });
  const taxable = n(items.reduce((s, i) => s + i.taxableAmount, 0));
  const cgst = n(items.reduce((s, i) => s + (i.taxableAmount * i.cgstRate) / 100, 0));
  const sgst = n(items.reduce((s, i) => s + (i.taxableAmount * i.sgstRate) / 100, 0));
  const igst = n(items.reduce((s, i) => s + (i.taxableAmount * i.igstRate) / 100, 0));
  const total = n(taxable + cgst + sgst + igst);
  const toName = c.jobWorker?.name ?? toPlace?.name ?? seller.legalName;
  const request: EwbRequest = {
    supplyType: "O",
    // 4 = job work, per the e-way bill sub-supply-type list.
    subSupplyType: c.jobWorker ? "4" : "5",
    subSupplyDesc: c.jobWorker ? "Job work" : "For own use",
    docType: "CHL",
    docNo: c.challanNo.slice(0, 16),
    docDate: dt(c.challanDate),
    fromGstin: seller.gstin,
    fromTrdName: (seller.tradeName ?? seller.legalName).slice(0, 100),
    fromAddr1: (seller.addressLine1 ?? "-").slice(0, 100),
    fromPlace: (seller.city ?? "-").slice(0, 50),
    fromPincode: pinOf(seller.pincode),
    fromStateCode: Number(seller.stateCode),
    actFromStateCode: Number(seller.stateCode),
    toGstin,
    toTrdName: toName.slice(0, 100),
    toAddr1: (c.jobWorker?.addressLine1 ?? "-").slice(0, 100),
    toPlace: (c.jobWorker?.city ?? "-").slice(0, 50),
    toPincode: pinOf(c.jobWorker?.pincode ?? seller.pincode),
    toStateCode: Number(toStcd),
    actToStateCode: Number(toStcd),
    totalValue: taxable,
    cgstValue: cgst,
    sgstValue: sgst,
    igstValue: igst,
    cessValue: 0,
    totInvValue: total,
    ...transportFields(t),
    itemList: items,
  };
  return {
    request,
    docType: "JWC",
    docRef: challanId,
    docNo: c.challanNo,
    docDate: c.challanDate,
    fromGstin: seller.gstin,
    toGstin,
    totalValue: total,
    irn: null,
    eInvoiceId: null,
  };
};

export const buildEwb = (
  docType: EwbDocType,
  docRef: string,
  t: EwbTransport
): Promise<BuiltEwb> => {
  if (docType === "INV") return buildInvoiceEwb(docRef, t);
  if (docType === "JWC") return buildJobWorkChallanEwb(docRef, t);
  let id: bigint;
  try {
    id = BigInt(docRef);
  } catch {
    throw new ApiError(400, "A dispatch reference must be a whole number");
  }
  return buildDispatchEwb(id, t);
};
