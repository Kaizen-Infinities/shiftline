/**
 * CSV and PDF rendering shared by every inspector's register (P2-03). Kept in its own file
 * because it has nothing to do with reading payroll/attendance data — it only turns rows the
 * service already computed into bytes.
 */
import { generatePdfFromHtml } from "../../utils/pdfGenerator";

export interface RegisterColumn {
  key: string;
  label: string;
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "string" ? v : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Builds a CSV string with a header row from a list of columns and plain row objects. */
export function toCsv(columns: RegisterColumn[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}

const escapeHtml = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

/** Builds a printable HTML table for the register — the basis for both the on-screen preview
 *  and the PDF export. */
export function toHtml(opts: {
  title: string;
  subtitle?: string;
  columns: RegisterColumn[];
  rows: Array<Record<string, unknown>>;
  totalsRow?: Record<string, unknown>;
}): string {
  const { title, subtitle, columns, rows, totalsRow } = opts;
  const thead = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const tbody = rows
    .map((row) => `<tr>${columns.map((c) => `<td>${escapeHtml(row[c.key])}</td>`).join("")}</tr>`)
    .join("");
  const tfoot = totalsRow
    ? `<tr class="totals">${columns.map((c) => `<td>${escapeHtml(totalsRow[c.key])}</td>`).join("")}</tr>`
    : "";
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 16px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 12px; font-weight: normal; color: #555; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; white-space: nowrap; }
  th { background: #f2f2f2; }
  tr.totals td { font-weight: bold; background: #f8f8f8; }
</style>
</head><body>
<h1>${escapeHtml(title)}</h1>
${subtitle ? `<h2>${escapeHtml(subtitle)}</h2>` : ""}
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}${tfoot}</tbody></table>
</body></html>`;
}

/** Renders the register HTML to a PDF buffer via the shared puppeteer helper. */
export async function toPdf(html: string): Promise<Buffer> {
  return generatePdfFromHtml(html);
}
