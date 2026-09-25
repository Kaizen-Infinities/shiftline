import React, { useMemo, useState } from "react";
import { LuArrowLeft, LuSearch, LuShoppingBag, LuUsers, LuX } from "react-icons/lu";
import { DashTile, TileHeader, EmptyState, SkeletonRows, ChipToggle } from "./DashboardPrimitives";

/* ════════════════════════════════════════════════════════════════
   PRODUCT PURCHASE REPORT
   Per customer: which sales products were bought in the last three months
   and which were not. The list drills down inside the tile.
   ════════════════════════════════════════════════════════════════ */

interface ProductPurchaseDetail {
  name: string;
  lastOrderDate?: Date;
  daysAgo?: number;
  isPurchasedWithin3Months: boolean;
  hasEverPurchased: boolean;
}

interface CustomerReportItem {
  name: string;
  purchasedProducts: ProductPurchaseDetail[];
  notPurchasedProducts: ProductPurchaseDetail[];
}

type ReportType = "purchased" | "notPurchased";

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
const safe = (d: any) => (Array.isArray(d) ? d : []);

export const CustomerPurchaseReport: React.FC<{
  salesOrders: any[];
  salesProducts: any[];
  customers: any[];
  loading: boolean;
}> = ({ salesOrders, salesProducts, customers, loading }) => {
  const [selected, setSelected] = useState<{ customer: string; type: ReportType } | null>(null);
  const [search, setSearch] = useState("");

  const report = useMemo(() => {
    const so = safe(salesOrders);
    const productNames = safe(salesProducts)
      .map((p: any) => p.salesProductName || p.name || "")
      .filter(Boolean) as string[];
    const now = Date.now();

    // customerName -> productName -> last order
    const lastOrder: Record<string, Record<string, { lastOrderDate: Date; orderNo?: string }>> = {};
    for (const order of so) {
      const cName = order.customer?.firmName || "Unknown";
      if (!lastOrder[cName]) lastOrder[cName] = {};
      const orderDateVal = order.orderDate || order.createdAt;
      const orderTime = orderDateVal ? new Date(orderDateVal) : new Date(0);
      for (const item of Array.isArray(order.items) ? order.items : []) {
        const pName = item.salesProduct?.salesProductName || item.salesProductName || "";
        if (!pName) continue;
        const existing = lastOrder[cName][pName];
        if (!existing || orderTime.getTime() > existing.lastOrderDate.getTime()) {
          lastOrder[cName][pName] = { lastOrderDate: orderTime, orderNo: order.orderNo };
        }
      }
    }

    const processCustomer = (cName: string): CustomerReportItem => {
      const history = lastOrder[cName] || {};
      const purchasedProducts: ProductPurchaseDetail[] = [];
      const notPurchasedProducts: ProductPurchaseDetail[] = [];
      for (const pName of productNames) {
        const h = history[pName];
        if (h && !isNaN(h.lastOrderDate.getTime()) && h.lastOrderDate.getTime() > 0) {
          const diffMs = now - h.lastOrderDate.getTime();
          const detail: ProductPurchaseDetail = {
            name: pName,
            lastOrderDate: h.lastOrderDate,
            daysAgo: Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000))),
            isPurchasedWithin3Months: diffMs <= THREE_MONTHS_MS,
            hasEverPurchased: true,
          };
          (detail.isPurchasedWithin3Months ? purchasedProducts : notPurchasedProducts).push(detail);
        } else {
          notPurchasedProducts.push({
            name: pName,
            isPurchasedWithin3Months: false,
            hasEverPurchased: false,
          });
        }
      }
      return { name: cName, purchasedProducts, notPurchasedProducts };
    };

    const seen = new Set<string>();
    const result: CustomerReportItem[] = [];
    for (const c of safe(customers)) {
      const cName = c.firmName || "";
      if (!cName) continue;
      seen.add(cName);
      result.push(processCustomer(cName));
    }
    for (const cName of Object.keys(lastOrder)) {
      if (!seen.has(cName)) result.push(processCustomer(cName));
    }

    return {
      totalProducts: productNames.length,
      customers: result.sort(
        (a, b) =>
          b.purchasedProducts.length - a.purchasedProducts.length || a.name.localeCompare(b.name)
      ),
    };
  }, [salesOrders, salesProducts, customers]);

  const close = () => {
    setSelected(null);
    setSearch("");
  };

  const selectedCustomer = selected
    ? report.customers.find((c) => c.name === selected.customer)
    : undefined;

  return (
    <DashTile labelledBy="dash-purchase-report" className="h-[420px]">
      {selected ? (
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="sl-btn px-3 py-1.5 text-xs"
              title="Back to all customers"
            >
              <LuArrowLeft aria-hidden="true" /> Back
            </button>
            <h2 id="dash-purchase-report" className="sl-h2 truncate text-[15px]">
              {selected.customer}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <ChipToggle
              label="Purchase status"
              size="sm"
              value={selected.type}
              onChange={(type) => setSelected({ customer: selected.customer, type })}
              options={[
                {
                  value: "purchased",
                  label: `Bought ≤3 mo (${selectedCustomer?.purchasedProducts.length ?? 0})`,
                },
                {
                  value: "notPurchased",
                  label: `Not bought (${selectedCustomer?.notPurchasedProducts.length ?? 0})`,
                },
              ]}
            />
            <button
              type="button"
              onClick={close}
              aria-label="Close customer details"
              className="grid h-8 w-8 place-items-center rounded-full text-ink-subtle transition-colors hover:bg-card-2 hover:text-ink"
            >
              <LuX aria-hidden="true" />
            </button>
          </div>
        </header>
      ) : (
        <TileHeader
          id="dash-purchase-report"
          icon={LuShoppingBag}
          title="Product purchase report"
          subtitle={`What each customer bought in the last 3 months · ${report.totalProducts} products · ${report.customers.length} customers`}
        />
      )}

      {selected ? (
        (() => {
          const isPurchased = selected.type === "purchased";
          const rawList = isPurchased
            ? selectedCustomer?.purchasedProducts || []
            : selectedCustomer?.notPurchasedProducts || [];
          const filtered = rawList.filter((item) =>
            item.name.toLowerCase().includes(search.toLowerCase())
          );
          return (
            <div className="flex min-h-0 flex-1 flex-col px-5 pb-5">
              <label className="relative mb-3 block">
                <span className="sr-only">Search products</span>
                <LuSearch
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${isPurchased ? "bought" : "not bought"} products…`}
                  className="sl-input py-2 pl-9 text-sm"
                />
              </label>
              <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                {filtered.length === 0 ? (
                  <li className="sl-muted py-10 text-center text-sm">
                    {rawList.length === 0
                      ? `No ${isPurchased ? "recent purchases" : "gaps"} for this customer`
                      : "No products match your search"}
                  </li>
                ) : (
                  filtered.map((item) => {
                    const inactive = !item.isPurchasedWithin3Months && item.hasEverPurchased;
                    const tone = isPurchased
                      ? "sl-chip-success"
                      : inactive
                        ? "sl-chip-warning"
                        : "sl-chip-danger";
                    return (
                      <li
                        key={item.name}
                        className="flex min-h-[52px] items-center justify-between gap-3 border-b border-line-soft py-2 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink" title={item.name}>
                            {item.name}
                          </p>
                          <p className="sl-muted text-xs">
                            {item.hasEverPurchased && item.lastOrderDate
                              ? `Last ordered ${item.lastOrderDate.toLocaleDateString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })} · ${item.daysAgo}d ago`
                              : "Never ordered by this customer"}
                          </p>
                        </div>
                        <span className={`sl-chip ${tone} shrink-0 px-2.5 py-0.5 text-xs`}>
                          {isPurchased ? "Active" : inactive ? "Lapsed" : "Never bought"}
                        </span>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          );
        })()
      ) : loading && report.customers.length === 0 ? (
        <SkeletonRows rows={5} />
      ) : report.customers.length === 0 ? (
        <EmptyState
          icon={LuUsers}
          title="No customers yet"
          hint="Add customers and their orders to see who is buying what."
          action={{ label: "Add a customer", to: "/customers" }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-card-2 text-xs text-ink-subtle">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Customer
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-center font-medium"
                  title="Bought within the last 90 days"
                >
                  Bought ≤3 mo
                </th>
                <th scope="col" className="px-5 py-2.5 text-center font-medium">
                  Not bought
                </th>
              </tr>
            </thead>
            <tbody>
              {report.customers.map((row) => (
                <tr key={row.name} className="border-b border-line-soft last:border-b-0">
                  <td className="h-[52px] px-5">
                    <button
                      type="button"
                      onClick={() =>
                        setSelected({
                          customer: row.name,
                          type: row.purchasedProducts.length > 0 ? "purchased" : "notPurchased",
                        })
                      }
                      className="max-w-[220px] truncate text-left font-medium text-ink hover:text-accent"
                      title="View product breakdown"
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="px-3 text-center">
                    {row.purchasedProducts.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSelected({ customer: row.name, type: "purchased" })}
                        className="sl-chip sl-chip-success px-2.5 py-0.5 text-xs tabular-nums"
                        title={`View ${row.purchasedProducts.length} products ${row.name} bought recently`}
                      >
                        {row.purchasedProducts.length}
                      </button>
                    ) : (
                      <span className="text-ink-subtle tabular-nums">0</span>
                    )}
                  </td>
                  <td className="px-5 text-center">
                    {row.notPurchasedProducts.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSelected({ customer: row.name, type: "notPurchased" })}
                        className="sl-chip sl-chip-danger px-2.5 py-0.5 text-xs tabular-nums"
                        title={`View ${row.notPurchasedProducts.length} products ${row.name} has not bought recently`}
                      >
                        {row.notPurchasedProducts.length}
                      </button>
                    ) : (
                      <span className="text-ink-subtle tabular-nums">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashTile>
  );
};
