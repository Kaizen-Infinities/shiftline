/** One CSV field: text is quoted (and quotes doubled), numbers stay raw so a spreadsheet can sum them. */
const field = (v: string | number): string =>
  typeof v === "number" ? (Math.round(v * 100) / 100).toFixed(2) : `"${v.replace(/"/g, '""')}"`;

export const toCsv = (rows: (string | number)[][]): string =>
  rows.map((r) => r.map(field).join(",")).join("\r\n");
