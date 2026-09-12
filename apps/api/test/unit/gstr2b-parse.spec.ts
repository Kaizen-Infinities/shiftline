import { describe, expect, it } from "vitest";
import {
  envelopeOf,
  normaliseDocNo,
  parse2b,
  periodFromRtnprd,
  portalDate,
} from "../../src/modules/gst-returns/gstr2b.parse";

/**
 * Reading the portal's GSTR-2B (P1-13c). The number normalisation matters most: the same
 * document is typed by two different people into two different systems, and the reconciliation
 * is worthless if `INV/001` and `inv-1` are treated as different bills.
 */
describe("GSTR-2B document numbers", () => {
  it("ignores case, separators and the zeros padding the serial", () => {
    const same = ["INV/001", "inv-1", "INV 0001", "Inv_001", "inv.1"];
    const normalised = new Set(same.map(normaliseDocNo));
    expect(normalised.size).toBe(1);
    expect([...normalised][0]).toBe("INV1");
  });

  it("keeps a prefix that actually distinguishes two documents", () => {
    expect(normaliseDocNo("A/1")).not.toBe(normaliseDocNo("B/1"));
    expect(normaliseDocNo("2026/INV/1")).toBe("2026INV1");
  });

  it("does not collapse numbers that differ", () => {
    expect(normaliseDocNo("INV/10")).not.toBe(normaliseDocNo("INV/1"));
    // Only the zeros padding the trailing digits go, never a zero inside the number.
    expect(normaliseDocNo("INV/101")).toBe("INV101");
  });
});

describe("GSTR-2B dates and periods", () => {
  it("reads the portal's dd-mm-yyyy", () => {
    expect(portalDate("05-07-2026")?.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(portalDate(null)).toBeNull();
    expect(portalDate("nonsense")).toBeNull();
  });
  it("turns a return period into a month key", () => {
    expect(periodFromRtnprd("082026")).toBe("2026-08");
    expect(periodFromRtnprd("")).toBeNull();
  });
});

describe("GSTR-2B parsing", () => {
  const json = {
    data: {
      gstin: "33AAAAA0000A1Z9",
      rtnprd: "082026",
      docdata: {
        b2b: [
          {
            ctin: "27aapfu0939f1zv",
            trdnm: "Western Supplies",
            supprd: "072026",
            supfildt: "11-08-2026",
            inv: [
              {
                inum: "WS/2026/41",
                typ: "R",
                dt: "05-07-2026",
                val: 11800,
                pos: "33",
                rev: "N",
                itcavl: "Y",
                items: [{ num: 1, rt: 18, txval: 10000, igst: 1800, cess: 0 }],
              },
              {
                inum: "WS/2026/42",
                dt: "09-07-2026",
                val: 2360,
                itcavl: "N",
                rsn: "POS and supplier state are the same",
                items: [{ rt: 18, txval: 2000, igst: 360 }],
              },
            ],
          },
        ],
        cdnr: [
          {
            ctin: "27AAPFU0939F1ZV",
            nt: [
              {
                nt_num: "CN/7",
                ntty: "C",
                dt: "20-07-2026",
                val: 1180,
                items: [{ rt: 18, txval: 1000, igst: 180 }],
              },
            ],
          },
        ],
        impg: [
          { boenum: "7654321", boedt: "14-07-2026", portcode: "INMAA1", txval: 50000, igst: 9000 },
        ],
      },
    },
  };

  it("reads the envelope", () => {
    expect(envelopeOf(json)).toEqual({ gstin: "33AAAAA0000A1Z9", periodKey: "2026-08" });
  });

  it("flattens invoices, notes and imports into one row each", () => {
    const rows = parse2b(json);
    expect(rows).toHaveLength(4);

    const inv = rows.find((r) => r.docNo === "WS/2026/41")!;
    expect(inv).toMatchObject({
      supplierGstin: "27AAPFU0939F1ZV", // upper-cased for matching
      supplierName: "Western Supplies",
      docType: "INV",
      docValue: 11800,
      taxable: 10000,
      igst: 1800,
      itcAvailable: true,
      filingPeriod: "2026-07",
    });
    expect(inv.docDate.toISOString().slice(0, 10)).toBe("2026-07-05");
    expect(inv.filingDate?.toISOString().slice(0, 10)).toBe("2026-08-11");

    // The portal's own refusal travels with the record, reason and all.
    const blocked = rows.find((r) => r.docNo === "WS/2026/42")!;
    expect(blocked.itcAvailable).toBe(false);
    expect(blocked.itcReason).toBe("POS and supplier state are the same");

    const note = rows.find((r) => r.docNo === "CN/7")!;
    expect(note.docType).toBe("CRN");

    const importRow = rows.find((r) => r.docType === "IMPG")!;
    expect(importRow).toMatchObject({ supplierGstin: "URP", taxable: 50000, igst: 9000 });
    expect(importRow.docValue).toBe(59000);
  });

  it("refuses a file that is not a 2B", () => {
    expect(() => parse2b({ data: { gstin: "x" } })).toThrow(/not a GSTR-2B/);
  });

  it("reads a file exported without the data envelope", () => {
    const flat = { gstin: "33AAAAA0000A1Z9", rtnprd: "082026", docdata: json.data.docdata };
    expect(parse2b(flat)).toHaveLength(4);
    expect(envelopeOf(flat).periodKey).toBe("2026-08");
  });
});
