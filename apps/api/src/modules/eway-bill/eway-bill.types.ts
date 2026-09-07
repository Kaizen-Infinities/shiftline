/**
 * E-way bill (P1-12, FI2). Requests follow NIC's e-way bill API (v1.03) and the e-invoice
 * portal's "generate e-way bill by IRN" call; providers carry transport and the response
 * envelope, the mapping from Shiftline documents lives in `eway-bill.payload.ts`.
 */
export type EwbDocType = "INV" | "CHL";

/** 1 road, 2 rail, 3 air, 4 ship */
export type TransMode = "1" | "2" | "3" | "4";
export type VehicleType = "R" | "O";

export interface EwbTransport {
  distanceKm: number;
  transMode: TransMode;
  transporterId?: string | null;
  transporterName?: string | null;
  transDocNo?: string | null;
  /** dd/mm/yyyy */
  transDocDate?: string | null;
  vehicleNo?: string | null;
  vehicleType: VehicleType;
}

export interface EwbItem {
  productName: string;
  productDesc?: string;
  hsnCode: string;
  quantity: number;
  qtyUnit: string;
  taxableAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cessRate: number;
}

/** Standalone generation (no IRN): NIC e-way bill schema. */
export interface EwbRequest {
  supplyType: "O" | "I";
  /** 1 supply, 4 job work, 5 for own use, 8 others, 10 line sales, 11 recipient not known, 12 exhibition */
  subSupplyType: string;
  subSupplyDesc?: string;
  docType: "INV" | "CHL" | "BIL" | "BOE" | "OTH";
  docNo: string;
  /** dd/mm/yyyy */
  docDate: string;
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromAddr2?: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  actFromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toAddr2?: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  actToStateCode: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  totInvValue: number;
  transporterId?: string;
  transporterName?: string;
  transDocNo?: string;
  transMode?: string;
  transDistance: string;
  transDocDate?: string;
  vehicleNo?: string;
  vehicleType?: string;
  itemList: EwbItem[];
}

/** Generation through the e-invoice portal, from an IRN. */
export interface EwbByIrnRequest {
  Irn: string;
  Distance: number;
  TransMode?: string;
  TransId?: string;
  TransName?: string;
  TransDocDt?: string;
  TransDocNo?: string;
  VehNo?: string;
  VehType?: string;
}

export interface EwbResult {
  ewbNo: string;
  ewbDate: Date;
  validUpto: Date | null;
  alert?: string | null;
  raw: unknown;
}

export interface PartBRequest {
  ewbNo: string;
  vehicleNo?: string;
  fromPlace: string;
  fromState: number;
  /** 1 due to break down, 2 due to transhipment, 3 others, 4 first time */
  reasonCode: "1" | "2" | "3" | "4";
  reasonRem: string;
  transDocNo?: string;
  transDocDate?: string;
  transMode: string;
  vehicleType?: string;
}

export interface ExtendRequest {
  ewbNo: string;
  vehicleNo?: string;
  fromPlace: string;
  fromState: number;
  fromPincode: number;
  remainingDistance: number;
  transDocNo?: string;
  transDocDate?: string;
  transMode: string;
  /** 1 natural calamity, 2 law and order, 4 transhipment, 5 accident, 99 others */
  extnRsnCode: "1" | "2" | "4" | "5" | "99";
  extnRemarks: string;
  /** M in movement, T in transit */
  consignmentStatus: "M" | "T";
  /** R road, W warehouse, O others (when in transit) */
  transitType?: "R" | "W" | "O";
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
}

export interface ExtendResult {
  ewbNo: string;
  validUpto: Date;
  raw: unknown;
}

export interface CancelRequest {
  ewbNo: string;
  /** 1 duplicate, 2 order cancelled, 3 data entry mistake, 4 others */
  cancelRsnCode: "1" | "2" | "3" | "4";
  cancelRmrk: string;
}

export interface ConsolidateRequest {
  fromPlace: string;
  fromState: number;
  vehicleNo: string;
  transMode: string;
  transDocNo?: string;
  transDocDate?: string;
  tripSheetEwbBills: { ewbNo: string }[];
}

export interface ConsolidateResult {
  cEwbNo: string;
  cEwbDate: Date;
  raw: unknown;
}

export const EWB_CANCEL_REASONS = {
  "1": "Duplicate",
  "2": "Order cancelled",
  "3": "Data entry mistake",
  "4": "Others",
} as const;
export const PART_B_REASONS = {
  "1": "Due to break down",
  "2": "Due to transhipment",
  "3": "Others",
  "4": "First time",
} as const;
export const EXTEND_REASONS = {
  "1": "Natural calamity",
  "2": "Law and order situation",
  "4": "Transhipment",
  "5": "Accident",
  "99": "Others",
} as const;

export interface EwbCredentials {
  baseUrl: string | null;
  clientId: string | null;
  clientSecret: string | null;
  username: string | null;
  password: string | null;
  gstin: string;
}

export class EwayBillProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "EwayBillProviderError";
  }
}

export interface EwayBillProvider {
  readonly name: string;
  generate(request: EwbRequest, creds: EwbCredentials): Promise<EwbResult>;
  generateByIrn(request: EwbByIrnRequest, creds: EwbCredentials): Promise<EwbResult>;
  updatePartB(
    request: PartBRequest,
    creds: EwbCredentials
  ): Promise<{ ewbNo: string; validUpto: Date | null; raw: unknown }>;
  extend(request: ExtendRequest, creds: EwbCredentials): Promise<ExtendResult>;
  cancel(
    request: CancelRequest,
    creds: EwbCredentials
  ): Promise<{ ewbNo: string; cancelDate: Date; raw: unknown }>;
  consolidate(request: ConsolidateRequest, creds: EwbCredentials): Promise<ConsolidateResult>;
}

/** NIC validity: one day per 200 km for a regular vehicle, per 20 km for over-dimensional cargo. */
export const validityDays = (distanceKm: number, vehicleType: VehicleType): number =>
  Math.max(1, Math.ceil(Math.max(distanceKm, 1) / (vehicleType === "O" ? 20 : 200)));

/** Validity ends at midnight IST of the last day. */
export const validUptoFor = (from: Date, distanceKm: number, vehicleType: VehicleType): Date => {
  const days = validityDays(distanceKm, vehicleType);
  const ist = new Date(from.getTime() + 5.5 * 3600 * 1000);
  const endIst = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate() + days,
    23,
    59,
    59
  );
  return new Date(endIst - 5.5 * 3600 * 1000);
};
