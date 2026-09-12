import { ApiError } from "../../utils/ApiError";
import type {
  Gstr2bDocData,
  Gstr2bInv,
  Gstr2bJson,
  Gstr2bNote,
  Gstr2bSupplierBlock,
  ParsedRecord,
} from "./gstr2b.types";

/**
 * Flattening the portal's GSTR-2B JSON into one row per supplier document (P1-13c), and the
 * document-number normalisation the reconciliation matches on.
 */
const n2 = (v: unknown) => Math.round((Number(v ?? 0) || 0) * 100) / 100;

/**
 * Document numbers are typed by two different people into two different systems, so they are
 * compared with the noise taken out: case, spaces, and the `/`, `-` and `_` separators, and the
 * zeros padding the serial. `INV/001`, `inv-1` and `INV 0001` are one document.
 *
 * The alphabetic part is kept, because `A/1` and `B/1` are not the same document; only the
 * zeros immediately before the trailing digits go.
 */
export const normaliseDocNo = (raw: string): string => {
  const stripped = String(raw)
    .toUpperCase()
    .replace(/[\s/\-_.]/g, "");
  // Drop the zeros *padding* the final numeric run — INV0001 → INV1, 0001 → 1 — without
  // touching a zero inside the number, which would make INV101 and INV11 the same bill.
  return stripped.replace(/\d+$/, (digits) => digits.replace(/^0+(?=\d)/, "")).slice(0, 40);
};

/** The portal writes dates as dd-mm-yyyy. */
export const portalDate = (raw: string | null | undefined): Date | null => {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
};

/** `082026` → `2026-08`, the period key everything else in the module uses. */
export const periodFromRtnprd = (raw: string | null | undefined): string | null => {
  const m = String(raw ?? "").match(/^(\d{2})(\d{4})$/);
  return m ? `${m[2]}-${m[1]}` : null;
};

const sumItems = (
  items: { txval: number; igst?: number; cgst?: number; sgst?: number; cess?: number }[]
) => ({
  taxable: n2(items.reduce((s, i) => s + Number(i.txval ?? 0), 0)),
  igst: n2(items.reduce((s, i) => s + Number(i.igst ?? 0), 0)),
  cgst: n2(items.reduce((s, i) => s + Number(i.cgst ?? 0), 0)),
  sgst: n2(items.reduce((s, i) => s + Number(i.sgst ?? 0), 0)),
  cess: n2(items.reduce((s, i) => s + Number(i.cess ?? 0), 0)),
});

const docData = (json: Gstr2bJson): Gstr2bDocData => {
  const data = json.data?.docdata ?? json.docdata;
  if (!data) throw new ApiError(400, "That file is not a GSTR-2B: no docdata block", "NOT_2B");
  return data;
};

/** The GSTIN and period the file was drawn for. */
export const envelopeOf = (json: Gstr2bJson) => ({
  gstin: (json.data?.gstin ?? json.gstin ?? null)?.toUpperCase() ?? null,
  periodKey: periodFromRtnprd(json.data?.rtnprd ?? json.rtnprd),
});

const fromInvoices = (
  blocks: Gstr2bSupplierBlock<Gstr2bInv>[] | undefined,
  docType: ParsedRecord["docType"]
): ParsedRecord[] => {
  const out: ParsedRecord[] = [];
  for (const block of blocks ?? []) {
    const filingDate = portalDate(block.supfildt);
    for (const inv of block.inv ?? []) {
      const date = portalDate(inv.dt);
      if (!date) continue;
      const sums = sumItems(inv.items ?? []);
      out.push({
        supplierGstin: block.ctin.toUpperCase(),
        supplierName: block.trdnm ?? null,
        docType,
        docNo: inv.inum,
        docDate: date,
        docValue: n2(inv.val),
        placeOfSupply: inv.pos ?? null,
        reverseCharge: inv.rev === "Y",
        ...sums,
        itcAvailable: inv.itcavl !== "N",
        itcReason: inv.rsn ?? null,
        filingPeriod: periodFromRtnprd(block.supprd),
        filingDate,
        raw: inv,
      });
    }
  }
  return out;
};

const fromNotes = (blocks: Gstr2bSupplierBlock<Gstr2bNote>[] | undefined): ParsedRecord[] => {
  const out: ParsedRecord[] = [];
  for (const block of blocks ?? []) {
    const filingDate = portalDate(block.supfildt);
    for (const note of block.nt ?? []) {
      const date = portalDate(note.dt);
      if (!date) continue;
      const sums = sumItems(note.items ?? []);
      out.push({
        supplierGstin: block.ctin.toUpperCase(),
        supplierName: block.trdnm ?? null,
        docType: note.ntty === "D" ? "DBN" : "CRN",
        docNo: note.nt_num,
        docDate: date,
        docValue: n2(note.val),
        placeOfSupply: note.pos ?? null,
        reverseCharge: note.rev === "Y",
        ...sums,
        itcAvailable: note.itcavl !== "N",
        itcReason: note.rsn ?? null,
        filingPeriod: periodFromRtnprd(block.supprd),
        filingDate,
        raw: note,
      });
    }
  }
  return out;
};

/**
 * Every record in a 2B, flattened. Amendment blocks (`b2ba`, `cdnra`) are read alongside the
 * originals: the portal supersedes a document by re-filing it, and the later one wins on the
 * unique key, which is exactly what an amendment means.
 */
export const parse2b = (json: Gstr2bJson): ParsedRecord[] => {
  const data = docData(json);
  const records: ParsedRecord[] = [
    ...fromInvoices(data.b2b, "INV"),
    ...fromInvoices(data.b2ba, "INV"),
    ...fromInvoices(data.isd, "ISD"),
    ...fromNotes(data.cdnr),
    ...fromNotes(data.cdnra),
  ];
  for (const row of data.impg ?? []) {
    const date = portalDate(row.boedt);
    if (!date) continue;
    records.push({
      // An import has no supplier GSTIN; the bill of entry stands in for the party.
      supplierGstin: "URP",
      supplierName: row.portcode ? `Port ${row.portcode}` : "Import of goods",
      docType: "IMPG",
      docNo: row.boenum,
      docDate: date,
      docValue: n2(Number(row.txval) + Number(row.igst ?? 0) + Number(row.cess ?? 0)),
      placeOfSupply: null,
      reverseCharge: false,
      taxable: n2(row.txval),
      igst: n2(row.igst),
      cgst: 0,
      sgst: 0,
      cess: n2(row.cess),
      itcAvailable: true,
      itcReason: null,
      filingPeriod: null,
      filingDate: null,
      raw: row,
    });
  }
  return records;
};
