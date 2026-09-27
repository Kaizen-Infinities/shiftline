import React, { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  LuArrowDownLeft,
  LuArrowUpRight,
  LuBanknote,
  LuBell,
  LuCalendarCheck,
  LuChevronRight,
  LuCircleAlert,
  LuCircleCheck,
  LuFileText,
  LuHandCoins,
  LuInfo,
  LuLandmark,
  LuReceipt,
  LuShoppingCart,
  LuTriangleAlert,
} from "react-icons/lu";
import { usePageSocketSync } from "../../../hooks/usePageSocketSync";
import dashboardService, { type AccountsSummary } from "../../../services/dashboardService";
import { useListCache } from "../../../hooks/useListCache";
import { usePermission } from "../../../hooks/usePermission";
import SalesPurchaseTrendChart from "../components/SalesPurchaseTrendChart";
import { SalesPersonLiveMap } from "../components/SalesPersonLiveMap";
import { InventoryStockIntelligence } from "../components/InventoryStockIntelligence";
import { WorkforceShiftAttendance } from "../components/WorkforceShiftAttendance";
import { WelcomeHeader, type DashPeriod } from "../components/WelcomeHeader";
import { QuickActions } from "../components/QuickActions";
import { TopProductsTile } from "../components/TopProductsTile";
import { CustomerPurchaseReport } from "../components/CustomerPurchaseReport";
import {
  DashTile,
  TileHeader,
  EmptyState,
  SkeletonRows,
  StatTile,
  StatTileSkeleton,
  TileLink,
  type Trend,
} from "../components/DashboardPrimitives";
import { inr, plural, statusChipClass, voucherTypeTone } from "../components/dashboardFormat";

/* ════════════════════════════════════════════════════════════════
   HOME DASHBOARD (UI v2)
   Greeting → role-aware quick actions → money overview → trend and
   alerts → today's work → books → customers and field team → stock.
   Every widget keeps its data call, socket refresh and permission gate;
   the layout is white tiles on the pale page, with skeleton slabs while
   loading and a friendly line plus the next step when a list is empty.
   ════════════════════════════════════════════════════════════════ */

const PERIOD_LABEL: Record<DashPeriod, string> = {
  day: "today",
  week: "this week",
  month: "this month",
  year: "this year",
};

// Dashboard period → SalesPurchaseTrendChart bucket size.
const TREND_PERIOD: Record<DashPeriod, "7d" | "30d" | "90d" | "12m"> = {
  day: "7d",
  week: "30d",
  month: "90d",
  year: "12m",
};

const safe = (d: any) => (Array.isArray(d) ? d : []);

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { can, isSuperAdmin } = usePermission();

  const [dashPeriod, setDashPeriod] = useState<DashPeriod>(() => {
    try {
      const saved = localStorage.getItem("dashboard_period");
      if (saved && ["day", "week", "month", "year"].includes(saved)) return saved as DashPeriod;
    } catch {}
    return "year";
  });

  const handleDashPeriodChange = (p: DashPeriod) => {
    setDashPeriod(p);
    try {
      localStorage.setItem("dashboard_period", p);
    } catch {}
  };

  // Widget visibility — super admin always sees everything.
  const showOverview = isSuperAdmin || can("dash-overview.view");
  const showTrend = isSuperAdmin || can("dash-trend.view");
  const showTasks = isSuperAdmin || can("dash-tasks.view");
  const showInventory = isSuperAdmin || can("dash-inventory.view");
  const showTopProducts = isSuperAdmin || can("dash-top-products.view");
  const showRecentSales = isSuperAdmin || can("dash-recent-sales.view");

  /* ── Dashboard summary — cache-first; sockets refresh it in the background ── */
  const dashboardFetcher = useCallback(async (_signal: AbortSignal) => {
    const data = await dashboardService.getSummary();
    return { data: [data], total: 1 };
  }, []);

  const dashboardCache = useListCache<any>({
    cacheKey: "dashboard:summary",
    socketModule: "salesOrder",
    fetcher: dashboardFetcher,
  });
  const dashData = dashboardCache.data[0] || {};
  const summaryLoading = dashboardCache.loading;

  const salesOrders = dashData.salesOrders || [];
  const purchaseOrders = dashData.purchaseOrders || [];
  const productionOrders = dashData.productionOrders || [];
  const dailyPlans = dashData.dailyPlans || [];
  const finishedGoodsStocks = dashData.finishedGoodsStocks || [];
  const rawMaterialStocks = dashData.rawMaterialStocks || [];
  const weeklyPrograms = dashData.weeklyPrograms || [];
  const rawMaterials = dashData.rawMaterials || [];
  const allProducts = dashData.products || [];
  const allSalesProducts = dashData.salesProducts || [];
  const allCustomers = dashData.customers || [];
  const employeesCount = dashData.employeesCount || 0;
  const salesInvoices = dashData.salesInvoices || [];
  const purchaseInvoices = dashData.purchaseInvoices || [];

  // One 300 ms debounce across every module that feeds the summary.
  usePageSocketSync(
    [
      "purchaseOrder",
      "productionOrder",
      "dailyPlan",
      "finishedGoodsStock",
      "rawMaterialStock",
      "salesOrder",
      "salesInvoice",
      "grnInvoice",
    ],
    dashboardCache.refresh
  );

  /* ── Accounts summary: stat tiles, alerts and recent transactions ── */
  const accountsSummaryFetcher = useCallback(
    async (_signal: AbortSignal) => {
      const summary = await dashboardService.getAccountsSummary(dashPeriod);
      return { data: [summary], total: 1 };
    },
    [dashPeriod]
  );

  const accountsSummaryCache = useListCache<AccountsSummary>({
    cacheKey: `accounts:dashboard-summary:${dashPeriod}`,
    socketModule: "voucher",
    fetcher: accountsSummaryFetcher,
  });
  const accountsSummary = accountsSummaryCache.data[0] || null;
  const accountsLoading = accountsSummaryCache.loading && !accountsSummary;

  usePageSocketSync(
    ["payment", "journalItem", "accountLedger", "salesInvoice", "grnInvoice", "pettyCashEntry"],
    accountsSummaryCache.refresh
  );

  /* ── Stat tile trends: latest voucher of a type vs the one before it ── */
  const cardTrends = useMemo(() => {
    const neutral: Trend = "neutral";
    if (!accountsSummary)
      return {
        sales: neutral,
        purchase: neutral,
        receivable: neutral,
        payable: neutral,
        cash: neutral,
      };
    const txns = accountsSummary.recentTransactions || [];
    const getTrend = (type: string): Trend => {
      const filtered = txns.filter((t) => t.type === type);
      if (filtered.length < 2) return "neutral";
      return filtered[0].amount >= filtered[1].amount ? "up" : "down";
    };
    const cash: Trend =
      accountsSummary.todayReceipts > accountsSummary.todayPayments
        ? "up"
        : accountsSummary.todayReceipts < accountsSummary.todayPayments
          ? "down"
          : "neutral";
    return {
      sales: getTrend("SALES"),
      purchase: getTrend("PURCHASE"),
      receivable: getTrend("RECEIPT"),
      payable: getTrend("PAYMENT"),
      cash,
    };
  }, [accountsSummary]);

  /* ── Today's daily production plans ── */
  const todayPlans = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return safe(dailyPlans).filter((p: any) => {
      const raw = p.productionDate || p.date || p.createdAt;
      if (!raw) return false;
      const d = new Date(raw);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    });
  }, [dailyPlans]);

  /* ── Top products by finished-goods stock ── */
  const topProducts = useMemo(() => {
    const grouped = safe(finishedGoodsStocks).reduce((acc: Record<string, number>, curr: any) => {
      const name = curr.product?.productName || curr.productItem?.productName || "Unknown";
      acc[name] = (acc[name] || 0) + (Number(curr.onHandQty) || 0);
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value: value as number }))
      .filter((p) => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 7);
  }, [finishedGoodsStocks]);

  /* ── Latest five sales orders ── */
  const recentSales = useMemo(
    () =>
      [...safe(salesOrders)]
        .sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        )
        .slice(0, 5),
    [salesOrders]
  );

  const alerts = accountsSummary?.alerts ?? [];
  const transactions = accountsSummary?.recentTransactions ?? [];
  const showAccountsTiles = !!accountsSummary || accountsLoading;

  return (
    <div className="flex w-full flex-col gap-8 pb-10">
      <WelcomeHeader
        period={dashPeriod}
        onPeriodChange={handleDashPeriodChange}
        syncing={accountsSummaryCache.refreshing}
      />

      <QuickActions />

      {/* ── MONEY OVERVIEW ─────────────────────────────────────── */}
      {showOverview && showAccountsTiles && (
        <section aria-labelledby="dash-overview" className="flex flex-col gap-3">
          <h2 id="dash-overview" className="sl-section-label">
            Money · {PERIOD_LABEL[dashPeriod]}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6">
            {!accountsSummary ? (
              Array.from({ length: 6 }).map((_, i) => <StatTileSkeleton key={i} />)
            ) : (
              <>
                <StatTile
                  label="Total sales"
                  value={inr(accountsSummary.totalSales)}
                  icon={LuArrowUpRight}
                  tone="sales"
                  trend={cardTrends.sales}
                  note={plural(accountsSummary.salesVoucherCount, "voucher")}
                  onClick={() => navigate("/sales-invoices")}
                />
                <StatTile
                  label="Total purchase"
                  value={inr(accountsSummary.totalPurchase)}
                  icon={LuArrowDownLeft}
                  tone="purchase"
                  trend={cardTrends.purchase}
                  note={plural(accountsSummary.purchaseVoucherCount, "voucher")}
                  onClick={() => navigate("/invoice")}
                />
                <StatTile
                  label="Receivable"
                  value={
                    <>
                      {inr(accountsSummary.totalReceivable)}
                      {accountsSummary.totalReceivable < 0 && (
                        <span className="ml-1.5 align-middle text-sm font-semibold text-ink-subtle">
                          Cr
                        </span>
                      )}
                    </>
                  }
                  icon={LuHandCoins}
                  tone="sales"
                  trend={cardTrends.receivable}
                  note={plural(accountsSummary.receivableCustomerCount, "customer")}
                  onClick={() => navigate("/accounts/receivable")}
                />
                <StatTile
                  label="Payable"
                  value={
                    <>
                      {inr(accountsSummary.totalPayable)}
                      {accountsSummary.totalPayable < 0 && (
                        <span className="ml-1.5 align-middle text-sm font-semibold text-ink-subtle">
                          Dr
                        </span>
                      )}
                    </>
                  }
                  icon={LuFileText}
                  tone="purchase"
                  upIsGood={false}
                  trend={cardTrends.payable}
                  note={plural(accountsSummary.payableSupplierCount, "supplier")}
                  onClick={() => navigate("/accounts/payable")}
                />
                <StatTile
                  label="Cash in hand"
                  value={inr(accountsSummary.totalCashInHand)}
                  icon={LuBanknote}
                  tone="cash"
                  trend={cardTrends.cash}
                  note={plural(accountsSummary.cashAccountCount, "account")}
                  onClick={() => navigate("/accounts/bank-accounts?filter=cash")}
                />
                <StatTile
                  label="Bank balance"
                  value={inr(accountsSummary.totalBankBalance)}
                  icon={LuLandmark}
                  tone="cash"
                  trend={cardTrends.cash}
                  note={plural(accountsSummary.bankAccountCount, "account")}
                  onClick={() => navigate("/accounts/bank-accounts?filter=bank")}
                />
              </>
            )}
          </div>
        </section>
      )}

      {/* ── TREND + ALERTS ─────────────────────────────────────── */}
      {(showTrend || showAccountsTiles) && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {showTrend && (
            <SalesPurchaseTrendChart
              className={showAccountsTiles ? "lg:col-span-2" : "lg:col-span-3"}
              salesOrders={salesOrders}
              purchaseOrders={purchaseOrders}
              productionOrders={productionOrders}
              salesInvoices={salesInvoices}
              purchaseInvoices={purchaseInvoices}
              externalPeriod={TREND_PERIOD[dashPeriod]}
              loading={summaryLoading}
            />
          )}

          {showAccountsTiles && (
            <DashTile
              labelledBy="dash-alerts"
              className={`max-h-[560px] ${showTrend ? "" : "lg:col-span-3"}`}
            >
              <TileHeader
                id="dash-alerts"
                icon={LuBell}
                title="Needs attention"
                tone={
                  alerts.some((a) => a.level === "danger")
                    ? "danger"
                    : alerts.length > 0
                      ? "warning"
                      : "accent"
                }
                subtitle="Alerts from your books"
                actions={
                  alerts.length > 0 ? (
                    <span className="sl-chip sl-chip-danger px-2.5 py-0.5 text-xs">
                      {alerts.length} open
                    </span>
                  ) : accountsSummary ? (
                    <span className="sl-chip sl-chip-success px-2.5 py-0.5 text-xs">All clear</span>
                  ) : null
                }
              />
              {!accountsSummary ? (
                <SkeletonRows rows={3} />
              ) : alerts.length === 0 ? (
                <EmptyState
                  icon={LuCircleCheck}
                  tone="success"
                  title="All clear"
                  hint="Nothing needs your attention right now. Overdue bills and low balances show up here."
                />
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 pb-5">
                  {alerts.map((a, i) => {
                    const Icon =
                      a.level === "danger"
                        ? LuCircleAlert
                        : a.level === "warn"
                          ? LuTriangleAlert
                          : LuInfo;
                    const tone =
                      a.level === "danger"
                        ? "sl-chip-danger"
                        : a.level === "warn"
                          ? "sl-chip-warning"
                          : "sl-chip";
                    const body = (
                      <>
                        <span
                          aria-hidden="true"
                          className={`sl-chip ${tone} grid h-8 w-8 shrink-0 place-items-center p-0`}
                        >
                          <Icon />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm leading-snug font-medium text-ink">
                            {a.message}
                          </span>
                          {a.details && a.details.length > 0 && (
                            <span className="mt-1.5 flex flex-col gap-1">
                              {a.details.map((d, di) => (
                                <span
                                  key={di}
                                  className="flex items-center justify-between gap-2 text-xs text-ink-subtle"
                                >
                                  <span className="truncate">{d.name}</span>
                                  <span className="font-semibold whitespace-nowrap text-ink tabular-nums">
                                    {d.amount}
                                  </span>
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        {a.link && (
                          <LuChevronRight
                            aria-hidden="true"
                            className="mt-1 shrink-0 text-ink-subtle"
                          />
                        )}
                      </>
                    );
                    return (
                      <li key={i}>
                        {a.link ? (
                          <button
                            type="button"
                            onClick={() => navigate(a.link!)}
                            className="flex w-full items-start gap-3 rounded-[14px] bg-card-2 p-3 text-left transition-colors hover:bg-nav-active"
                          >
                            {body}
                          </button>
                        ) : (
                          <div className="flex items-start gap-3 rounded-[14px] bg-card-2 p-3">
                            {body}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </DashTile>
          )}
        </div>
      )}

      {/* ── TODAY ──────────────────────────────────────────────── */}
      {(showTasks || showRecentSales || showTopProducts) && (
        <section aria-labelledby="dash-today" className="flex flex-col gap-3">
          <h2 id="dash-today" className="sl-section-label">
            Today
          </h2>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {showTasks && (
              <DashTile labelledBy="dash-tasks" className="min-h-[360px]">
                <TileHeader
                  id="dash-tasks"
                  icon={LuCalendarCheck}
                  title="Today's production"
                  tone="production"
                  subtitle="Machine plans scheduled for today"
                  actions={
                    todayPlans.length > 0 ? (
                      <TileLink to="/daily-machine-planning">All plans →</TileLink>
                    ) : null
                  }
                />
                {summaryLoading && todayPlans.length === 0 ? (
                  <SkeletonRows rows={3} />
                ) : todayPlans.length === 0 ? (
                  <EmptyState
                    icon={LuCalendarCheck}
                    title="Nothing planned for today"
                    hint="Plan machines, shifts and products for the day and they will line up here."
                    action={
                      can("daily-machine-planning.create")
                        ? { label: "Plan production", to: "/daily-production-plans/create" }
                        : can("daily-machine-planning.view")
                          ? { label: "Open planning", to: "/daily-machine-planning" }
                          : null
                    }
                  />
                ) : (
                  <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4">
                    {todayPlans.map((task: any, i: number) => {
                      const linkedPo = safe(productionOrders).find(
                        (po: any) =>
                          po.productionOrderId === task.productionOrderId ||
                          po.id === task.productionOrderId
                      );
                      const productName =
                        task.product?.productName ||
                        task.productName ||
                        task.productionOrder?.productItem?.productName ||
                        task.productionOrder?.product?.productName ||
                        linkedPo?.productItem?.productName ||
                        linkedPo?.product?.productName ||
                        linkedPo?.productName ||
                        "No product linked";
                      const machineName =
                        task.machine?.machineName ||
                        task.machineName ||
                        task.weeklyProgram?.machine?.machineName ||
                        `Plan #${task.dailyPlanId || task.id || i + 1}`;
                      const shiftName =
                        task.shift?.shiftName ||
                        task.shiftName ||
                        task.weeklyProgram?.shift?.shiftName ||
                        "General shift";
                      const status = String(task.status || "SCHEDULED");
                      return (
                        <li
                          key={task.id || i}
                          className="border-b border-line-soft last:border-b-0"
                        >
                          <Link
                            to="/daily-machine-planning"
                            className="group flex min-h-[56px] items-center gap-3 py-2"
                          >
                            <span className="sl-tone-production grid h-10 w-10 shrink-0 place-items-center rounded-[12px]">
                              <LuCalendarCheck aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-ink">
                                {machineName}
                              </span>
                              <span className="block truncate text-xs text-ink-subtle">
                                {productName} · {shiftName}
                              </span>
                            </span>
                            <span
                              className={`sl-chip ${statusChipClass(status)} shrink-0 px-2.5 py-0.5 text-[11px] capitalize`}
                            >
                              {status.replace(/_/g, " ").toLowerCase()}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DashTile>
            )}

            {showRecentSales && (
              <DashTile labelledBy="dash-recent-sales" className="min-h-[360px]">
                <TileHeader
                  id="dash-recent-sales"
                  icon={LuShoppingCart}
                  title="Recent sales orders"
                  tone="sales"
                  subtitle={
                    recentSales.length > 0 ? `Latest ${recentSales.length}` : "Newest first"
                  }
                  actions={
                    recentSales.length > 0 ? (
                      <TileLink to="/sales-order">View all →</TileLink>
                    ) : null
                  }
                />
                {summaryLoading && recentSales.length === 0 ? (
                  <SkeletonRows rows={4} />
                ) : recentSales.length === 0 ? (
                  <EmptyState
                    icon={LuShoppingCart}
                    title="No sales orders yet"
                    hint="Orders you book appear here with their value and status."
                    action={
                      can("sales-orders.create")
                        ? { label: "New sales order", to: "/sales-order/create" }
                        : null
                    }
                  />
                ) : (
                  <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4">
                    {recentSales.map((so: any, i: number) => {
                      const custName =
                        so.customer?.firmName ||
                        so.customer?.displayName ||
                        so.customerName ||
                        "Customer";
                      const status = String(so.status || "DRAFT");
                      return (
                        <li
                          key={so.id || so.salesOrderId || i}
                          className="border-b border-line-soft last:border-b-0"
                        >
                          <Link
                            to={`/sales-order/details/${so.id || so.salesOrderId || ""}`}
                            className="flex min-h-[56px] items-center gap-3 py-2"
                          >
                            <span
                              aria-hidden="true"
                              className="sl-tone-sales grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-sm font-bold"
                            >
                              {custName.trim().charAt(0).toUpperCase() || "C"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-ink">
                                {custName}
                              </span>
                              <span className="block truncate text-xs text-ink-subtle">
                                {so.orderNo || `SO-${so.id}`}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <span className="text-sm font-semibold text-ink tabular-nums">
                                ₹{Number(so.netAmount || 0).toLocaleString("en-IN")}
                              </span>
                              <span
                                className={`sl-chip ${statusChipClass(status)} px-2 py-0 text-[11px] capitalize`}
                              >
                                {status.replace(/_/g, " ").toLowerCase()}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DashTile>
            )}

            {showTopProducts && (
              <TopProductsTile
                className="min-h-[360px] md:col-span-2 xl:col-span-1"
                products={topProducts}
                loading={summaryLoading}
              />
            )}
          </div>
        </section>
      )}

      {/* ── BOOKS + PEOPLE ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {showAccountsTiles && (
          <DashTile labelledBy="dash-transactions" className="xl:col-span-2">
            <TileHeader
              id="dash-transactions"
              icon={LuReceipt}
              title="Recent transactions"
              tone="cash"
              subtitle={`Vouchers posted ${PERIOD_LABEL[dashPeriod]}`}
              actions={<TileLink to="/accounts/ledger-statement">Ledger statement →</TileLink>}
            />
            {!accountsSummary ? (
              <SkeletonRows rows={4} />
            ) : transactions.length === 0 ? (
              <EmptyState
                icon={LuReceipt}
                title={`No transactions ${PERIOD_LABEL[dashPeriod]}`}
                hint="Receipts, payments and invoices post here as soon as they are saved."
                action={
                  can("vouchers.view") || can("accounts.view")
                    ? { label: "Record a receipt", to: "/accounts/receipt-voucher/add" }
                    : null
                }
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-x-auto pb-2">
                <table className="w-full text-left text-sm">
                  <thead className="bg-card-2 text-xs text-ink-subtle">
                    <tr>
                      <th scope="col" className="px-5 py-2.5 font-medium">
                        Voucher
                      </th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium sm:table-cell">
                        Type
                      </th>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        Party / account
                      </th>
                      <th scope="col" className="hidden px-3 py-2.5 font-medium md:table-cell">
                        Date
                      </th>
                      <th scope="col" className="px-5 py-2.5 text-right font-medium">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} className="border-b border-line-soft last:border-b-0">
                        <td className="h-[52px] px-5 font-medium whitespace-nowrap text-ink">
                          {t.voucherNo}
                        </td>
                        <td className="hidden px-3 sm:table-cell">
                          <span
                            className={`sl-chip ${voucherTypeTone(t.type)} px-2.5 py-0 text-[11px] capitalize`}
                          >
                            {String(t.type).toLowerCase()}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-3 text-ink-muted">
                          {t.debitLedger || t.creditLedger || t.narration || "—"}
                        </td>
                        <td className="hidden px-3 whitespace-nowrap text-ink-subtle md:table-cell">
                          {new Date(t.date).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        <td className="px-5 text-right font-semibold whitespace-nowrap text-ink tabular-nums">
                          ₹
                          {Number(t.amount).toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashTile>
        )}

        <WorkforceShiftAttendance
          className={showAccountsTiles ? "" : "xl:col-span-3"}
          employeesCount={employeesCount}
          dailyPlans={dailyPlans}
          weeklyPrograms={weeklyPrograms}
        />
      </div>

      {/* ── CUSTOMERS + FIELD TEAM ─────────────────────────────── */}
      <section aria-labelledby="dash-customers" className="flex flex-col gap-3">
        <h2 id="dash-customers" className="sl-section-label">
          Customers and field team
        </h2>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CustomerPurchaseReport
            salesOrders={salesOrders}
            salesProducts={allSalesProducts}
            customers={allCustomers}
            loading={summaryLoading}
          />
          <div className="h-[420px]">
            <SalesPersonLiveMap />
          </div>
        </div>
      </section>

      {/* ── STOCK ──────────────────────────────────────────────── */}
      {showInventory && (
        <section aria-labelledby="dash-stock-label" className="flex flex-col gap-3">
          <h2 id="dash-stock-label" className="sl-section-label">
            Stock
          </h2>
          <InventoryStockIntelligence
            rawMaterials={rawMaterials}
            rawMaterialStocks={rawMaterialStocks}
            finishedGoodsStocks={finishedGoodsStocks}
            allProducts={allProducts}
          />
        </section>
      )}
    </div>
  );
};

export default DashboardPage;
