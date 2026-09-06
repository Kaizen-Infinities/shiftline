import { describe, expect, it } from "vitest";
import { parsePagination, parseBigIntId, MAX_PAGE_SIZE } from "../../src/utils/pagination";

describe("parsePagination", () => {
  it("applies defaults", () => {
    expect(parsePagination({})).toEqual({ page: 1, limit: 20, skip: 0, take: 20 });
  });
  it("coerces strings and computes skip", () => {
    expect(parsePagination({ page: "3", limit: "10" })).toEqual({
      page: 3,
      limit: 10,
      skip: 20,
      take: 10,
    });
  });
  it("rejects negative pages and oversized limits", () => {
    expect(() => parsePagination({ page: "-5", limit: "10" })).toThrow();
    expect(() => parsePagination({ page: "1", limit: String(MAX_PAGE_SIZE + 1) })).toThrow();
  });
});

describe("parseBigIntId", () => {
  it("parses numeric ids", () => {
    expect(parseBigIntId("42")).toBe(42n);
  });
  it("rejects non-numeric and out-of-range ids", () => {
    expect(() => parseBigIntId("abc")).toThrow(RangeError);
    expect(() => parseBigIntId("999999999999999999999")).toThrow(RangeError);
  });
});
