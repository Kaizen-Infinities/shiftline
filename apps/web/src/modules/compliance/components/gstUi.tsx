import React from "react";
import type { TaxAmounts } from "../../../services/gstReturnsService";
import { Tile } from "../../../components/ui/v2";

/**
 * The handful of classes and formatters every GST screen shares (P1-13d), in the UI v2 look:
 * tables sit in white tiles with a card-2 header band, actions are pills, inputs are `.sl-input`.
 * Other modules import these too, so the names and signatures stay put.
 */
export const th = "sl-th bg-card-2 px-3 py-2.5 text-left first:rounded-l-xl last:rounded-r-xl";
export const td = "px-3 py-2.5 text-sm text-ink tabular-nums";
export const field = "sl-input h-10 w-auto max-w-full py-0 text-sm";
export const primary = "sl-btn-blue sl-pill-sm";
export const secondary = "sl-btn sl-pill-sm";
/** A confirming action (approve, accept). Blue, not the green CTA: a screen has one of those. */
export const success = "sl-btn-blue sl-pill-sm";
export const danger = "sl-btn-soft-danger sl-pill-sm";

/** Rupees the way an Indian finance screen writes them. */
export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));

export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—";

/** "2026-07" or "072026" → "Jul 2026"; anything else is returned as it came. */
export const periodLabel = (key: string | null | undefined): string => {
  if (!key) return "—";
  let y: number | null = null;
  let m: number | null = null;
  const iso = /^(\d{4})-(\d{2})$/.exec(key);
  const portal = /^(\d{2})(\d{4})$/.exec(key);
  if (iso) [y, m] = [Number(iso[1]), Number(iso[2])];
  else if (portal) [m, y] = [Number(portal[1]), Number(portal[2])];
  if (!y || !m || m < 1 || m > 12) return key;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};

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

/** A titled white tile. */
export const Card: React.FC<{
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}> = ({ title, children, actions, subtitle, icon, className }) => (
  <Tile title={title} subtitle={subtitle} actions={actions} icon={icon} className={className}>
    {children}
  </Tile>
);

/** A horizontally scrolling wrapper for the plain tables inside tiles. */
export const TableScroll: React.FC<{ children: React.ReactNode; label?: string }> = ({
  children,
  label,
}) => (
  <div
    className="-mx-1 overflow-x-auto px-1"
    role={label ? "region" : undefined}
    aria-label={label}
  >
    {children}
  </div>
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
