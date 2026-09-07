import QRCode from "qrcode";

import { eInvoiceService } from "./e-invoice.service";
import type { EInvoiceDocType } from "./e-invoice.types";

/** What a printed document shows once it has an IRN: the number, the acknowledgement and the signed QR. */
export interface EInvoicePrintBlock {
  irn: string;
  ackNo: string | null;
  ackDate: string | null;
  qrDataUrl: string;
  cancelled: boolean;
}

export const eInvoicePrintBlock = async (
  docType: EInvoiceDocType,
  docId: string
): Promise<EInvoicePrintBlock | null> => {
  const row = await eInvoiceService.forDocument(docType, docId);
  if (!row || !row.irn || (row.status !== "GENERATED" && row.status !== "CANCELLED")) return null;
  const qrDataUrl = await QRCode.toDataURL(row.signedQr || row.irn, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: 150,
  });
  return {
    irn: row.irn,
    ackNo: row.ackNo,
    ackDate: row.ackDate
      ? row.ackDate.toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null,
    qrDataUrl,
    cancelled: row.status === "CANCELLED",
  };
};
