import { describe, expect, it } from "vitest";

import { inr } from "./components/dashboardFormat";
import { inrCompact } from "./tv/tvFormat";

/**
 * The dashboard tiles and the TV board read the same cash and bank balances. They must show the
 * same sign: an overdrawn account is a minus on both, never a plain positive amount on one.
 */
describe("money formats keep the sign", () => {
  it("dashboard tiles show an overdrawn balance as negative", () => {
    expect(inr(1454640)).toBe("₹14,54,640");
    expect(inr(-1454640)).toBe("-₹14,54,640");
    expect(inr(0)).toBe("₹0");
    expect(inr(null)).toBe("₹0");
    expect(inr(-0.2)).toBe("₹0"); // rounds to zero: no "-₹0"
  });

  it("TV board puts the minus before the rupee sign, in lakh and crore too", () => {
    expect(inrCompact(-7819000)).toBe("-₹78.19L");
    expect(inrCompact(7819000)).toBe("₹78.19L");
    expect(inrCompact(-12500000)).toBe("-₹1.25Cr");
    expect(inrCompact(-4500)).toBe("-₹4,500");
    expect(inrCompact(-12)).toBe("-₹12");
    expect(inrCompact(undefined)).toBe("₹0");
  });

  it("the two agree on the same figure", () => {
    const total = -(1454640 + 6364360);
    expect(inr(total).startsWith("-")).toBe(true);
    expect(inrCompact(total).startsWith("-")).toBe(true);
  });
});
