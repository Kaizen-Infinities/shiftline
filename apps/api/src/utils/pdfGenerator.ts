import puppeteer from "puppeteer";

export interface PdfOptions {
  /** A4 landscape instead of the default portrait — for a table too wide to read in portrait
   *  (P2-16), e.g. a 31-day muster roll. */
  landscape?: boolean;
  /** A custom page size instead of A4 (TN-07 packing labels: `{ width: "100mm", height: "150mm" }`). */
  page?: { width: string; height: string };
  /** Page margin on every side; defaults to 20px. */
  margin?: string;
}

export const generatePdfFromHtml = async (
  htmlContent: string,
  options: PdfOptions = {}
): Promise<Buffer> => {
  // Launch headless browser
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // Set HTML content
    await page.setContent(htmlContent, { waitUntil: "domcontentloaded" });

    // Generate PDF
    const m = options.margin ?? "20px";
    const pdfBuffer = await page.pdf({
      ...(options.page
        ? { width: options.page.width, height: options.page.height }
        : { format: "A4" as const }),
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: { top: m, right: m, bottom: m, left: m },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
};
