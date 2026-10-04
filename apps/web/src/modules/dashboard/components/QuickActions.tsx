import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  LuBanknote,
  LuLandmark,
  LuFilePlus,
  LuHandCoins,
  LuFactory,
  LuShoppingCart,
} from "react-icons/lu";
import { usePermission } from "../../../hooks/usePermission";

/* ════════════════════════════════════════════════════════════════
   QUICK ACTIONS
   The concept's green pills ("Run Payroll", "Pay Taxes") with pale-blue
   chips ("TDS", "PF", "PT") beneath. Each action and each chip appears only
   when the user may open the screen it leads to — the same permission the
   route itself checks in routes/AppRoutes.tsx.
   ════════════════════════════════════════════════════════════════ */

interface ChipLink {
  label: string;
  to: string;
  title: string;
}

interface ActionGroup {
  key: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  chips: ChipLink[];
}

export const QuickActions: React.FC = () => {
  const { can, canAny } = usePermission();

  const groups = useMemo<ActionGroup[]>(() => {
    const list: ActionGroup[] = [];
    const chip = (ok: boolean, c: ChipLink) => (ok ? [c] : []);

    // Payroll: run it, with the statutory deductions one click away.
    if (can("payroll-run.view")) {
      list.push({
        key: "payroll",
        label: "Run Payroll",
        to: "/payroll/run",
        icon: LuBanknote,
        chips: [
          ...chip(can("tds.view"), { label: "TDS", to: "/compliance/tds", title: "TDS and TCS" }),
          ...chip(can("payroll.view"), {
            label: "PF",
            to: "/payroll/statutory",
            title: "Provident Fund — statutory payroll",
          }),
          ...chip(can("payroll.view"), {
            label: "ESI",
            to: "/payroll/statutory",
            title: "Employees' State Insurance — statutory payroll",
          }),
          ...chip(can("payroll.view"), {
            label: "PT",
            to: "/payroll/statutory",
            title: "Professional Tax — statutory payroll",
          }),
        ],
      });
    }

    // Taxes: the compliance calendar lists every due return and payment.
    const taxTo = can("filings.view")
      ? "/compliance/calendar"
      : can("gst-returns.view")
        ? "/compliance/gst"
        : can("tds.view")
          ? "/compliance/tds"
          : null;
    if (taxTo) {
      list.push({
        key: "taxes",
        label: "Pay Taxes",
        to: taxTo,
        icon: LuLandmark,
        chips: [
          ...chip(can("gst-returns.view") && taxTo !== "/compliance/gst", {
            label: "GST",
            to: "/compliance/gst",
            title: "GST returns",
          }),
          ...chip(can("filings.view"), {
            label: "Approvals",
            to: "/compliance/approvals",
            title: "Filing approvals",
          }),
        ],
      });
    }

    if (can("sales-invoices.create")) {
      list.push({
        key: "invoice",
        label: "New Invoice",
        to: "/sales-invoices/create",
        icon: LuFilePlus,
        chips: [
          ...chip(can("sales-invoices.view"), {
            label: "Invoices",
            to: "/sales-invoices",
            title: "All sales invoices",
          }),
          ...chip(can("sales-orders.view"), {
            label: "Sales orders",
            to: "/sales-order",
            title: "Sales orders",
          }),
        ],
      });
    }

    if (canAny("vouchers.view", "accounts.view")) {
      list.push({
        key: "receipt",
        label: "Record Receipt",
        to: "/accounts/receipt-voucher/add",
        icon: LuHandCoins,
        chips: [
          ...chip(
            canAny(
              "accounts.view",
              "payable.view",
              "receivable.view",
              "vouchers.view",
              "petty-cash.view",
              "chart-of-accounts.view"
            ),
            { label: "Receivables", to: "/accounts/receivable", title: "Amounts receivable" }
          ),
        ],
      });
    }

    const planTo = can("daily-machine-planning.create")
      ? "/daily-production-plans/create"
      : can("production_orders.create")
        ? "/production-orders/create"
        : null;
    if (planTo) {
      list.push({
        key: "plan",
        label: "Plan Production",
        to: planTo,
        icon: LuFactory,
        chips: [
          ...chip(can("production_orders.view"), {
            label: "Production orders",
            to: "/production-orders",
            title: "Production orders",
          }),
          ...chip(can("oee-dashboard.view"), {
            label: "OEE",
            to: "/oee-dashboard",
            title: "OEE and machine activity",
          }),
        ],
      });
    }

    if (can("purchaseOrders.create")) {
      list.push({
        key: "po",
        label: "New Purchase Order",
        to: "/purchase-orders/create",
        icon: LuShoppingCart,
        chips: [
          ...chip(can("invoice.view"), { label: "Bills", to: "/invoice", title: "Purchase bills" }),
        ],
      });
    }

    return list;
  }, [can, canAny]);

  if (groups.length === 0) return null;

  return (
    <section aria-labelledby="dash-quick-actions" className="flex flex-col gap-3">
      <h2 id="dash-quick-actions" className="sl-section-label">
        Quick actions
      </h2>

      {/* Phones: a compact two-column grid of pills, then every chip in one row. */}
      <div className="grid grid-cols-2 gap-3 sm:hidden">
        {groups.map((g) => (
          <Link
            key={g.key}
            to={g.to}
            className="sl-cta min-h-11 justify-start px-4 py-2.5 text-sm whitespace-normal"
          >
            <g.icon className="shrink-0 text-base" aria-hidden="true" />
            <span className="leading-tight">{g.label}</span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-1 sm:hidden">
        {groups.flatMap((g) =>
          g.chips.map((c) => (
            <Link key={`${g.key}-${c.label}`} to={c.to} title={c.title} className="sl-chip">
              {c.label}
            </Link>
          ))
        )}
      </div>

      {/* Tablet and up: each pill with its chips beneath, as in the concept, in aligned
          columns so a sixth action never wraps onto a row of its own. */}
      <div className="hidden items-start gap-x-5 gap-y-6 sm:grid sm:grid-cols-2 lg:grid-cols-3 min-[1760px]:grid-cols-6">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col items-start gap-3">
            <Link to={g.to} className="sl-cta">
              <g.icon className="text-lg" aria-hidden="true" />
              {g.label}
            </Link>
            {g.chips.length > 0 && (
              <div
                className="flex flex-wrap gap-1.5 pl-1"
                role="group"
                aria-label={`${g.label} shortcuts`}
              >
                {g.chips.map((c) => (
                  <Link key={c.label} to={c.to} title={c.title} className="sl-chip">
                    {c.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
