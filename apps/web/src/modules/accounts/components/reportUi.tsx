/**
 * UI v2 class set for the accounts screens that grew up on the GST screens' helpers
 * (fixed assets, costing, forex, Tally export, MSME, bank reconciliation). Same names,
 * v2 look: pills, `.sl-input`, tiles with an `.sl-h2` heading. Formatters are re-used as is.
 */
import React from "react";

export {
  money,
  day,
  monthOptions,
  fyOptions,
  message,
  TaxRow,
} from "../../compliance/components/gstUi";

export const th =
  "bg-card-2 px-4 py-2.5 text-left text-[12px] font-semibold text-ink-muted whitespace-nowrap first:rounded-l-[12px] last:rounded-r-[12px]";
export const td = "px-4 py-2.5 text-[13.5px] text-ink";
export const field = "sl-input h-11 !w-auto min-w-40 text-sm";
export const primary = "sl-cta sl-pill-sm";
export const secondary = "sl-btn sl-pill-sm";
export const success = "sl-btn-blue sl-pill-sm";
export const danger = "sl-btn-danger sl-pill-sm";

/** A titled tile. */
export const Card: React.FC<{
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, children, actions }) => (
  <section className="sl-tile p-4 sm:p-5">
    <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="sl-h2 m-0 text-[15px]">{title}</h2>
      {actions}
    </header>
    {children}
  </section>
);
