/**
 * An ASN as an export adapter sees it: plain values, already tenant-checked and resolved by the
 * service. Adapters only turn this into bytes; they never read the database or call a portal.
 */
export interface AsnExportDoc {
  asnNo: string;
  status: string;
  dispatchAt: Date;
  supplier: { name: string; gstin: string | null };
  customer: { name: string; gstin: string | null; code: string | null };
  invoiceNo: string;
  invoiceDate: string;
  vehicleNo: string | null;
  transporterName: string | null;
  lrNo: string | null;
  lrDate: string | null;
  lines: {
    seq: number;
    customerPartNo: string;
    description: string | null;
    itemCode: string | null;
    hsnCode: string | null;
    uom: string | null;
    qty: number;
    packQty: number;
    packs: number;
    scheduleNo: string | null;
    scheduleDueDate: string | null;
  }[];
}

export interface AsnExportFile {
  fileName: string;
  contentType: string;
  body: Buffer;
}

export interface AsnExportProvider {
  /** Stable key used in `?format=`. */
  key: string;
  label: string;
  /** False for a documented adapter that is not built yet; `render` then refuses with 501. */
  available: boolean;
  /** What the adapter needs before it can be built (for the TODO adapters). */
  note?: string;
  render(doc: AsnExportDoc): AsnExportFile;
}
