import { API_PATHS } from "@shiftline/shared";

import apiClient from "../api/apiClient";

/** OEM ASN, packing labels and the customer part-number map (TN-07). */
export type AsnStatus = "DRAFT" | "SENT" | "ACKNOWLEDGED" | "CANCELLED";
export type LabelSize = "A4" | "100X150";

export interface PartMap {
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productCode: string;
  productName: string;
  customerPartNo: string;
  description: string | null;
  packQty: number | null;
  packType: string | null;
  isActive: boolean;
}

export interface PartMapInput {
  customerId: string;
  productId: string;
  customerPartNo: string;
  description?: string;
  packQty?: number;
  packType?: string;
  isActive?: boolean;
}

export type PartMapPatch = Partial<{
  productId: string;
  customerPartNo: string;
  description: string | null;
  packQty: number | null;
  packType: string | null;
  isActive: boolean;
}>;

export interface AsnRow {
  id: string;
  asnNo: string;
  status: AsnStatus;
  customerId: string;
  customerName: string;
  salesInvoiceId: string;
  invoiceNo: string;
  vehicleNo: string | null;
  dispatchAt: string;
  lineCount: number;
  totalQty: number;
  totalPacks: number;
}

export interface AsnLine {
  id: string;
  seq: number;
  productId: string;
  productCode: string;
  productName: string;
  customerPartNo: string;
  description: string | null;
  uom: string | null;
  qty: number;
  packQty: number;
  packs: number;
  scheduleLineId: string | null;
  schedule: { scheduleId: string; scheduleNo: string; revision: number; dueDate: string } | null;
  dispatchBooked: boolean;
}

export interface AsnDetail extends Omit<AsnRow, "lineCount"> {
  invoiceDate: string;
  transporterName: string | null;
  lrNo: string | null;
  lrDate: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  ackRef: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  lines: AsnLine[];
}

export interface InvoiceOption {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerId: string;
  customerName: string;
  itemCount: number;
}

export interface OpenScheduleLine {
  id: string;
  productId: string | null;
  customerPartNo: string;
  scheduleNo: string;
  revision: number;
  dueDate: string;
  firmness: "FIRM" | "TENTATIVE";
  remaining: number;
}

export interface ProposedLine {
  productId: string;
  productCode: string;
  productName: string;
  customerPartNo: string | null;
  description: string | null;
  uom: string | null;
  qty: number;
  packQty: number;
  packs: number;
  scheduleLineId: string | null;
  mapped: boolean;
}

export interface AsnPrefill {
  invoice: {
    id: string;
    invoiceNo: string;
    invoiceDate: string;
    customerId: string;
    customerName: string;
  };
  existingAsn: { id: string; asnNo: string } | null;
  transport: {
    vehicleNo: string | null;
    transporterName: string | null;
    lrNo: string | null;
    lrDate: string | null;
  };
  lines: ProposedLine[];
  unmappedProducts: string[];
  openScheduleLines: OpenScheduleLine[];
}

export interface AsnLineInput {
  productId: string;
  customerPartNo: string;
  description?: string;
  qty: number;
  packQty: number;
  scheduleLineId?: string | null;
}

export interface CreateAsn {
  salesInvoiceId: string;
  asnNo?: string;
  vehicleNo?: string;
  transporterName?: string;
  lrNo?: string;
  lrDate?: string;
  dispatchAt: string;
  notes?: string;
  lines?: AsnLineInput[];
}

export interface ExportFormat {
  key: string;
  label: string;
  available: boolean;
  note: string | null;
}

const p = API_PATHS.asn;

/** A failed blob request carries its JSON error body as a Blob; turn it back into JSON. */
const withJsonError = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    const res = (err as { response?: { data?: unknown } }).response;
    if (res && res.data instanceof Blob) {
      try {
        res.data = JSON.parse(await res.data.text());
      } catch {
        res.data = {};
      }
    }
    throw err;
  }
};

const fileNameOf = (disposition: string | undefined, fallback: string) =>
  /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? fallback;

export const asnService = {
  // Part map
  partMaps: async (params: { customerId?: string; q?: string } = {}): Promise<PartMap[]> =>
    (await apiClient.get(p.partMaps, { params })).data.data,
  createPartMap: async (body: PartMapInput): Promise<PartMap> =>
    (await apiClient.post(p.partMaps, body)).data.data,
  updatePartMap: async (id: string, body: PartMapPatch): Promise<PartMap> =>
    (await apiClient.patch(`${p.partMaps}/${id}`, body)).data.data,
  deletePartMap: async (id: string): Promise<void> => {
    await apiClient.delete(`${p.partMaps}/${id}`);
  },

  // ASN
  list: async (
    params: { status?: AsnStatus; customerId?: string; q?: string } = {}
  ): Promise<AsnRow[]> => (await apiClient.get(p.base, { params })).data.data,
  get: async (id: string): Promise<AsnDetail> => (await apiClient.get(`${p.base}/${id}`)).data.data,
  invoices: async (params: { q?: string; customerId?: string } = {}): Promise<InvoiceOption[]> =>
    (await apiClient.get(p.invoices, { params })).data.data,
  prefill: async (salesInvoiceId: string): Promise<AsnPrefill> =>
    (await apiClient.get(p.prefill, { params: { salesInvoiceId } })).data.data,
  create: async (body: CreateAsn): Promise<AsnDetail> =>
    (await apiClient.post(p.base, body)).data.data,
  update: async (
    id: string,
    body: Partial<Omit<CreateAsn, "salesInvoiceId" | "asnNo">>
  ): Promise<AsnDetail> => (await apiClient.patch(`${p.base}/${id}`, body)).data.data,
  setStatus: async (
    id: string,
    body: { status: Exclude<AsnStatus, "DRAFT">; ackRef?: string; reason?: string }
  ): Promise<AsnDetail> => (await apiClient.post(`${p.base}/${id}/status`, body)).data.data,
  formats: async (): Promise<ExportFormat[]> => (await apiClient.get(p.formats)).data.data,

  /** Downloads the ASN in the chosen upload format. */
  download: async (id: string, format: string, fallbackName: string): Promise<void> => {
    const res = await withJsonError(() =>
      apiClient.get(`${p.base}/${id}/export`, { params: { format }, responseType: "blob" })
    );
    const href = URL.createObjectURL(res.data as Blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileNameOf(res.headers["content-disposition"] as string, fallbackName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },

  /** Opens the packing-label PDF in a new tab, ready to print. */
  printLabels: async (id: string, size: LabelSize): Promise<void> => {
    const tab = window.open("", "_blank");
    let res;
    try {
      res = await withJsonError(() =>
        apiClient.get(`${p.base}/${id}/labels`, { params: { size }, responseType: "blob" })
      );
    } catch (err) {
      tab?.close();
      throw err;
    }
    const href = URL.createObjectURL(new Blob([res.data as Blob], { type: "application/pdf" }));
    if (tab) tab.location.href = href;
    else window.location.assign(href);
    setTimeout(() => URL.revokeObjectURL(href), 300_000);
  },
};
