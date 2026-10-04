import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { generateDeliveryChallanHtml } from "../../src/templates/deliveryChallanTemplate";
import { generateEstimateHtml } from "../../src/templates/estimateTemplate";
import { generateInvoiceHtml } from "../../src/templates/invoiceTemplate";
import { generatePoInvoiceHtml } from "../../src/templates/poInvoiceTemplate";
import { generateQuotationHtml } from "../../src/templates/quotationTemplate";
import { renderStatementHtml } from "../../src/templates/statementTemplate";
import { generateWelcomeEmailHtml } from "../../src/templates/welcomeEmailTemplate";
import { escapeHtml, safeUrl } from "../../src/utils/escapeHtml";
import { closePdfBrowser, generatePdfFromHtml, openPdfContexts } from "../../src/utils/pdfGenerator";
import { logger } from "../../src/lib/logger";

/** API-01: stored HTML in tenant/user fields must reach the PDF renderer only as text. */
const MARKER =
  '<img src="https://assessment.invalid/marker.png"><script>globalThis.assessmentMarker=1</script>';
const ESCAPED = escapeHtml(MARKER);

const expectOnlyEscaped = (html: string) => {
  expect(html).toContain(ESCAPED);
  expect(html).not.toContain("<script>globalThis");
  expect(html).not.toContain('<img src="https://assessment.invalid');
  // No remote script or JS-dependent markup is left in the document at all.
  expect(html).not.toMatch(/<script[\s>]/i);
};

const company = {
  gstin: "27ABCDE1234F1Z5",
  legalName: MARKER,
  addressLine1: MARKER,
  city: "Palghar",
  state: "Maharashtra",
  pincode: "401404",
  bankName: MARKER,
};

describe("escapeHtml / safeUrl", () => {
  it("escapes the five characters and tolerates null, undefined and numbers", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(0)).toBe("0");
    expect(escapeHtml(12.5)).toBe("12.5");
  });

  it("allows only https and data:image URLs", () => {
    expect(safeUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(safeUrl("data:image/png;base64,iVBORw0KGgo=")).toContain("data:image/png");
    expect(safeUrl("http://example.com/x.png")).toBe("");
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(safeUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe("");
    expect(safeUrl('https://a.example/x" onerror="alert(1)')).toBe("");
    expect(safeUrl(null)).toBe("");
    expect(safeUrl("http://localhost:5173", { allowLocalHttp: true })).toBe("http://localhost:5173");
  });
});

describe("templates escape user-controlled data", () => {
  it("invoice", () => {
    const html = generateInvoiceHtml(
      {
        invoiceNo: MARKER,
        invoiceDate: "2026-04-05",
        notes: MARKER,
        customer: { displayName: MARKER, gstin: MARKER, addresses: [] },
        salesOrder: { orderNo: MARKER, transportName: MARKER },
        items: [{ description: MARKER, quantity: 1, unitPrice: 10, unit: MARKER }],
      },
      company,
      {
        eInvoice: {
          irn: MARKER,
          ackNo: MARKER,
          ackDate: MARKER,
          qrDataUrl: 'javascript:alert(1)"><script>x</script>',
          cancelled: false,
        },
      }
    );
    expectOnlyEscaped(html);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("cdn.tailwindcss.com");
  });

  it("invoice keeps a data:image QR code", () => {
    const qr = "data:image/png;base64,iVBORw0KGgo=";
    const html = generateInvoiceHtml(
      { invoiceNo: "I-1", items: [], customer: {} },
      company,
      { eInvoice: { irn: "x", ackNo: null, ackDate: null, qrDataUrl: qr, cancelled: false } }
    );
    expect(html).toContain(`<img src="${qr}"`);
  });

  it("purchase order", () => {
    const html = generatePoInvoiceHtml(
      {
        poNumber: MARKER,
        remarks: MARKER,
        billingAddressLine1: MARKER,
        billingState: "Maharashtra",
        items: [{ description: MARKER, quantity: 1, unitPrice: 10, tax: 18, uom: MARKER }],
      },
      company,
      { supplierName: MARKER, gstin: MARKER },
      { storeName: MARKER }
    );
    expectOnlyEscaped(html);
    expect(html).not.toContain("cdn.tailwindcss.com");
  });

  it("quotation", () => {
    const html = generateQuotationHtml(
      {
        orderNo: MARKER,
        customer: { displayName: MARKER, customerCode: MARKER },
        items: [{ product: { productName: MARKER }, quantity: 1, unitPrice: 5 }],
      },
      company
    );
    expect(html).toContain(escapeHtml(MARKER.toUpperCase()));
    expect(html).toContain(ESCAPED);
    expect(html).not.toContain("<script>globalThis");
    expect(html).not.toContain("<img src=");
  });

  it("estimate (no inline script; the grand-total line is bolded on the server)", () => {
    const html = generateEstimateHtml(
      {
        id: MARKER,
        orderNo: MARKER,
        customer: { displayName: MARKER },
        items: [{ product: { productName: MARKER }, quantity: 1, estimatedRate: 5 }],
      },
      { companyName: MARKER, addressLine1: MARKER, phone: MARKER, gstin: MARKER }
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("<img src=");
    expect(html).toContain("&lt;script&gt;globalThis");
    expect(html).toMatch(/<strong>\s*Grand Total/);
  });

  it("delivery challan", () => {
    const html = generateDeliveryChallanHtml({
      challanNo: MARKER,
      challanDate: "2026-04-05",
      kind: "OTHER",
      purpose: MARKER,
      returnDueDate: null,
      capitalGoods: false,
      taxable: 10,
      igst: 0,
      cgst: 0,
      sgst: 0,
      totalValue: 10,
      transporterName: MARKER,
      vehicleNumber: MARKER,
      remarks: MARKER,
      items: [
        { description: MARKER, hsnCode: null, uom: null, quantitySent: 1, rate: 10, taxableAmount: 10 },
      ],
      company: { name: MARKER, address: MARKER },
      consignee: { name: MARKER, address: MARKER },
    });
    expectOnlyEscaped(html);
  });

  it("statement of account", () => {
    const html = renderStatementHtml({
      startDate: null,
      endDate: "2026-04-05",
      party: { type: "customer", name: MARKER, code: MARKER, address: MARKER },
      company: { name: MARKER, address: MARKER },
      openingBalance: 0,
      closingBalance: 0,
      entries: [
        {
          date: "2026-04-01",
          voucherNo: MARKER,
          voucherType: MARKER,
          particulars: MARKER,
          narration: MARKER,
          debit: 1,
          credit: 0,
          runningBalance: 1,
        },
      ],
      ageing: null,
    } as any);
    expectOnlyEscaped(html);
  });

  it("welcome email", () => {
    const html = generateWelcomeEmailHtml({
      fullName: MARKER,
      empCode: MARKER,
      username: MARKER,
      password: MARKER,
      title: MARKER,
      subtitle: MARKER,
      teamName: MARKER,
      portalUrl: 'javascript:alert(1)"><script>x</script>',
    });
    expectOnlyEscaped(html);
    expect(html).not.toContain("javascript:");
  });
});

/** Real Chromium; skipped when it cannot start (for example a CI image without it). */
let chromiumOk = false;
beforeAll(async () => {
  try {
    const pdf = await generatePdfFromHtml("<p>probe</p>");
    chromiumOk = pdf.subarray(0, 4).toString() === "%PDF";
  } catch {
    chromiumOk = false;
  }
}, 60_000);
afterAll(async () => {
  await closePdfBrowser();
});

describe("pdf renderer", () => {
  it("renders the marker invoice to a PDF without any outbound request", async (ctx) => {
    if (!chromiumOk) return ctx.skip();
    const warn = vi.spyOn(logger, "warn");
    const html = generateInvoiceHtml(
      {
        invoiceNo: "I-1",
        notes: MARKER,
        customer: { displayName: MARKER, addresses: [] },
        items: [{ description: MARKER, quantity: 1, unitPrice: 10 }],
      },
      company
    );
    const pdf = await generatePdfFromHtml(html);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    // The marker is text now, so the browser never tried to reach assessment.invalid.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  }, 60_000);

  it("blocks requests and script even in hostile raw HTML", async (ctx) => {
    if (!chromiumOk) return ctx.skip();
    const warn = vi.spyOn(logger, "warn");
    const raw = `<html><body>${MARKER}<script>fetch("https://assessment.invalid/from-script")</script></body></html>`;
    const pdf = await generatePdfFromHtml(raw);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    // Exactly one blocked request (the <img>); the script did not run, so no fetch followed it.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({ host: "assessment.invalid" });
    warn.mockRestore();
  }, 60_000);

  it("does not leak pages or contexts across renders", async (ctx) => {
    if (!chromiumOk) return ctx.skip();
    await Promise.all([1, 2, 3].map(() => generatePdfFromHtml("<p>x</p>")));
    // Every render closes its own context; only the shared browser stays up.
    expect(await openPdfContexts()).toBe(0);
  }, 60_000);
});
