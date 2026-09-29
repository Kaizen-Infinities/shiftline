import { describe, expect, it } from "vitest";

import {
  allocateToSchedule,
  buildLabels,
  canTransition,
  normaliseVehicleNo,
  packsFor,
  qrPayload,
  splitPacks,
} from "../../src/modules/asn/asn.calc";
import { csvCell, renderCsv } from "../../src/modules/asn/providers/generic-csv.provider";
import { exportProviderFor, EXPORT_PROVIDERS } from "../../src/modules/asn/providers";

describe("ASN pack splitting (TN-07)", () => {
  it("fills full packs and puts the remainder in a last part pack", () => {
    expect(splitPacks(250, 100)).toEqual([100, 100, 50]);
    expect(packsFor(250, 100)).toBe(3);
  });

  it("an exact multiple has no part pack", () => {
    expect(splitPacks(300, 100)).toEqual([100, 100, 100]);
    expect(packsFor(300, 100)).toBe(3);
  });

  it("a quantity below one pack is a single part pack", () => {
    expect(splitPacks(40, 100)).toEqual([40]);
    expect(packsFor(40, 100)).toBe(1);
  });

  it("handles 3-decimal quantities without floating-point drift", () => {
    expect(splitPacks(0.3, 0.1)).toEqual([0.1, 0.1, 0.1]);
    expect(splitPacks(12.5, 2.5)).toHaveLength(5);
    expect(splitPacks(10.001, 5)).toEqual([5, 5, 0.001]);
  });

  it("zero or negative inputs give no packs", () => {
    expect(splitPacks(0, 10)).toEqual([]);
    expect(splitPacks(10, 0)).toEqual([]);
    expect(packsFor(-1, 10)).toBe(0);
  });
});

describe("ASN labels", () => {
  it("numbers packs across the whole ASN and encodes asnNo|partNo|qty|packSeq", () => {
    const labels = buildLabels("ASN-1", [
      { seq: 2, customerPartNo: "B-2", description: null, qty: 30, packQty: 20 },
      { seq: 1, customerPartNo: "A-1", description: "Bracket", qty: 250, packQty: 100 },
    ]);
    expect(labels.map((l) => [l.customerPartNo, l.qty, l.packSeq])).toEqual([
      ["A-1", 100, 1],
      ["A-1", 100, 2],
      ["A-1", 50, 3],
      ["B-2", 20, 4],
      ["B-2", 10, 5],
    ]);
    expect(labels.every((l) => l.totalPacks === 5)).toBe(true);
    expect(labels[2]).toMatchObject({ linePack: 3, linePacks: 3, qr: "ASN-1|A-1|50|3" });
    expect(labels[4]).toMatchObject({ lineSeq: 2, linePack: 2, linePacks: 2 });
  });

  it("strips the separator from values in the QR payload", () => {
    expect(qrPayload("A|1", "P|2", 5, 1)).toBe("A/1|P/2|5|1");
  });
});

describe("allocating an invoice quantity to schedule lines", () => {
  const open = [
    { id: "a", remaining: 100 },
    { id: "b", remaining: 0 },
    { id: "c", remaining: 200 },
  ];

  it("fills the earliest lines first and skips lines with nothing owed", () => {
    expect(allocateToSchedule(250, open)).toEqual([
      { scheduleLineId: "a", qty: 100 },
      { scheduleLineId: "c", qty: 150 },
    ]);
  });

  it("returns an over-shipment unlinked", () => {
    expect(allocateToSchedule(350, open)).toEqual([
      { scheduleLineId: "a", qty: 100 },
      { scheduleLineId: "c", qty: 200 },
      { scheduleLineId: null, qty: 50 },
    ]);
  });

  it("no open lines means one unlinked allocation", () => {
    expect(allocateToSchedule(10, [])).toEqual([{ scheduleLineId: null, qty: 10 }]);
  });
});

describe("ASN status and vehicle number", () => {
  it("allows only forward moves", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(true);
    expect(canTransition("SENT", "ACKNOWLEDGED")).toBe(true);
    expect(canTransition("SENT", "CANCELLED")).toBe(true);
    expect(canTransition("DRAFT", "ACKNOWLEDGED")).toBe(false);
    expect(canTransition("ACKNOWLEDGED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "SENT")).toBe(false);
  });

  it("normalises a vehicle number", () => {
    expect(normaliseVehicleNo("tn 09 ab-1234")).toBe("TN09AB1234");
  });
});

describe("ASN export providers", () => {
  const doc = {
    asnNo: "ASN-9",
    status: "SENT",
    dispatchAt: new Date("2026-09-27T04:30:00Z"),
    supplier: { name: "Acme, Pressings", gstin: "33AAAAA0000A1Z5" },
    customer: { name: "OEM", gstin: null, code: "C1" },
    invoiceNo: "INV/1",
    invoiceDate: "2026-09-27",
    vehicleNo: "TN09AB1234",
    transporterName: null,
    lrNo: null,
    lrDate: null,
    lines: [
      {
        seq: 1,
        customerPartNo: "=CMD()",
        description: 'Bracket "L"',
        itemCode: "P1",
        hsnCode: "8708",
        uom: "NOS",
        qty: 250,
        packQty: 100,
        packs: 3,
        scheduleNo: "SCH-1",
        scheduleDueDate: "2026-09-30",
      },
    ],
  };

  it("renders one CSV row per line with the India dispatch time and safe cells", () => {
    const csv = renderCsv(doc);
    const [head, row] = csv
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(head.startsWith("ASN No,ASN Status,Dispatch Date,Dispatch Time")).toBe(true);
    expect(row).toContain("ASN-9,SENT,2026-09-27,10:00");
    expect(row).toContain('"Acme, Pressings"');
    expect(row).toContain("'=CMD()");
    expect(row).toContain('"Bracket ""L"""');
    expect(csvCell("-5")).toBe("'-5");
  });

  it("lists the OEM formats as unavailable adapters that refuse with 501", () => {
    expect(exportProviderFor("GENERIC_CSV").available).toBe(true);
    const todo = EXPORT_PROVIDERS.filter((p) => !p.available);
    expect(todo.length).toBeGreaterThan(0);
    expect(() => todo[0].render(doc)).toThrow(expect.objectContaining({ statusCode: 501 }));
    expect(() => exportProviderFor("NOPE")).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});
