/**
 * Minimal RFC 4180 CSV reader/writer: quoted fields, escaped quotes, CR/LF/CRLF
 * line ends, a UTF-8 BOM, and a trailing newline. No streaming: imports are
 * capped at a few thousand rows and a few megabytes.
 */
export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export const parseCsv = (input: string): ParsedCsv => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    // Skip fully blank lines.
    if (record.length > 1 || record[0].trim() !== "") records.push(record);
    record = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      endRecord();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRecord();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || record.length) endRecord();

  if (records.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows };
};

const escapeCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const toCsv = (rows: string[][]): string =>
  rows.map((r) => r.map((c) => escapeCell(c ?? "")).join(",")).join("\r\n") + "\r\n";

/** `Customer Code`, `customer_code` and `customercode` all map to `customerCode`. */
export const normaliseHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
