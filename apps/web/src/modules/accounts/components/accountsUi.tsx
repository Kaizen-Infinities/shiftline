/**
 * Accounts UI v2 kit: the pieces every voucher, register and report screen in
 * the accounts module shares, built on the `.sl-*` classes and the v2
 * primitives so light and dark both work. Behaviour stays in the pages; this
 * file only decides how things look.
 */
import React from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BookOpen } from "lucide-react";
import { cx, Chip } from "../../../components/ui/v2";

/* ── Formatting (display only; never used for maths) ── */

const IN2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "12,34,567.00" (en-IN grouping, two decimals, no symbol) — for dense grids. */
export const fmtAmt = (value: number | string | null | undefined): string => {
  const n = Number(value ?? 0);
  return IN2.format(Number.isFinite(n) ? n : 0);
};

/** "₹12,34,567.00"; negatives as "-₹1,234.00". */
export const fmtINR = (value: number | string | null | undefined): string => {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe < 0 ? "-" : ""}₹${IN2.format(Math.abs(safe))}`;
};

/** Balance with its side: positive = Dr, negative = Cr ("₹1,234.00 Cr"). */
export const fmtDrCr = (value: number | string | null | undefined): string => {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  if (safe === 0) return "₹0.00";
  return `₹${IN2.format(Math.abs(safe))} ${safe > 0 ? "Dr" : "Cr"}`;
};

/** Compact rupees for stat tiles: "₹95,000", "₹12.35L", "₹1.23Cr". */
export const fmtINRCompact = (value: number | string | null | undefined): string => {
  const n = Number(value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
};

/** "24 Sep 2026" (en-IN). Accepts ISO strings or Dates; empty input gives "—". */
export const fmtDate = (value: string | Date | null | undefined): string => {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  // en-GB spells the month "Sep" (en-IN says "Sept"); the order is the same.
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/* ── Voucher types ── */

export type VoucherKind = "PAYMENT" | "RECEIPT" | "JOURNAL" | "CONTRA";

export const VOUCHER_KINDS: Record<
  VoucherKind,
  { label: string; register: string; add: string; icon: React.ReactNode; hint: string }
> = {
  PAYMENT: {
    label: "Payment",
    register: "/accounts/payment-voucher",
    add: "/accounts/payment-voucher/add",
    icon: <ArrowUpRight size={18} />,
    hint: "Money paid out of a bank or cash account",
  },
  RECEIPT: {
    label: "Receipt",
    register: "/accounts/receipt-voucher",
    add: "/accounts/receipt-voucher/add",
    icon: <ArrowDownLeft size={18} />,
    hint: "Money received into a bank or cash account",
  },
  JOURNAL: {
    label: "Journal",
    register: "/accounts/journal-entry",
    add: "/accounts/journal-entry/add",
    icon: <BookOpen size={18} />,
    hint: "Adjustments between any ledgers; debits must equal credits",
  },
  CONTRA: {
    label: "Contra",
    register: "/accounts/contra-entry",
    add: "/accounts/contra-entry/add",
    icon: <ArrowLeftRight size={18} />,
    hint: "Transfers between your own bank and cash accounts",
  },
};

/** Chip row that switches between the four voucher registers (or entry screens). */
export const VoucherTypeNav: React.FC<{
  current: VoucherKind;
  target?: "register" | "add";
  className?: string;
}> = ({ current, target = "register", className }) => (
  <nav aria-label="Voucher type" className={cx("-mx-1 overflow-x-auto px-1", className)}>
    <ul className="m-0 flex list-none items-center gap-2 p-0 py-1">
      {(Object.keys(VOUCHER_KINDS) as VoucherKind[]).map((kind) => {
        const meta = VOUCHER_KINDS[kind];
        const active = kind === current;
        return (
          <li key={kind} className="shrink-0">
            <Link
              to={target === "add" ? meta.add : meta.register}
              aria-current={active ? "page" : undefined}
              className={cx(
                "sl-chip sl-chip-lg no-underline",
                !active && "sl-chip-ghost",
                active && "!bg-nav-active !text-[color:var(--color-nav-active-fg)] font-semibold"
              )}
            >
              <span className="inline-flex" aria-hidden="true">
                {React.cloneElement(meta.icon as React.ReactElement<{ size: number }>, {
                  size: 15,
                })}
              </span>
              {meta.label}
            </Link>
          </li>
        );
      })}
    </ul>
  </nav>
);

/* ── Keyboard hints ── */

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="sl-kbd">{children}</kbd>
);

/** A quiet row of "key → what it does" hints. */
export const KeyHints: React.FC<{
  hints: Array<[React.ReactNode, React.ReactNode]>;
  className?: string;
}> = ({ hints, className }) => (
  <p
    className={cx(
      "m-0 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-ink-muted",
      className
    )}
  >
    {hints.map(([keys, label], i) => (
      <span key={i} className="inline-flex items-center gap-1.5">
        {keys}
        <span>{label}</span>
      </span>
    ))}
  </p>
);

/* ── Register options (the Tally/Busy "list of vouchers" dialog) ── */

/** One option row: label on the left from 640px up, stacked on phones. */
export const OptionRow: React.FC<{
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, children }) => (
  <div className="grid gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-4">
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-muted">
      {label}
    </label>
    <div className="min-w-0">{children}</div>
  </div>
);

/** Yes / No pair of toggle chips (Busy's Y/N switch). */
export const YesNo: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, value, onChange }) => (
  <div className="grid gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-4">
    <span className="text-[13px] font-semibold text-ink-muted">{label}</span>
    <div role="group" aria-label={label} className="flex gap-2">
      <Chip onClick={() => onChange(true)} selected={value} className="min-w-14 justify-center">
        Yes
      </Chip>
      <Chip onClick={() => onChange(false)} selected={!value} className="min-w-14 justify-center">
        No
      </Chip>
    </div>
  </div>
);

/** The options tile shown before a register opens: fields, then "Show vouchers (F2)". */
export const RegisterOptionsCard: React.FC<{
  onOk: () => void;
  children: React.ReactNode;
  okLabel?: string;
}> = ({ onOk, children, okLabel = "Show vouchers" }) => (
  <section aria-labelledby="register-options-title" className="sl-tile max-w-2xl p-5 sm:p-6">
    <h2 id="register-options-title" className="sl-h2 m-0">
      Register options
    </h2>
    <p className="sl-muted m-0 mt-1 text-sm">
      Pick the period and the columns to show. The register opens with today by default.
    </p>
    <div className="mt-5 flex flex-col gap-4">{children}</div>
    <div className="mt-6 flex flex-col-reverse gap-3 border-t border-line-soft pt-4 sm:flex-row sm:items-center sm:justify-between">
      <KeyHints
        hints={[
          [<Kbd key="f2">F2</Kbd>, "show"],
          [<Kbd key="esc">Esc</Kbd>, "close"],
        ]}
      />
      <button type="button" onClick={onOk} className="sl-btn-blue sl-pill-md">
        {okLabel} <span className="opacity-80">(F2)</span>
      </button>
    </div>
  </section>
);

/** Classes for a plain select or text input in an options row. */
export const optionInputClass = "sl-input h-11 w-full text-sm";

/* ── Tables ── */

/** Header cell classes for hand-built tables (matches DataTable's header band). */
export const thClass = (align: "left" | "right" | "center" = "left", extra = "") =>
  cx(
    "sticky top-0 z-[1] bg-card-2 px-4 py-3 text-[12px] font-semibold text-ink-muted whitespace-nowrap border-b border-line-soft",
    align === "right" && "text-right",
    align === "center" && "text-center",
    extra
  );

/** Body cell classes. */
export const tdClass = (align: "left" | "right" | "center" = "left", extra = "") =>
  cx(
    "px-4 py-3 align-middle text-[14px] text-ink",
    align === "right" && "text-right tabular-nums whitespace-nowrap",
    align === "center" && "text-center",
    extra
  );

/* ── Voucher entry grid ── */

/** Classes for an editable grid cell input (spreadsheet style, 40px, focus ring on the cell). */
export const gridInputClass = (disabled?: boolean, extra = "") =>
  cx(
    "block h-10 w-full min-w-0 border-0 bg-transparent px-3 text-[14px] text-ink outline-none",
    "placeholder:text-ink-subtle focus:bg-nav-active focus:shadow-[inset_0_0_0_2px_var(--color-primary)]",
    "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
    disabled && "cursor-not-allowed opacity-40",
    extra
  );

/** Wrapper classes that make the shared ledger picker's `cell` input fit the 40px grid. */
export const gridLedgerCellClass =
  "[&_input]:h-10 [&_input]:px-3 [&_input]:text-[14px] [&_input:focus]:bg-nav-active [&_input:focus]:shadow-[inset_0_0_0_2px_var(--color-primary)]";

/** Header cell of the entry grid. */
export const gridThClass = (align: "left" | "right" | "center" = "left", extra = "") =>
  cx(
    "bg-card-2 px-3 py-2.5 text-[12px] font-semibold text-ink-muted whitespace-nowrap border-b border-line-soft",
    align === "right" && "text-right",
    align === "center" && "text-center",
    extra
  );

/** Debit / credit / difference summary for balanced vouchers. */
export const BalanceSummary: React.FC<{
  debit: number;
  credit: number;
  count: number;
  debitLabel?: string;
  creditLabel?: string;
}> = ({ debit, credit, count, debitLabel = "Total debit", creditLabel = "Total credit" }) => {
  const diff = debit - credit;
  const balanced = Math.abs(diff) < 0.01;
  const hasAmount = debit > 0 || credit > 0;
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4" aria-live="polite">
      <div>
        <dt className="text-[12px] font-medium text-ink-subtle">{debitLabel}</dt>
        <dd className="m-0 text-lg font-semibold tabular-nums text-ink">{fmtINR(debit)}</dd>
      </div>
      <div>
        <dt className="text-[12px] font-medium text-ink-subtle">{creditLabel}</dt>
        <dd className="m-0 text-lg font-semibold tabular-nums text-ink">{fmtINR(credit)}</dd>
      </div>
      <div>
        <dt className="text-[12px] font-medium text-ink-subtle">Difference</dt>
        <dd className="m-0 mt-0.5">
          {!hasAmount ? (
            <Chip tone="muted">₹0.00</Chip>
          ) : balanced ? (
            <Chip tone="success" dot>
              Balanced
            </Chip>
          ) : (
            <Chip tone="danger" dot>
              {fmtINR(Math.abs(diff))} {diff > 0 ? "Cr short" : "Dr short"}
            </Chip>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-[12px] font-medium text-ink-subtle">Entries</dt>
        <dd className="m-0 text-lg font-semibold tabular-nums text-ink">{count}</dd>
      </div>
    </dl>
  );
};

/** Sticky footer bar of an entry form: hints on the left, Quit + Save on the right. */
export const EntryFooter: React.FC<{
  hints?: React.ReactNode;
  children: React.ReactNode;
}> = ({ hints, children }) => (
  <div className="sticky bottom-0 z-20 -mx-1 mt-4 px-1 pb-3 pt-2">
    <div className="sl-tile flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{hints}</div>
      <div className="flex shrink-0 items-center justify-end gap-2.5">{children}</div>
    </div>
  </div>
);

/** A small "Label: value" pair for summary strips. */
export const MetaItem: React.FC<{
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ label, children, className }) => (
  <div className={cx("min-w-0", className)}>
    <div className="text-[12px] font-medium text-ink-subtle">{label}</div>
    <div className="mt-0.5 truncate text-[14px] font-semibold text-ink">{children}</div>
  </div>
);

/** Error tile with a retry button, for failed loads. */
export const LoadError: React.FC<{ message?: string; onRetry?: () => void }> = ({
  message = "This could not be loaded.",
  onRetry,
}) => (
  <div className="sl-tile flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
    <p className="m-0 text-sm text-[color:var(--color-danger)]">{message}</p>
    {onRetry && (
      <button type="button" className="sl-btn sl-pill-sm" onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);

/** Tone for a money figure that genuinely means good/bad (profit vs loss). */
export const signTone = (value: number) =>
  value < 0 ? "text-[color:var(--color-danger)]" : "text-[color:var(--color-success)]";
