import QRCode from "qrcode";

import { generatePdfFromHtml } from "../../utils/pdfGenerator";
import type { PackLabel } from "./asn.calc";

/**
 * Packing labels (TN-07): one label per pack with a QR code of `asnNo|partNo|qty|packSeq`.
 * Two sheets: A4 with 8 labels (2 × 4, 99 × 67 mm, the common laser label stock) and a
 * 100 × 150 mm thermal label, one per page. QR codes are inline SVG, so the page needs nothing
 * from the network and prints as soon as it is parsed.
 */
export type LabelSize = "A4" | "100X150";

export interface LabelSheetHeader {
  supplierName: string;
  customerName: string;
  asnNo: string;
  invoiceNo: string;
  dispatchDate: string;
  vehicleNo: string | null;
}

const esc = (v: unknown): string =>
  (v === null || v === undefined ? "" : String(v))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtQty = (n: number) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 3, minimumFractionDigits: 0 });

const qrSvg = (payload: string) =>
  QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 0 });

export const renderLabelsHtml = async (
  header: LabelSheetHeader,
  labels: PackLabel[],
  size: LabelSize
): Promise<string> => {
  const svgs = await Promise.all(labels.map((l) => qrSvg(l.qr)));
  const a4 = size === "A4";
  const cards = labels
    .map(
      (l, i) => `
<div class="label">
  <div class="top"><span>${esc(header.supplierName)}</span><span>To: ${esc(header.customerName)}</span></div>
  <div class="body">
    <div class="info">
      <div class="k">Part no.</div>
      <div class="part">${esc(l.customerPartNo)}</div>
      <div class="desc">${esc(l.description ?? "")}</div>
      <div class="row"><div><div class="k">Qty</div><div class="qty">${esc(fmtQty(l.qty))}</div></div>
        <div><div class="k">Pack</div><div class="pack">${l.packSeq} / ${l.totalPacks}</div></div></div>
    </div>
    <div class="qr">${svgs[i]}</div>
  </div>
  <div class="foot">
    <span>ASN <b>${esc(header.asnNo)}</b></span><span>Inv ${esc(header.invoiceNo)}</span>
    <span>${esc(header.dispatchDate)}</span>${header.vehicleNo ? `<span>${esc(header.vehicleNo)}</span>` : ""}
    <span>Line ${l.lineSeq} · ${l.linePack}/${l.linePacks}</span>
  </div>
</div>`
    )
    .join("");

  const sizing = a4
    ? `@page { size: A4; margin: 0; }
       .sheet { display: grid; grid-template-columns: 99mm 99mm; grid-auto-rows: 67mm;
                gap: 0 2.5mm; padding: 13mm 4.75mm 0; }
       .label { height: 67mm; }
       .label:nth-child(8n) { break-after: page; }
       .part { font-size: 17pt; } .qty { font-size: 16pt; } .qr svg { width: 30mm; height: 30mm; }`
    : `@page { size: 100mm 150mm; margin: 0; }
       .label { width: 100mm; height: 150mm; break-after: page; padding: 5mm; }
       .label:last-child { break-after: auto; }
       .body { flex-direction: column; align-items: stretch; }
       .part { font-size: 24pt; } .qty { font-size: 22pt; }
       .qr { align-self: center; } .qr svg { width: 55mm; height: 55mm; }`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(header.asnNo)} labels</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .label { padding: 3mm 4mm; border: 0.3mm dashed #999; overflow: hidden;
           display: flex; flex-direction: column; gap: 1.5mm; break-inside: avoid; }
  .top { display: flex; justify-content: space-between; gap: 2mm; font-size: 7.5pt;
         font-weight: bold; border-bottom: 0.3mm solid #000; padding-bottom: 1mm; }
  .top span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%; }
  .body { flex: 1; display: flex; gap: 3mm; align-items: center; }
  .info { flex: 1; min-width: 0; }
  .k { font-size: 6.5pt; text-transform: uppercase; color: #444; letter-spacing: 0.04em; }
  .part { font-weight: bold; font-family: "Courier New", monospace; word-break: break-all; }
  .desc { font-size: 8pt; margin: 0.5mm 0 1.5mm; max-height: 7mm; overflow: hidden; }
  .row { display: flex; gap: 6mm; }
  .qty, .pack { font-weight: bold; }
  .pack { font-size: 12pt; }
  .foot { display: flex; flex-wrap: wrap; gap: 1mm 3mm; font-size: 7pt;
          border-top: 0.3mm solid #000; padding-top: 1mm; }
  ${sizing}
</style></head><body><div class="sheet">${cards}</div></body></html>`;
};

export const renderLabelsPdf = async (
  header: LabelSheetHeader,
  labels: PackLabel[],
  size: LabelSize
): Promise<Buffer> => {
  const html = await renderLabelsHtml(header, labels, size);
  return generatePdfFromHtml(html, {
    margin: "0",
    page: size === "A4" ? { width: "210mm", height: "297mm" } : { width: "100mm", height: "150mm" },
  });
};
