import React from "react";
import type { TaxAmounts } from "../../../services/gstReturnsService";

/** The handful of classes and formatters every GST screen shares (P1-13d). */
export const th =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
export const td = "px-3 py-1.5 text-sm text-ink";
export const field = "rounded-lg border border-line-soft bg-card px-3 py-1.5 text-sm text-ink";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
export const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
export const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
export const success = `${btn} bg-emerald-600 text-white hover:bg-emerald-700`;
export const danger = `${btn} border border-rose-300 text-rose-700 hover:bg-rose-50`;

/** Rupees the way an Indian finance screen writes them. */
export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

/** The last `count` months, newest first, as period keys with readable labels. */
export const monthOptions = (count: number) => {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }),
    });
  }
  return out;
};

/** The last `count` Indian financial years, newest first. */
export const fyOptions = (count: number) => {
  const now = new Date();
  const current = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from({ length: count }, (_, i) => {
    const start = current - i;
    const key = `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
    return { value: key, label: `FY ${key}` };
  });
};

export const Card: React.FC<{
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, children, actions }) => (
  <section className="rounded-xl border border-line-soft bg-card p-4">
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      {actions}
    </header>
    {children}
  </section>
);

export const TaxRow: React.FC<{ label: string; amounts: TaxAmounts }> = ({ label, amounts }) => (
  <tr className="border-t border-line-soft">
    <td className={td}>{label}</td>
    <td className={`${td} text-right`}>{money(amounts.taxable)}</td>
    <td className={`${td} text-right`}>{money(amounts.igst)}</td>
    <td className={`${td} text-right`}>{money(amounts.cgst)}</td>
    <td className={`${td} text-right`}>{money(amounts.sgst)}</td>
    <td className={`${td} text-right`}>{money(amounts.cess)}</td>
  </tr>
);

export const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";
