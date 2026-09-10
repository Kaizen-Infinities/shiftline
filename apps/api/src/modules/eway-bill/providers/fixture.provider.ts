import { createHash } from "node:crypto";

import {
  EwayBillProviderError,
  validUptoFor,
  type CancelRequest,
  type ConsolidateRequest,
  type ConsolidateResult,
  type EwayBillProvider,
  type EwbByIrnRequest,
  type EwbCredentials,
  type EwbRequest,
  type EwbResult,
  type ExtendRequest,
  type ExtendResult,
  type PartBRequest,
  type VehicleType,
} from "../eway-bill.types";

/**
 * The e-way bill portal without the portal: fresh 12-digit numbers per call (the portal never
 * reuses a number, a regenerated bill gets a new one), NIC's validity
 * arithmetic, and the refusals the portal makes (missing vehicle for road, cancelled twice,
 * extension outside the window is left to the service). Used by tests and until a GSP is on.
 */
const twelveDigits = (seed: string) =>
  String(
    BigInt(`0x${createHash("sha256").update(seed).digest("hex").slice(0, 14)}`) % 10n ** 12n
  ).padStart(12, "3");

export class EwbFixtureProvider implements EwayBillProvider {
  readonly name = "FIXTURE";
  private readonly cancelled = new Set<string>();

  async generate(request: EwbRequest, creds: EwbCredentials): Promise<EwbResult> {
    if (request.fromGstin !== creds.gstin) {
      throw new EwayBillProviderError("102", "Generator GSTIN does not match the logged-in GSTIN");
    }
    if (request.itemList.length === 0) throw new EwayBillProviderError("205", "Item list is empty");
    if (request.transMode === "1" && !request.vehicleNo && !request.transporterId) {
      throw new EwayBillProviderError(
        "245",
        "For road transport give a vehicle number or a transporter id"
      );
    }
    const distance = Number(request.transDistance) || 100;
    const ewbNo = twelveDigits(
      `${request.fromGstin}|${request.docType}|${request.docNo}|${request.docDate}`
    );
    const ewbDate = new Date();
    const hasPartB = Boolean(request.vehicleNo);
    return {
      ewbNo,
      ewbDate,
      validUpto: hasPartB
        ? validUptoFor(ewbDate, distance, (request.vehicleType as VehicleType) || "R")
        : null,
      alert: hasPartB
        ? null
        : "Part B not filled; the bill is not valid for movement until a vehicle is added",
      raw: { ewayBillNo: ewbNo, ewayBillDate: ewbDate.toISOString(), fixture: true },
    };
  }

  async generateByIrn(request: EwbByIrnRequest, creds: EwbCredentials): Promise<EwbResult> {
    if (!request.Irn) throw new EwayBillProviderError("4002", "IRN is required");
    if (request.TransMode === "1" && !request.VehNo && !request.TransId) {
      throw new EwayBillProviderError(
        "4006",
        "For road transport give a vehicle number or a transporter id"
      );
    }
    const ewbNo = twelveDigits(`${creds.gstin}|IRN|${request.Irn}|${Date.now()}|${Math.random()}`);
    const ewbDate = new Date();
    const hasPartB = Boolean(request.VehNo);
    return {
      ewbNo,
      ewbDate,
      validUpto: hasPartB
        ? validUptoFor(ewbDate, request.Distance || 100, (request.VehType as VehicleType) || "R")
        : null,
      alert: hasPartB ? null : "Part B not filled",
      raw: { EwbNo: ewbNo, EwbDt: ewbDate.toISOString(), fixture: true },
    };
  }

  async updatePartB(request: PartBRequest) {
    if (this.cancelled.has(request.ewbNo))
      throw new EwayBillProviderError("312", "E-way bill is cancelled");
    if (request.transMode === "1" && !request.vehicleNo) {
      throw new EwayBillProviderError("245", "Vehicle number is required for road transport");
    }
    return {
      ewbNo: request.ewbNo,
      validUpto: null,
      raw: { ewbNo: request.ewbNo, vehUpdDate: new Date().toISOString() },
    };
  }

  async extend(request: ExtendRequest): Promise<ExtendResult> {
    if (this.cancelled.has(request.ewbNo))
      throw new EwayBillProviderError("312", "E-way bill is cancelled");
    if (!request.extnRemarks.trim())
      throw new EwayBillProviderError("367", "Extension remarks are required");
    const validUpto = validUptoFor(new Date(), request.remainingDistance || 1, "R");
    return {
      ewbNo: request.ewbNo,
      validUpto,
      raw: { ewbNo: request.ewbNo, validUpto: validUpto.toISOString() },
    };
  }

  async cancel(request: CancelRequest) {
    if (this.cancelled.has(request.ewbNo))
      throw new EwayBillProviderError("313", "E-way bill is already cancelled");
    if (!request.cancelRmrk.trim())
      throw new EwayBillProviderError("314", "Cancellation remarks are required");
    this.cancelled.add(request.ewbNo);
    const cancelDate = new Date();
    return {
      ewbNo: request.ewbNo,
      cancelDate,
      raw: { ewbNo: request.ewbNo, cancelDate: cancelDate.toISOString() },
    };
  }

  async consolidate(request: ConsolidateRequest): Promise<ConsolidateResult> {
    if (request.tripSheetEwbBills.length === 0)
      throw new EwayBillProviderError("401", "No e-way bills to consolidate");
    for (const b of request.tripSheetEwbBills) {
      if (this.cancelled.has(b.ewbNo))
        throw new EwayBillProviderError("402", `E-way bill ${b.ewbNo} is cancelled`);
    }
    const cEwbNo = twelveDigits(
      `CEWB|${request.vehicleNo}|${request.tripSheetEwbBills.map((b) => b.ewbNo).join(",")}`
    );
    const cEwbDate = new Date();
    return { cEwbNo, cEwbDate, raw: { cEWBNo: cEwbNo, cEWBDate: cEwbDate.toISOString() } };
  }
}

export const ewbFixtureProvider = new EwbFixtureProvider();
