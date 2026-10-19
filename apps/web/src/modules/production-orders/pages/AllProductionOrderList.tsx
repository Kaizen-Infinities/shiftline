import React, { useState, useCallback, useEffect, useMemo } from "react";
import { toast } from "react-toastify";
import { usePageShortcuts } from "../../../hooks/usePageShortcuts";

import ViewButton from "../../../components/ui/viewbutton/ViewButton";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import DataTable from "../../../components/ui/table/DataTable";
import { History } from "lucide-react";
import { ActionPill, PageHeader, SearchField, Toolbar } from "../../../components/ui/v2";
import { PageBody, RowActions, formatQty } from "../../production/ui";
import { formatDate as formatDisplayDate } from "../../../utils/dateUtils";
import ExportCSVButton from "../../../components/ui/ExportCSVButton/ExportCSVButton";
import { useNavigate } from "react-router-dom";

import { productionOrderService } from "../../../services/productionOrderService";
import type { ProductionOrder } from "../../../services/productionOrderService";
import { rawMaterialService } from "../../../services/rawMaterialService";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { usePermission } from "../../../hooks/usePermission";

const ITEMS_PER_PAGE = 15;

const AllProductionOrderList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const [data, setData] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [rawMaterialsMap, setRawMaterialsMap] = useState<Map<string, any>>(new Map());

  const fetchRawMaterials = useCallback(async () => {
    try {
      const data = await rawMaterialService.fetchAll();
      const arr = Array.isArray(data) ? data : ((data as any)?.rawMaterials ?? []);
      const map = new Map<string, any>();
      arr.forEach((rm: any) => map.set(rm.rawMaterialId?.toString(), rm));
      setRawMaterialsMap(map);
    } catch (error) {
      console.error("Failed to fetch raw materials", error);
    }
  }, []);

  useEffect(() => {
    fetchRawMaterials();
  }, [fetchRawMaterials]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await productionOrderService.fetchAll({
        page: 1,
        pageSize: 1000,
        search: searchTerm || undefined,
        status: statusFilter || undefined,
      });

      setData(response.data || []);
      // We use groupedData length for pagination total now
    } catch (error: any) {
      console.error("❌ Fetch error:", error);
      toast.error(error?.response?.data?.message || "Failed to fetch orders");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useSocketSync("productionOrder", undefined, fetchOrders);

  usePageShortcuts({ onRefresh: () => fetchOrders() });

  const groupedData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const groupedPOs = data.reduce((acc: any, po: any) => {
      const parts = po.productionOrderId.split("-");
      const baseId = parts.length > 2 ? `${parts[0]}-${parts[1]}` : po.productionOrderId;

      if (!acc[baseId]) {
        acc[baseId] = {
          ...po,
          productionOrderId: baseId,
          items: [],
          totalProducts: 0,
          totalProductionQuantity: 0,
          productNames: new Set(),
        };
      }
      acc[baseId].items.push(po);
      acc[baseId].totalProducts += 1;
      acc[baseId].totalProductionQuantity += Number(po.targetQty) || 0;
      if (po.productItem?.productName) acc[baseId].productNames.add(po.productItem.productName);
      return acc;
    }, {});

    return Object.values(groupedPOs).map((group: any) => {
      const hasPending = group.items.some((po: any) => po.status === "RM_PENDING");
      return {
        ...group,
        status: hasPending && group.status !== "DRAFT" ? "RM_PENDING" : group.status,
        productNames: Array.from(group.productNames).join(", "),
      };
    });
  }, [data]);

  const handleOpenView = useCallback(
    (item: any) => {
      navigate(`/production-orders/history/view/${encodeURIComponent(item.productionOrderId)}`, {
        state: { order: item },
      });
    },
    [navigate]
  );

  const fetchOrdersForExport = useCallback(async () => {
    const response = await productionOrderService.fetchAll({
      page: 1,
      pageSize: 100000,
    });
    const list = response?.data || (Array.isArray(response) ? response : []);
    const groupedPOs = list.reduce((acc: any, po: any) => {
      const parts = po.productionOrderId.split("-");
      const baseId = parts.length > 2 ? `${parts[0]}-${parts[1]}` : po.productionOrderId;

      if (!acc[baseId]) {
        acc[baseId] = {
          ...po,
          productionOrderId: baseId,
          totalProducts: 0,
          totalProductionQuantity: 0,
        };
      }
      acc[baseId].totalProducts += 1;
      acc[baseId].totalProductionQuantity += Number(po.targetQty) || 0;
      return acc;
    }, {});

    return Object.values(groupedPOs);
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "PO No", accessor: (item: any) => item.productionOrderId || "" },
      { header: "Total Products", accessor: (item: any) => item.totalProducts ?? 1 },
      {
        header: "Total Qty",
        accessor: (item: any) => item.totalProductionQuantity ?? item.targetQty ?? 0,
      },
      {
        header: "Status",
        accessor: (item: any) =>
          item.status === "DISPATCHED" ? "COMPLETED" : item.status || "CREATED",
      },
      {
        header: "Created Date",
        accessor: (item: any) =>
          item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-IN") : "",
      },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Production_Order_History_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const formatDate = (dateStr: string) => (dateStr ? formatDisplayDate(dateStr) : "N/A");

  const totalPages = Math.max(1, Math.ceil(groupedData.length / ITEMS_PER_PAGE));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedGroups = groupedData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const STATUS_OPTIONS = [
    { label: "All Statuses", value: "" },
    { label: "Draft", value: "DRAFT" },
    { label: "Created", value: "CREATED" },
    { label: "Waiting For Material", value: "WAITING_FOR_MATERIAL" },
    { label: "Ready For Planning", value: "READY_FOR_PLANNING" },
    { label: "Weekly Scheduled", value: "WEEKLY_SCHEDULED" },
    { label: "Daily Planned", value: "DAILY_PLANNED" },
    { label: "In Progress", value: "IN_PROGRESS" },
    { label: "In Production", value: "IN_PRODUCTION" },
    { label: "Post Production", value: "POST_PRODUCTION" },
    { label: "Ready For Dispatch", value: "READY_FOR_DISPATCH" },
    { label: "Partially Dispatched", value: "PARTIAL_COMPLETED" },
    { label: "Completed With Shortfall", value: "COMPLETED_WITH_SHORTFALL" },
    { label: "Closed", value: "CLOSED" },
    { label: "Completed", value: "DISPATCHED" },
    { label: "Cancelled", value: "CANCELLED" },
  ];
  const QUICK_STATUSES = ["", "IN_PRODUCTION", "READY_FOR_DISPATCH", "DISPATCHED", "CANCELLED"];

  const columns = [
    {
      header: "PO no",
      render: (item: any) => (
        <button
          type="button"
          onClick={() => handleOpenView(item)}
          className="font-mono text-[13px] font-semibold text-accent underline-offset-4 hover:underline"
        >
          {item.productionOrderId}
        </button>
      ),
    },
    {
      header: "Products",
      width: "minmax(180px, 1fr)",
      render: (item: any) => (
        <div className="py-1">
          <span className="line-clamp-1 text-ink">{item.productNames || "—"}</span>
          <span className="sl-muted text-[12px]">
            {item.totalProducts ?? 1} product{(item.totalProducts ?? 1) === 1 ? "" : "s"}
          </span>
        </div>
      ),
    },
    {
      header: "Total qty",
      align: "right" as const,
      render: (item: any) => (
        <span className="font-semibold text-ink tabular-nums">
          {formatQty(item.totalProductionQuantity ?? item.targetQty)}
        </span>
      ),
    },
    {
      header: "Status",
      render: (item: any) => {
        const s = item.status || "CREATED";
        if (s === "DISPATCHED") {
          return <StatusBadge status="COMPLETED" customText="Completed" />;
        }
        return <StatusBadge status={s} />;
      },
    },
    {
      header: "Created",
      render: (item: any) => (
        <span className="text-ink-muted tabular-nums">{formatDate(item.createdAt)}</span>
      ),
    },
    {
      header: "Actions",
      align: "right" as const,
      render: (item: any) => (
        <RowActions>
          <ViewButton onClick={() => handleOpenView(item)} />
        </RowActions>
      ),
    },
  ];

  const isFiltered = Boolean(searchTerm || statusFilter);

  return (
    <PageBody>
      <PageHeader
        title="Order history"
        icon={<History size={22} />}
        subtitle={`Every production order, grouped by order number · ${groupedData.length} order${groupedData.length === 1 ? "" : "s"}`}
        breadcrumbs={[
          { label: "Production orders", to: "/production-orders" },
          { label: "History" },
        ]}
        actions={
          can("production_orders.export") ? (
            <ExportCSVButton
              fetchData={fetchOrdersForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : undefined
        }
      />

      <div>
        <Toolbar
          filters={QUICK_STATUSES.map((v) => ({
            key: v || "ALL",
            label: v ? STATUS_OPTIONS.find((o) => o.value === v)?.label : "All",
          }))}
          filterValue={
            QUICK_STATUSES.includes(statusFilter) ? statusFilter || "ALL" : ("__other" as string)
          }
          onFilterChange={(key) => {
            setStatusFilter(key === "ALL" ? "" : key);
            setCurrentPage(1);
          }}
          filtersLabel="Order status"
          right={
            <div className="w-[220px]">
              <SelectInput
                label=""
                hideLabel
                ariaLabel="Order status"
                name="statusFilter"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                options={STATUS_OPTIONS}
              />
            </div>
          }
        >
          <SearchField
            data-search-input
            value={searchTerm}
            onValueChange={(v) => {
              setSearchTerm(v);
              setCurrentPage(1);
            }}
            placeholder="Search orders..."
            label="Search production orders"
          />
        </Toolbar>

        <DataTable
          ariaLabel="Production order history"
          columns={columns}
          data={paginatedGroups}
          rowKey={(item) => item.productionOrderId}
          loading={loading}
          emptyMessage={
            isFiltered ? "No production orders match these filters." : "No production orders found."
          }
          emptyAction={
            isFiltered ? (
              <ActionPill
                variant="secondary"
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("");
                }}
              >
                Clear filters
              </ActionPill>
            ) : undefined
          }
          pagination={{
            currentPage,
            totalPages,
            onPageChange: (page) => setCurrentPage(page),
          }}
        />
      </div>
    </PageBody>
  );
};

export default AllProductionOrderList;
