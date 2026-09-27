import React, { useEffect, useState } from "react";
import { FaEnvelope, FaFilePdf, FaWhatsapp } from "react-icons/fa";
import { toast } from "react-toastify";

import {
  statementService,
  type Statement,
  type StatementPartyType,
} from "../../../services/statementService";

/**
 * Statement of account for one party (P1-10c): pick a period, see the opening, closing and
 * unpaid totals, then open the PDF or send it to the party by email or WhatsApp.
 */
const input =
  "rounded border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-accent";
const btn =
  "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border border-line transition disabled:opacity-50";
const inr = (n: number) =>
  Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const fyStart = () => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-04-01`;
};

export const StatementPanel: React.FC<{
  partyType: StatementPartyType;
  partyId: string;
  onClose: () => void;
}> = ({ partyType, partyId, onClose }) => {
  const [startDate, setStartDate] = useState(fyStart());
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [statement, setStatement] = useState<Statement | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"" | "pdf" | "email" | "whatsapp" | "load">("");

  useEffect(() => {
    let live = true;
    setBusy("load");
    statementService
      .get(partyType, partyId, { startDate, endDate })
      .then((s) => {
        if (!live) return;
        setStatement(s);
        setEmail((e) => e || s.party.email || "");
        setPhone((p) => p || s.party.phone || "");
      })
      .catch((err) => toast.error(message(err)))
      .finally(() => live && setBusy(""));
    return () => {
      live = false;
    };
  }, [partyType, partyId, startDate, endDate]);

  const run = async (kind: "pdf" | "email" | "whatsapp") => {
    setBusy(kind);
    try {
      if (kind === "pdf") {
        await statementService.openPdf(partyType, partyId, { startDate, endDate });
      } else {
        const r = await statementService.send(partyType, partyId, {
          startDate,
          endDate,
          channel: kind,
          to: kind === "email" ? email : phone,
        });
        toast.success(`Statement sent to ${r.to}`);
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy("");
    }
  };

  const owes = statement
    ? partyType === "customer"
      ? statement.closingBalance
      : -statement.closingBalance
    : 0;

  return (
    <div
      className="bg-card border border-line rounded-lg p-3 space-y-3"
      data-testid="statement-panel"
    >
      <div className="flex flex-wrap items-end gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink mr-auto">
          Statement of account
        </h3>
        <label className="text-[10px] uppercase tracking-wide text-ink-subtle font-semibold">
          From
          <input
            type="date"
            className={`${input} block`}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="text-[10px] uppercase tracking-wide text-ink-subtle font-semibold">
          To
          <input
            type="date"
            className={`${input} block`}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <button type="button" className={`${btn} text-ink-muted hover:bg-line`} onClick={onClose}>
          Close
        </button>
      </div>

      {statement && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <div className="rounded border border-line-soft p-2">
            <div className="text-[10px] uppercase text-ink-subtle">Opening</div>
            <div className="tabular-nums text-ink">
              {inr(statement.openingBalance)} {statement.openingBalance < 0 ? "Cr" : "Dr"}
            </div>
          </div>
          <div className="rounded border border-line-soft p-2">
            <div className="text-[10px] uppercase text-ink-subtle">Entries</div>
            <div className="tabular-nums text-ink">{statement.entries.length}</div>
          </div>
          <div className="rounded border border-line-soft p-2">
            <div className="text-[10px] uppercase text-ink-subtle">Closing</div>
            <div className="tabular-nums text-ink">
              {inr(statement.closingBalance)} {statement.closingBalance < 0 ? "Cr" : "Dr"}
            </div>
          </div>
          <div className="rounded border border-line-soft p-2">
            <div className="text-[10px] uppercase text-ink-subtle">
              {partyType === "customer" ? "Receivable" : "Payable"} · overdue
            </div>
            <div className="tabular-nums text-ink">
              {inr(Math.max(owes, 0))}
              <span className="ml-1 text-[color:var(--color-danger)]">
                {statement.ageing ? `· ${inr(statement.ageing.overdue)}` : ""}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          className={`${btn} bg-card-2 text-ink hover:bg-line`}
          disabled={busy !== ""}
          onClick={() => run("pdf")}
        >
          <FaFilePdf className="text-[color:var(--color-danger)]" />{" "}
          {busy === "pdf" ? "Preparing…" : "Open PDF"}
        </button>
        <label className="text-[10px] uppercase tracking-wide text-ink-subtle font-semibold">
          Email
          <input
            type="email"
            className={`${input} block w-56`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="party@example.com"
          />
        </label>
        <button
          type="button"
          className={`${btn} bg-card-2 text-ink hover:bg-line`}
          disabled={busy !== "" || !email}
          onClick={() => run("email")}
        >
          <FaEnvelope className="text-accent" /> {busy === "email" ? "Sending…" : "Email"}
        </button>
        <label className="text-[10px] uppercase tracking-wide text-ink-subtle font-semibold">
          WhatsApp
          <input
            className={`${input} block w-40`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="91XXXXXXXXXX"
          />
        </label>
        <button
          type="button"
          className={`${btn} bg-card-2 text-ink hover:bg-line`}
          disabled={busy !== "" || !phone}
          onClick={() => run("whatsapp")}
        >
          <FaWhatsapp className="text-[color:var(--color-success)]" />{" "}
          {busy === "whatsapp" ? "Sending…" : "WhatsApp"}
        </button>
      </div>
    </div>
  );
};

export default StatementPanel;
