/**
 * The XML Tally imports (P1-06).
 *
 * Tally's import format is old and literal: tags in a fixed order, no namespaces, no attributes
 * it does not already know, and a parser that gives up on the whole file rather than skip a bad
 * record. So this builds the document by hand instead of reaching for a serialiser that would
 * produce technically valid XML Tally refuses.
 */

/**
 * Tally's parser does not resolve numeric entities in every field, so the four that matter are
 * escaped by name and control characters are dropped rather than encoded — a stray one aborts
 * the import with a message naming the wrong line.
 */
export const esc = (raw: unknown): string =>
  String(raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const tag = (name: string, value: unknown): string =>
  value === null || value === undefined || value === "" ? "" : `<${name}>${esc(value)}</${name}>`;

/** A Tally list element: the tag ends in `.LIST` and wraps its children. */
export const list = (name: string, children: string[]): string =>
  `<${name}.LIST>${children.join("")}</${name}.LIST>`;

export type TallyReport = "All Masters" | "Vouchers";

/**
 * The import envelope. `SVCURRENTCOMPANY` names the company the data lands in: get it wrong and
 * Tally imports into whichever company is open, which is how a month of purchases ends up in
 * last year's books.
 */
export const envelope = (report: TallyReport, company: string, messages: string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<ENVELOPE>",
    "<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>",
    "<BODY><IMPORTDATA>",
    `<REQUESTDESC><REPORTNAME>${report}</REPORTNAME>`,
    `<STATICVARIABLES>${tag("SVCURRENTCOMPANY", company)}</STATICVARIABLES></REQUESTDESC>`,
    "<REQUESTDATA>",
    ...messages.map((m) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${m}</TALLYMESSAGE>`),
    "</REQUESTDATA>",
    "</IMPORTDATA></BODY>",
    "</ENVELOPE>",
  ].join("\n");

/** Tally's yes/no fields are the words, not booleans. */
export const yn = (v: boolean): string => (v ? "Yes" : "No");
