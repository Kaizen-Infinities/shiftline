import { describe, expect, it } from "vitest";
import { toCsv } from "./trialBalanceCsv";

describe("trial balance CSV", () => {
  it("keeps amounts as raw numbers and quotes text so columns do not split", () => {
    const csv = toCsv([
      ["Account", "Debit"],
      ['Sharma, "Traders" & Co', 1234567.5],
    ]);
    expect(csv).toBe('"Account","Debit"\r\n"Sharma, ""Traders"" & Co",1234567.50');
  });
});
