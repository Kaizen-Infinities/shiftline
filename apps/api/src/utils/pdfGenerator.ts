import puppeteer, { type Browser } from "puppeteer";
import { logger } from "../lib/logger";

export interface PdfOptions {
  /** A4 landscape instead of the default portrait — for a table too wide to read in portrait
   *  (P2-16), e.g. a 31-day muster roll. */
  landscape?: boolean;
  /** A custom page size instead of A4 (TN-07 packing labels: `{ width: "100mm", height: "150mm" }`). */
  page?: { width: string; height: string };
  /** Page margin on every side; defaults to 20px. */
  margin?: string;
}

/**
 * Hosts a rendered document may load sub-resources from. Empty on purpose: every template inlines
 * its CSS and images (logos and QR codes are data: URIs), so nothing needs the network. Add a
 * host here only for a specific, reviewed need; entries are matched on the exact hostname and
 * https only.
 */
export const PDF_ALLOWED_HOSTS: readonly string[] = [];

const SET_CONTENT_TIMEOUT_MS = 15_000;
const PDF_TIMEOUT_MS = 30_000;

const isAllowedRequest = (url: string): boolean => {
  if (url.startsWith("data:") || url === "about:blank") return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PDF_ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

// One Chromium process is shared by every render; each render gets its own isolated browser
// context (and page) that is always closed, so nothing leaks between tenants or requests.
let browserPromise: Promise<Browser> | null = null;

const getBrowser = (): Promise<Browser> => {
  if (!browserPromise) {
    const launched = puppeteer.launch({
      headless: true,
      // --no-sandbox is required here: the API runs as root inside a container (docker compose
      // and the kind pod), where Chromium's user-namespace sandbox cannot start. The renderer is
      // instead confined by disabling JavaScript and blocking every network request below.
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    browserPromise = launched;
    launched
      .then((b) => {
        b.on("disconnected", () => {
          if (browserPromise === launched) browserPromise = null;
        });
      })
      .catch((err) => {
        if (browserPromise === launched) browserPromise = null;
        logger.error({ err }, "pdf renderer failed to launch");
      });
  }
  return browserPromise;
};

/** Closes the shared browser (graceful shutdown, tests). The next render starts a new one. */
export const closePdfBrowser = async (): Promise<void> => {
  const current = browserPromise;
  browserPromise = null;
  if (current) await (await current.catch(() => null))?.close().catch(() => undefined);
};

/** Number of render contexts still open (0 when idle); used by tests to catch leaks. */
export const openPdfContexts = async (): Promise<number> => {
  if (!browserPromise) return 0;
  const b = await browserPromise;
  return b.browserContexts().filter((c) => c !== b.defaultBrowserContext()).length;
};

export const generatePdfFromHtml = async (
  htmlContent: string,
  options: PdfOptions = {}
): Promise<Buffer> => {
  const browser = await getBrowser();
  const context = await browser.createBrowserContext();

  try {
    const page = await context.newPage();

    // Documents are static: no script may run, and nothing may be fetched.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (isAllowedRequest(req.url())) {
        void req.continue();
      } else {
        logger.warn({ host: safeHost(req.url()) }, "pdf renderer blocked an outbound request");
        void req.abort("blockedbyclient");
      }
    });

    await page.setContent(htmlContent, {
      waitUntil: "load",
      timeout: SET_CONTENT_TIMEOUT_MS,
    });

    const m = options.margin ?? "20px";
    const pdfBuffer = await page.pdf({
      ...(options.page
        ? { width: options.page.width, height: options.page.height }
        : { format: "A4" as const }),
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: { top: m, right: m, bottom: m, left: m },
      timeout: PDF_TIMEOUT_MS,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    // Closing the context closes every page in it, including after a timeout or error.
    await context.close().catch(() => undefined);
  }
};

const safeHost = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid";
  }
};
