import type { AsnExportDoc, AsnExportProvider } from "./types";

/**
 * GENERIC_CSV: one row per ASN line with the header repeated, the shape most OEM supplier
 * portals accept for a bulk ASN upload once the columns are mapped. RFC 4180 quoting; a cell
 * that starts with = + - @ is prefixed with an apostrophe so a spreadsheet never runs it as a
 * formula.
 */
export const COLUMNS = [
  "ASN No",
  "ASN Status",
  "Dispatch Date",
  "Dispatch Time",
  "Supplier Name",
  "Supplier GSTIN",
  "Customer Name",
  "Customer Code",
  "Customer GSTIN",
  "Invoice No",
  "Invoice Date",
  "Vehicle No",
  "Transporter",
  "LR No",
  "LR Date",
  "Line No",
  "Customer Part No",
  "Description",
  "Item Code",
  "HSN",
  "UOM",
  "Qty",
  "Pack Qty",
  "No of Packs",
  "Schedule No",
  "Schedule Due Date",
] as const;

export const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const istParts = (d: Date) => {
  const ist = new Date(d.getTime() + 330 * 60_000).toISOString();
  return { date: ist.slice(0, 10), time: ist.slice(11, 16) };
};

export const renderCsv = (doc: AsnExportDoc): string => {
  const at = istParts(doc.dispatchAt);
  const rows = doc.lines.map((l) => [
    doc.asnNo,
    doc.status,
    at.date,
    at.time,
    doc.supplier.name,
    doc.supplier.gstin,
    doc.customer.name,
    doc.customer.code,
    doc.customer.gstin,
    doc.invoiceNo,
    doc.invoiceDate,
    doc.vehicleNo,
    doc.transporterName,
    doc.lrNo,
    doc.lrDate,
    l.seq,
    l.customerPartNo,
    l.description,
    l.itemCode,
    l.hsnCode,
    l.uom,
    l.qty,
    l.packQty,
    l.packs,
    l.scheduleNo,
    l.scheduleDueDate,
  ]);
  return (
    "\uFEFF" +
    [COLUMNS as readonly unknown[], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
};

export const genericCsvProvider: AsnExportProvider = {
  key: "GENERIC_CSV",
  label: "Generic CSV (one row per part)",
  available: true,
  render: (doc) => ({
    fileName: `${doc.asnNo.replace(/[^A-Za-z0-9_.-]/g, "_")}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: Buffer.from(renderCsv(doc), "utf8"),
  }),
};
