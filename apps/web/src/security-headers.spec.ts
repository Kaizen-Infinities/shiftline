import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * R2H-B16: the web origin sends the baseline headers, and index.html has no inline script so a
 * strict script-src 'self' policy can be enforced without a hash.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("web security headers", () => {
  it("production nginx sends nosniff, frame denial and a content security policy", () => {
    const nginx = read("../../../docker/nginx/default.conf");
    expect(nginx).toMatch(/X-Content-Type-Options nosniff/);
    expect(nginx).toMatch(/X-Frame-Options DENY/);
    const csp = nginx.match(/Content-Security-Policy-Report-Only "([^"]+)"/)?.[1] ?? "";
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/script-src 'self'(;|$)/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
  });

  it("dev and preview servers send the same baseline headers", () => {
    const config = read("../vite.config.ts");
    expect(config).toMatch(/'X-Frame-Options': 'DENY'/);
    expect(config).toMatch(/'X-Content-Type-Options': 'nosniff'/);
    expect(config).toMatch(/preview:\s*{\s*headers: securityHeaders/);
  });

  it("index.html has no inline script", () => {
    const html = read("../index.html");
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).toMatch(/<script src="\/theme-init.js"><\/script>/);
  });
});
