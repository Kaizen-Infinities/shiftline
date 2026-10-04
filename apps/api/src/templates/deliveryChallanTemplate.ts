import { escapeHtml as esc } from "../utils/escapeHtml";
/**
 * The delivery challan a driver carries (P1-14).
 *
 * Goods moving without a sale still have to be accompanied by a document, and above the
 * threshold by an e-way bill — so the bill number is printed at the top where a checkpost looks,
 * not buried in the footer. A job-work challan also prints the date the goods have to be back
 * by, because that deadline is the one the company loses money on.
 */
export interface ChallanPrintItem {
  description: string;
  hsnCode: string | null;
  uom: string | null;
  quantitySent: number;
  rate: number;
  taxableAmount: number;
}

export interface ChallanPrintData {
  challanNo: string;
  challanDate: Date | string;
  kind: string;
  purpose: string | null;
  returnDueDate: Date | string | null;
  capitalGoods: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  totalValue: number;
  transporterName: string | null;
  vehicleNumber: string | null;
  remarks: string | null;
  items: ChallanPrintItem[];
  company: { name: string; address?: string | null; gstin?: string | null };
  consignee: { name: string; gstin?: string | null; address?: string | null };
  /** Printed prominently: this is what a checkpost asks for. */
  ewayBillNo?: string | null;
  ewayBillValidUpto?: Date | string | null;
}

const KIND_LABEL: Record<string, string> = {
  JOB_WORK_OUT: "Delivery Challan — goods sent for job work",
  JOB_WORK_RETURN: "Delivery Challan — goods returned from job work",
  BRANCH_TRANSFER: "Delivery Challan — transfer between own places",
  EXHIBITION: "Delivery Challan — goods for exhibition",
  LINE_SALES: "Delivery Challan — goods for line sales",
  OTHER: "Delivery Challan",
};

const money = (n: number | string) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(n ?? 0)
  );
const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

export const generateDeliveryChallanHtml = (data: ChallanPrintData): string => {
  const rows = data.items
    .map(
      (i, idx) => `
      <tr>
        <td class="b p">${idx + 1}</td>
        <td class="b p">${esc(i.description)}</td>
        <td class="b p">${esc(i.hsnCode ?? "")}</td>
        <td class="b p r">${Number(i.quantitySent)}</td>
        <td class="b p">${esc(i.uom ?? "")}</td>
        <td class="b p r">${money(i.rate)}</td>
        <td class="b p r">${money(i.taxableAmount)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
  .b { border: 1px solid #000; }
  .p { padding: 4px 6px; }
  .r { text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .muted { color: #555; font-size: 11px; }
  .band { border: 2px solid #000; padding: 6px 8px; margin: 8px 0; font-weight: bold; }
  .cols { display: flex; gap: 12px; }
  .col { flex: 1; }
</style></head>
<body>
  <div style="text-align:center">
    <h1>${esc(data.company.name)}</h1>
    <div class="muted">${esc(data.company.address ?? "")}</div>
    <div class="muted">${data.company.gstin ? `GSTIN ${esc(data.company.gstin)}` : ""}</div>
    <div style="margin-top:6px;font-weight:bold">${esc(KIND_LABEL[data.kind] ?? KIND_LABEL.OTHER)}</div>
    <div class="muted">Not a tax invoice. No supply is made by this document.</div>
  </div>

  ${
    data.ewayBillNo
      ? `<div class="band">E-way bill ${esc(data.ewayBillNo)}${
          data.ewayBillValidUpto ? ` · valid to ${esc(day(data.ewayBillValidUpto))}` : ""
        }</div>`
      : ""
  }

  <div class="cols" style="margin-top:8px">
    <div class="col b p">
      <div><strong>Challan</strong> ${esc(data.challanNo)}</div>
      <div>Dated ${esc(day(data.challanDate))}</div>
      ${data.purpose ? `<div>Purpose: ${esc(data.purpose)}</div>` : ""}
      ${
        data.returnDueDate
          ? `<div><strong>Goods to be returned by ${esc(day(data.returnDueDate))}</strong>${
              data.capitalGoods ? " (capital goods, three years)" : " (one year)"
            }</div>`
          : ""
      }
    </div>
    <div class="col b p">
      <div><strong>Consignee</strong></div>
      <div>${esc(data.consignee.name)}</div>
      <div class="muted">${esc(data.consignee.address ?? "")}</div>
      <div class="muted">${data.consignee.gstin ? `GSTIN ${esc(data.consignee.gstin)}` : "Unregistered"}</div>
    </div>
  </div>

  <table style="margin-top:8px">
    <thead>
      <tr>
        <th class="b p">#</th><th class="b p">Description</th><th class="b p">HSN</th>
        <th class="b p r">Qty</th><th class="b p">UOM</th>
        <th class="b p r">Rate</th><th class="b p r">Value</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td class="b p r" colspan="6"><strong>Value of goods</strong></td>
        <td class="b p r"><strong>${money(data.taxable)}</strong></td>
      </tr>
      ${
        data.igst > 0
          ? `<tr><td class="b p r" colspan="6">IGST (notional)</td><td class="b p r">${money(data.igst)}</td></tr>`
          : `<tr><td class="b p r" colspan="6">CGST + SGST (notional)</td><td class="b p r">${money(
              Number(data.cgst) + Number(data.sgst)
            )}</td></tr>`
      }
      <tr>
        <td class="b p r" colspan="6"><strong>Total value for the e-way bill</strong></td>
        <td class="b p r"><strong>${money(data.totalValue)}</strong></td>
      </tr>
    </tfoot>
  </table>

  <div class="cols" style="margin-top:8px">
    <div class="col b p">
      <div>Transporter: ${esc(data.transporterName ?? "—")}</div>
      <div>Vehicle: ${esc(data.vehicleNumber ?? "—")}</div>
      ${data.remarks ? `<div class="muted">${esc(data.remarks)}</div>` : ""}
    </div>
    <div class="col b p" style="text-align:right">
      <div style="height:48px"></div>
      <div>For ${esc(data.company.name)}</div>
      <div class="muted">Authorised signatory</div>
    </div>
  </div>
</body></html>`;
};
