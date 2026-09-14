import puppeteer from 'puppeteer';

export interface PdfOptions {
    /** A4 landscape instead of the default portrait — for a table too wide to read in portrait
     *  (P2-16), e.g. a 31-day muster roll. */
    landscape?: boolean;
}

export const generatePdfFromHtml = async (htmlContent: string, options: PdfOptions = {}): Promise<Buffer> => {
    // Launch headless browser
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Set HTML content
        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });

        // Generate PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: options.landscape ?? false,
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            }
        });

        return Buffer.from(pdfBuffer);
    } finally {
        await browser.close();
    }
};
