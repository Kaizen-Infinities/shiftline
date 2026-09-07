import React from "react";

/** Shared bits for the platform console pages (P1-02). */
export const input =
  "rounded-lg border border-line-soft bg-card px-3 py-2 text-sm text-ink outline-none focus:border-blue-500";
export const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
export const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
export const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
export const danger = `${btn} border border-rose-300 text-rose-700 hover:bg-rose-50`;
export const th =
  "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
export const td = "px-3 py-1.5 text-sm text-ink";

export const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  (err as Error)?.message ??
  "Something went wrong";

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

const STATUS: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  TRIALING: "bg-sky-100 text-sky-800",
  PAST_DUE: "bg-amber-100 text-amber-800",
  SUSPENDED: "bg-rose-100 text-rose-800",
  CANCELLED: "bg-slate-100 text-slate-700",
  active: "bg-emerald-100 text-emerald-800",
  suspended: "bg-rose-100 text-rose-800",
  locked: "bg-amber-100 text-amber-800",
};

export const Badge: React.FC<{ value: string | null | undefined }> = ({ value }) =>
  value ? (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[value] ?? "bg-card-2 text-ink-muted"}`}
    >
      {value}
    </span>
  ) : (
    <span className="text-ink-subtle">—</span>
  );

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-xl border border-line-soft bg-card p-4">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
    <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
    {hint && <div className="text-xs text-ink-subtle">{hint}</div>}
  </div>
);

export const Section: React.FC<{
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, right, children }) => (
  <section className="rounded-xl border border-line-soft bg-card">
    <div className="flex items-center justify-between gap-2 border-b border-line-soft px-4 py-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {right}
    </div>
    <div className="p-4">{children}</div>
  </section>
);
