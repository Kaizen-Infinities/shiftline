import type { statementService } from "../modules/accounts/statement.service";

type Statement = Awaited<ReturnType<typeof statementService.statement>>;

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const money = (n: number) =>
  Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = (n: number) => `${money(n)} ${n < 0 ? "Cr" : "Dr"}`;
const date = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

/** Statement of account as printable HTML (A4 through the PDF generator). */
export const renderStatementHtml = (s: Statement): string => {
  const period = s.startDate
    ? `${date(s.startDate)} to ${date(s.endDate)}`
    : `up to ${date(s.endDate)}`;
  const owes = s.party.type === "customer" ? s.closingBalance : -s.closingBalance;
  const rows = s.entries
    .map(
      (e) => `<tr>
        <td>${date(e.date)}</td>
        <td>${esc(e.voucherNo)}<br><small>${esc(e.voucherType)}</small></td>
        <td>${esc(e.particulars)}${e.narration ? `<br><small>${esc(e.narration)}</small>` : ""}</td>
        <td class="num">${e.debit ? money(e.debit) : ""}</td>
        <td class="num">${e.credit ? money(e.credit) : ""}</td>
        <td class="num">${drcr(e.runningBalance)}</td>
      </tr>`
    )
    .join("");
  const ageing = s.ageing
    ? `<h3>Unpaid as on ${date(s.endDate)}</h3>
      <table class="ageing">
        <tr><th>Not due</th><th>0–30</th><th>31–60</th><th>61–90</th><th>90+</th><th>Total</th></tr>
        <tr>
          <td class="num">${money(s.ageing.buckets.notDue)}</td>
          <td class="num">${money(s.ageing.buckets.d0_30)}</td>
          <td class="num">${money(s.ageing.buckets.d31_60)}</td>
          <td class="num">${money(s.ageing.buckets.d61_90)}</td>
          <td class="num">${money(s.ageing.buckets.d90_plus)}</td>
          <td class="num"><b>${money(s.ageing.total)}</b></td>
        </tr>
      </table>
      ${
        s.ageing.documents.length
          ? `<table>
        <tr><th>Document</th><th>Date</th><th>Due</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Balance</th><th class="num">Days overdue</th></tr>
        ${s.ageing.documents
          .map(
            (d) => `<tr><td>${esc(d.number)}</td><td>${date(d.date)}</td><td>${date(d.dueDate)}</td>
            <td class="num">${money(d.amount)}</td><td class="num">${money(d.paid)}</td>
            <td class="num">${money(d.balance)}</td><td class="num">${d.daysOverdue > 0 ? d.daysOverdue : ""}</td></tr>`
          )
          .join("")}
      </table>`
          : ""
      }`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement of account</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; margin: 0; }
    h1 { font-size: 16px; margin: 0 0 2px; } h2 { font-size: 13px; margin: 16px 0 6px; } h3 { font-size: 12px; margin: 14px 0 4px; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .muted { color: #555; } small { color: #666; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; font-size: 10px; text-transform: uppercase; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .total td { font-weight: bold; background: #fafafa; }
    .summary { margin-top: 10px; padding: 8px; border: 1px solid #111; display: inline-block; }
  </style></head><body>
  <div class="head">
    <div>
      <h1>${esc(s.company.name)}</h1>
      <div class="muted">${esc(s.company.address)}</div>
      ${s.company.gstin ? `<div class="muted">GSTIN ${esc(s.company.gstin)}</div>` : ""}
      <div class="muted">${[s.company.phone, s.company.email].filter(Boolean).map(esc).join(" · ")}</div>
    </div>
    <div style="text-align:right">
      <h1>Statement of Account</h1>
      <div>${period}</div>
      <div class="muted">Generated ${date(new Date())}</div>
    </div>
  </div>
  <h2>${s.party.type === "customer" ? "Customer" : "Supplier"}: ${esc(s.party.name)} <small>(${esc(s.party.code)})</small></h2>
  <div class="muted">${[s.party.address, s.party.gstin ? `GSTIN ${s.party.gstin}` : null, s.party.email, s.party.phone].filter(Boolean).map(esc).join(" · ")}</div>
  <table>
    <tr><th>Date</th><th>Voucher</th><th>Particulars</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr>
    <tr class="total"><td colspan="5">Opening balance</td><td class="num">${drcr(s.openingBalance)}</td></tr>
    ${rows || `<tr><td colspan="6" class="muted">No entries in this period.</td></tr>`}
    <tr class="total"><td colspan="5">Closing balance</td><td class="num">${drcr(s.closingBalance)}</td></tr>
  </table>
  <div class="summary">${
    owes > 0.005
      ? `${s.party.type === "customer" ? "Amount receivable from you" : "Amount payable to you"}: <b>₹ ${money(owes)}</b>`
      : owes < -0.005
        ? `${s.party.type === "customer" ? "Advance / credit in your favour" : "Advance / debit in our favour"}: <b>₹ ${money(owes)}</b>`
        : "Account settled."
  }</div>
  ${ageing}
  <p class="muted" style="margin-top:18px">This is a computer-generated statement. Please report any discrepancy within 7 days.</p>
  </body></html>`;
};
