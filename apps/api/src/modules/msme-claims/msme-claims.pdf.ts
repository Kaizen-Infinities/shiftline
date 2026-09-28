import { generatePdfFromHtml } from "../../utils/pdfGenerator";
import { DAYS_WITHOUT_AGREEMENT, INTEREST_MULTIPLE, MAX_AGREED_DAYS } from "./msme-claim.calc";
import type { msmeClaimsService } from "./msme-claims.service";

/**
 * Claim statement (TN-05), laid out in the order the MSME Samadhaan application (and an MSEFC
 * reference under section 18) asks for it: the supplier, the buyer, the invoices with their
 * acceptance and due dates, the amount due, the section 16 interest and a declaration.
 */
type StatementData = Awaited<ReturnType<typeof msmeClaimsService.statementData>>;

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dmy = (isoDate: string | null) => {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
};

const FORUM_LABEL: Record<string, string> = {
  SAMADHAAN: "MSME Samadhaan (Delayed Payment Monitoring System)",
  MSEFC: "Micro and Small Enterprises Facilitation Council (section 18)",
  DIRECT: "Direct demand on the buyer",
};

const CATEGORY_LABEL: Record<string, string> = {
  MICRO: "Micro",
  SMALL: "Small",
  MEDIUM: "Medium",
};

export const renderClaimHtml = (data: StatementData): string => {
  const { claim, supplier, buyer } = data;
  const rows = claim.lines
    .map(
      (l, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="nw">${esc(l.invoiceNo)}</td>
        <td class="c">${dmy(l.invoiceDate)}</td>
        <td class="c">${dmy(l.acceptedOn)}</td>
        <td class="c">${l.limitDays}</td>
        <td class="c">${dmy(l.dueDate)}</td>
        <td class="r">${inr(l.invoiceAmount)}</td>
        <td class="r">${inr(l.paidAmount)}</td>
        <td class="r">${inr(l.principalOutstanding)}</td>
        <td class="c">${l.daysLate}</td>
        <td class="r">${inr(l.interest)}</td>
      </tr>`
    )
    .join("");
  const invoiceTotal = claim.lines.reduce((s, l) => s + l.invoiceAmount, 0);
  const paidTotal = claim.lines.reduce((s, l) => s + l.paidAmount, 0);

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Claim ${esc(claim.claimNo)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5px; color: #0f172a; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 12px; margin: 14px 0 6px; border-bottom: 1px solid #94a3b8; padding-bottom: 3px; }
  .sub { color: #475569; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 5px; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; text-align: left; }
  .kv td:first-child { width: 34%; color: #475569; }
  .grid { display: flex; gap: 12px; }
  .grid > div { flex: 1; }
  .r { text-align: right; white-space: nowrap; }
  .c { text-align: center; white-space: nowrap; }
  .nw { white-space: nowrap; }
  tfoot td { font-weight: 700; background: #f8fafc; }
  .totals td { font-size: 11.5px; }
  .note { color: #475569; font-size: 9.5px; margin-top: 6px; }
  .sign { margin-top: 28px; display: flex; justify-content: space-between; }
</style></head>
<body>
  <h1>Statement of claim for delayed payment</h1>
  <p class="sub">Under sections 15, 16 and 17 of the Micro, Small and Medium Enterprises
  Development Act, 2006 · Claim ${esc(claim.claimNo)} · Forum: ${esc(FORUM_LABEL[claim.forum] ?? claim.forum)}
  ${claim.referenceNo ? ` · Reference ${esc(claim.referenceNo)}` : ""}</p>

  <div class="grid">
    <div>
      <h2>A. Supplier (applicant)</h2>
      <table class="kv">
        <tr><td>Name of the enterprise</td><td>${esc(supplier.name)}</td></tr>
        <tr><td>Udyam registration no.</td><td>${esc(supplier.udyamNumber ?? "Not on file")}</td></tr>
        <tr><td>Category</td><td>${esc(supplier.enterpriseCategory ? CATEGORY_LABEL[supplier.enterpriseCategory] : "—")}</td></tr>
        <tr><td>GSTIN / PAN</td><td>${esc(supplier.gstin ?? "—")} / ${esc(supplier.pan ?? "—")}</td></tr>
        <tr><td>Address</td><td>${esc(supplier.address || "—")}</td></tr>
        <tr><td>Contact</td><td>${esc([supplier.phone, supplier.email].filter(Boolean).join(" · ") || "—")}</td></tr>
      </table>
    </div>
    <div>
      <h2>B. Buyer (respondent)</h2>
      <table class="kv">
        <tr><td>Name of the buyer</td><td>${esc(buyer.name)}</td></tr>
        <tr><td>GSTIN</td><td>${esc(buyer.gstin ?? "—")}</td></tr>
        <tr><td>Address</td><td>${esc(buyer.address || "—")}</td></tr>
        <tr><td>Contact</td><td>${esc([buyer.phone, buyer.email].filter(Boolean).join(" · ") || "—")}</td></tr>
      </table>
    </div>
  </div>

  <h2>C. Invoices remaining unpaid beyond the period in section 15</h2>
  <table>
    <thead><tr>
      <th class="c">#</th><th>Invoice no.</th><th class="c">Invoice date</th>
      <th class="c">Date of acceptance</th><th class="c">Agreed days (max ${MAX_AGREED_DAYS})</th>
      <th class="c">Due date</th><th class="r">Invoice amount</th><th class="r">Amount received</th>
      <th class="r">Principal due</th><th class="c">Days delayed</th><th class="r">Interest (s.16)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="6">Total (${claim.lines.length} invoice${claim.lines.length === 1 ? "" : "s"})</td>
      <td class="r">${inr(invoiceTotal)}</td><td class="r">${inr(paidTotal)}</td>
      <td class="r">${inr(claim.principalTotal)}</td><td></td><td class="r">${inr(claim.interestTotal)}</td>
    </tr></tfoot>
  </table>

  <h2>D. Amount claimed as on ${dmy(claim.asOfDate)}</h2>
  <table class="kv totals">
    <tr><td>Principal amount due</td><td class="r">₹ ${inr(claim.principalTotal)}</td></tr>
    <tr><td>Interest under section 16</td><td class="r">₹ ${inr(claim.interestTotal)}</td></tr>
    <tr><td><strong>Total amount claimed</strong></td><td class="r"><strong>₹ ${inr(claim.claimTotal)}</strong></td></tr>
  </table>
  <p class="note">Interest is compound interest with monthly rests at ${INTEREST_MULTIPLE} times the
  bank rate notified by the Reserve Bank of India (${claim.bankRate}% × ${INTEREST_MULTIPLE} =
  ${claim.annualRate}% a year${supplier.bankRateNote ? `; ${esc(supplier.bankRateNote)}` : ""}), from the
  day after the due date to the date above. The due date is the agreed date, which cannot exceed
  ${MAX_AGREED_DAYS} days from acceptance, or ${DAYS_WITHOUT_AGREEMENT} days from acceptance where no
  period was agreed in writing (section 15). Amounts received are applied to the principal.
  Interest continues to run until payment.</p>

  <h2>E. Declaration</h2>
  <p>We declare that the particulars above are true to the best of our knowledge, that the goods
  or services were supplied and accepted as stated, and that the amounts shown remain unpaid.</p>
  ${claim.notes ? `<p><strong>Remarks:</strong> ${esc(claim.notes)}</p>` : ""}
  <div class="sign">
    <div>Place: ____________________<br/><br/>Date: ____________________</div>
    <div>For ${esc(supplier.name)}<br/><br/><br/>Authorised signatory</div>
  </div>
</body></html>`;
};

export const renderClaimPdf = async (data: StatementData) => ({
  buffer: await generatePdfFromHtml(renderClaimHtml(data)),
  filename: `MSME-claim-${data.claim.claimNo}.pdf`.replace(/[^\w.-]+/g, "_"),
});
