import { describe, expect, it } from "vitest";

import {
  TemplateError,
  gsm7Length,
  isGsm7,
  maskCode,
  normaliseMobile,
  renderTemplate,
  segmentsFor,
  variablesIn,
} from "../../src/modules/sms/sms.calc";

/**
 * The rules a telecom operator enforces silently (P1-22). Each of these is tested against the
 * rule rather than the code, because a message that breaks one is not rejected — it is simply
 * never delivered.
 */
describe("mobile numbers", () => {
  it("reduces every form a number is typed in to ten digits", () => {
    expect(normaliseMobile("9876543210")).toBe("9876543210");
    expect(normaliseMobile("+91 98765 43210")).toBe("9876543210");
    expect(normaliseMobile("09876543210")).toBe("9876543210");
    expect(normaliseMobile("91-9876543210")).toBe("9876543210");
    expect(normaliseMobile("0091 9876543210")).toBe("9876543210");
  });

  it("refuses anything that is not one rather than guessing", () => {
    // Indian mobile numbers start at 6; a landline or a typo is not a mobile.
    expect(normaliseMobile("1234567890")).toBeNull();
    expect(normaliseMobile("98765")).toBeNull();
    expect(normaliseMobile("98765432100")).toBeNull();
    expect(normaliseMobile("")).toBeNull();
    expect(normaliseMobile(null)).toBeNull();
  });
});

describe("segments", () => {
  it("counts a plain message on the GSM-7 rules", () => {
    expect(segmentsFor("A".repeat(160))).toEqual({
      encoding: "GSM7",
      characters: 160,
      segments: 1,
    });
    // One character more and the whole message is split, each part losing room to the header.
    expect(segmentsFor("A".repeat(161)).segments).toBe(2);
    expect(segmentsFor("A".repeat(306)).segments).toBe(2);
    expect(segmentsFor("A".repeat(307)).segments).toBe(3);
  });

  it("counts the extended characters twice, as the operator does", () => {
    expect(gsm7Length("{}")).toBe(4);
    expect(isGsm7("Rs 500 due {today}")).toBe(true);
    // 158 plain characters plus a brace pair is 162: over the single-part limit.
    expect(segmentsFor(`${"A".repeat(158)}{}`).segments).toBe(2);
  });

  it("falls to UCS-2 on one stray character, and the message more than halves", () => {
    const curly = `${"A".repeat(70)}’`;
    const seg = segmentsFor(curly);
    expect(seg.encoding).toBe("UCS2");
    // Seventy-one Unicode characters is two parts; the same seventy-one in GSM-7 is one.
    expect(seg.segments).toBe(2);
    expect(segmentsFor("A".repeat(71)).segments).toBe(1);
  });

  it("treats an empty body as one part rather than none", () => {
    expect(segmentsFor("").segments).toBe(1);
  });
});

describe("templates", () => {
  const body = "Dear {{name}}, Rs {{amount}} is due against invoice {{invoiceNo}}.";

  it("reads its variables in the order the body uses them", () => {
    expect(variablesIn(body)).toEqual(["name", "amount", "invoiceNo"]);
    // A variable used twice is one variable.
    expect(variablesIn("{{a}} and {{a}} and {{b}}")).toEqual(["a", "b"]);
  });

  it("fills in what it is given", () => {
    expect(renderTemplate(body, { name: "Anand", amount: 1500, invoiceNo: "INV/1" })).toBe(
      "Dear Anand, Rs 1500 is due against invoice INV/1."
    );
  });

  it("refuses a missing variable rather than sending the placeholder to a customer", () => {
    expect(() => renderTemplate(body, { name: "Anand", amount: 1500 })).toThrow(TemplateError);
    // Blank is missing too: "Dear , Rs 1500 is due" is not a message anybody should receive.
    expect(() => renderTemplate(body, { name: "  ", amount: 1500, invoiceNo: "INV/1" })).toThrow(
      /name/
    );
  });

  it("refuses a link or a line break inside a variable", () => {
    // This is how a registered template gets used to send something it was never registered
    // for, and it is why operators drop messages.
    expect(() => renderTemplate("Pay at {{link}}", { link: "http://evil.example/steal" })).toThrow(
      /link or a line break/
    );
    expect(() => renderTemplate("Hi {{name}}", { name: "A\nB" })).toThrow(TemplateError);
  });
});

describe("masking", () => {
  it("keeps the last two digits and nothing else", () => {
    expect(maskCode("123456")).toBe("****56");
  });
});

describe("the SMS provider seam", () => {
  it("refuses a transactional message with no registered template", async () => {
    const { FixtureSmsProvider } = await import("../../src/modules/sms/providers/fixture.provider");
    const { SmsProviderError } = await import("../../src/modules/sms/sms.types");
    const gateway = new FixtureSmsProvider();
    const creds = { authKey: "k", senderId: "SHFTLN", principalEntityId: "1" };
    await expect(
      gateway.send(
        { to: "9876543210", body: "Hi", dltTemplateId: null, category: "TRANSACTIONAL" },
        creds
      )
    ).rejects.toThrow(SmsProviderError);
    // With the id, it goes.
    const sent = await gateway.send(
      { to: "9876543210", body: "Hi", dltTemplateId: "1101700000001", category: "TRANSACTIONAL" },
      creds
    );
    expect(sent.status).toBe("SENT");
    expect(gateway.sent).toHaveLength(1);
  });

  it("refuses a promotional message to a number on the do-not-disturb registry", async () => {
    const { FixtureSmsProvider } = await import("../../src/modules/sms/providers/fixture.provider");
    const gateway = new FixtureSmsProvider();
    await expect(
      gateway.send(
        { to: "9000000001", body: "Offer", dltTemplateId: null, category: "PROMOTIONAL" },
        { authKey: "k", senderId: "SHFTLN", principalEntityId: "1" }
      )
    ).rejects.toThrow(/do-not-disturb/);
  });

  it("refuses the live adapter rather than pretending to have one", async () => {
    const { smsProviderFor } = await import("../../src/modules/sms/providers");
    const msg91 = smsProviderFor("MSG91");
    expect(msg91.name).toBe("MSG91");
    expect(() =>
      msg91.send(
        { to: "9876543210", body: "Hi", dltTemplateId: "1", category: "TRANSACTIONAL" },
        { authKey: "k", senderId: "SHFTLN", principalEntityId: "1" }
      )
    ).toThrow(/not built yet/);
    expect(smsProviderFor("ANYTHING-ELSE").name).toBe("FIXTURE");
  });
});
