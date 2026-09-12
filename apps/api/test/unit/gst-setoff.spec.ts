import { describe, expect, it } from "vitest";
import { setOff } from "../../src/modules/gst-returns/gstr3b.service";

/**
 * The set-off of GSTR-3B table 6.1 (P1-13b). Sections 49A and 49B: IGST credit is spent first
 * and may pay any head; CGST and SGST credit pay their own head and then IGST, never each
 * other; cess is ring-fenced. Reverse-charge liability never reaches here — it is always cash.
 */
type Pool = { igst: number; cgst: number; sgst: number; cess: number };
const pool = (p: Partial<Pool>): Pool => ({ igst: 0, cgst: 0, sgst: 0, cess: 0, ...p });
const cashTotal = (owed: Pool) => owed.igst + owed.cgst + owed.sgst + owed.cess;

describe("GSTR-3B credit set-off", () => {
  it("spends IGST credit on IGST first, then spills it into CGST and SGST", () => {
    const { owed, left, used } = setOff(
      pool({ igst: 100, cgst: 100, sgst: 100 }),
      pool({ igst: 300, cgst: 50, sgst: 50 })
    );
    expect(cashTotal(owed)).toBe(0);
    expect(used.IGST).toMatchObject({ igst: 100 });
    expect(used.CGST).toMatchObject({ igst: 100, cgst: 0 });
    expect(used.SGST).toMatchObject({ igst: 100, sgst: 0 });
    // Section 49A leaves the state credit untouched while IGST credit is still there.
    expect(left).toMatchObject({ igst: 0, cgst: 50, sgst: 50 });
  });

  it("never pays SGST with CGST credit, or CGST with SGST credit", () => {
    const { owed, left, used } = setOff(pool({ cgst: 100, sgst: 100 }), pool({ cgst: 250 }));
    expect(used.CGST).toMatchObject({ cgst: 100, sgst: 0 });
    expect(owed.sgst).toBe(100);
    expect(used.SGST).toMatchObject({ cgst: 0, sgst: 0 });
    expect(left.cgst).toBe(150);
  });

  it("lets CGST credit reach IGST once the IGST credit is gone, before SGST credit does", () => {
    const { owed, left, used } = setOff(
      pool({ igst: 500 }),
      pool({ igst: 100, cgst: 300, sgst: 300 })
    );
    expect(used.IGST).toMatchObject({ igst: 100, cgst: 300, sgst: 100 });
    expect(owed.igst).toBe(0);
    // The proviso to section 49(5)(c): the CGST credit goes first, so SGST credit survives.
    expect(left).toMatchObject({ cgst: 0, sgst: 200 });
  });

  it("ring-fences cess", () => {
    const { owed, used } = setOff(pool({ cess: 100, igst: 100 }), pool({ igst: 500, cess: 40 }));
    expect(used.CESS).toMatchObject({ cess: 40, igst: 0 });
    expect(owed.cess).toBe(60);
    expect(owed.igst).toBe(0);
  });

  it("leaves no cash when the credit covers everything, and carries the surplus", () => {
    const { owed, left } = setOff(pool({ igst: 50, cgst: 50, sgst: 50 }), pool({ igst: 200 }));
    expect(cashTotal(owed)).toBe(0);
    expect(left.igst).toBe(50);
  });

  it("puts the whole liability in cash when there is no credit", () => {
    const { owed, used } = setOff(pool({ igst: 10, cgst: 20, sgst: 20, cess: 5 }), pool({}));
    expect(cashTotal(owed)).toBe(55);
    expect(Object.values(used).every((u) => u.igst + u.cgst + u.sgst + u.cess === 0)).toBe(true);
  });

  it("keeps the arithmetic to paise", () => {
    const { owed } = setOff(pool({ cgst: 100.55, sgst: 100.55 }), pool({ cgst: 40.3, sgst: 40.3 }));
    expect(owed.cgst).toBe(60.25);
    expect(owed.sgst).toBe(60.25);
  });
});
