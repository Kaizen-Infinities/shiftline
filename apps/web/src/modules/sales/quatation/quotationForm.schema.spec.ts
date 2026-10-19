import { describe, expect, it } from "vitest";
import { blockingFieldMessages, quotationSchema } from "./quotationForm.schema";

const draft = {
  quotationNo: "QT-2026-001",
  quotationDate: "2026-10-19",
  customerId: "7",
  sameAsBilling: false,
  isInterState: false,
  items: [{ salesProductId: "3", orderQuantity: "1", components: [] }],
  orderDiscountType: "PERCENT",
  orderDiscountValue: "",
};

describe("quotationSchema", () => {
  it("accepts a draft that carries a quotation number, customer, date and one item", () => {
    expect(quotationSchema.safeParse(draft).success).toBe(true);
  });

  it("rejects a draft with no quotation number, which is what blocked Save before the number was fetched", () => {
    const result = quotationSchema.safeParse({ ...draft, quotationNo: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => [i.path.join("."), i.message])).toEqual([
        ["quotationNo", "Quotation No is required"],
      ]);
    }
  });
});

describe("blockingFieldMessages", () => {
  it("returns nothing when there are no errors", () => {
    expect(blockingFieldMessages({})).toEqual([]);
  });

  it("names top-level blocking fields and numbers item-row errors by row", () => {
    const errors = {
      quotationNo: { type: "too_small", message: "Quotation No is required" },
      customerId: { type: "too_small", message: "Customer is required" },
      items: [
        {
          salesProductId: { type: "too_small", message: "Sales product is required" },
          orderQuantity: { type: "too_small", message: "Quantity is required" },
        },
        undefined,
        { orderQuantity: { type: "too_small", message: "Quantity is required" } },
      ],
    };
    expect(blockingFieldMessages(errors)).toEqual([
      "Quotation No is required",
      "Customer is required",
      "Item 1: Sales product is required",
      "Item 1: Quantity is required",
      "Item 3: Quantity is required",
    ]);
  });

  it("reports an array-level error such as no items at all", () => {
    const errors = {
      items: { type: "too_small", message: "At least one sales product is required" },
    };
    expect(blockingFieldMessages(errors)).toEqual(["At least one sales product is required"]);
  });

  it("skips react-hook-form ref handles so the walk stays shallow", () => {
    const element = {} as Record<string, unknown>;
    element.self = element; // a cycle that would recurse forever if walked
    const errors = {
      quotationNo: { type: "too_small", message: "Quotation No is required", ref: element },
    };
    expect(blockingFieldMessages(errors)).toEqual(["Quotation No is required"]);
  });
});
