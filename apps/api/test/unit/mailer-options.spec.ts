import { describe, expect, it } from "vitest";
import { buildSmtpTransportOptions } from "../../src/utils/mailer";

const base = { host: "smtp.example.com", user: "u", pass: "p" };

describe("buildSmtpTransportOptions", () => {
  it("keeps 587 as STARTTLS", () => {
    const o = buildSmtpTransportOptions({ ...base, port: 587, encryption: "TLS" });
    expect(o.port).toBe(587);
    expect(o.secure).toBe(false);
  });
  it("uses implicit TLS on 465 or when encryption is SSL", () => {
    expect(buildSmtpTransportOptions({ ...base, port: 465 }).secure).toBe(true);
    expect(buildSmtpTransportOptions({ ...base, port: 2465, encryption: "SSL" }).secure).toBe(true);
  });
  it("never disables certificate validation", () => {
    const o = buildSmtpTransportOptions({ ...base, port: 587 });
    expect(JSON.stringify(o)).not.toContain("rejectUnauthorized");
  });
});
