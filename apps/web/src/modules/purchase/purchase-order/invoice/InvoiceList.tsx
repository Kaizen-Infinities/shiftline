import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import { ActionPill, PageHeader, Toolbar } from "../../../../components/ui/v2";
import { PAGE_CLASS } from "../../../sales/shared/tradeUi";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";
import { usePageShortcuts } from "../../../../hooks/usePageShortcuts";

import CancelReasonModal from "../../../../components/ui/CancelReasonModal/CancelReasonModal";
import HistoryLink from "../../../../components/ui/HistoryLink/HistoryLink";
import { grnInvoiceService } from "../../../../services/grnInvoiceService";
import ExportCSVButton from "../../../../components/ui/ExportCSVButton/ExportCSVButton";
import DataTable from "../../../../components/ui/table/DataTable";
import ViewButton from "../../../../components/ui/viewbutton/ViewButton";
import DeleteButton from "../../../../components/ui/DeleteButton/DeleteButton";
import EditButton from "../../../../components/ui/EditButton/EditButton";
import StatusBadge from "../../../../components/ui/StatusBadge/Badge";
import { useListCache } from "../../../../hooks/useListCache";
import { usePermission } from "../../../../hooks/usePermission";

const ITEMS_PER_PAGE = 15;

// ─── Formatting helpers ─────────────────────────────────────────────────
const formatMoney = (val: string | number | null | undefined) => {
  const n = Number(val ?? 0);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (val: string | null | undefined) => {
  if (!val) return "—";
  return new Date(val).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const calculatePendingAmount = (item: any) => {
  const status = (item.paymentStatus || "").toUpperCase();
  if (status === "CLOSED" || status === "PAID") return 0;
  const net = Number(item.netAmount || 0);
  const rawPayments = Array.isArray(item.payments)
    ? item.payments
    : typeof item.payments === "string"
      ? JSON.parse(item.payments || "[]")
      : [];
  const paid = rawPayments.reduce((sum: number, p: any) => sum + Number(p?.amount || 0), 0);
  const pending = net - paid;
  return pending > 0 ? pending : 0;
};

const InvoiceList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const fetchInvoicesForExport = useCallback(async () => {
    const response = await grnInvoiceService.fetchAll({ page: 1, pageSize: 100000 });
    const list = response?.data || (Array.isArray(response) ? response : []);
    return Array.isArray(list) ? list : [];
  }, []);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const response = await grnInvoiceService.fetchAll({ pageSize: 10000 });
    const list = response?.data || (Array.isArray(response) ? response : []);
    return { data: list, total: response?.total || list.length };
  }, []);

  const {
    data: allInvoices,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "grnInvoices:list",
    socketModule: "grnInvoice",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const filteredData = useMemo(() => {
    if (!searchTerm) return allInvoices;
    const term = searchTerm.toLowerCase();
    return allInvoices.filter(
      (item: any) =>
        item.grnNumber?.toLowerCase().includes(term) ||
        item.invoiceNo?.toLowerCase().includes(term) ||
        item.supplier?.legalName?.toLowerCase().includes(term)
    );
  }, [allInvoices, searchTerm]);

  const data = filteredData.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const handleDeleteClick = (id: string) => {
    setItemToDelete(id);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async (reason: string) => {
    if (itemToDelete === null) return;

    try {
      await grnInvoiceService.cancel(itemToDelete, reason);
      toast.success("GRN cancelled; its ledger entries were reversed.");
      setShowDeleteModal(false);
      setItemToDelete(null);
      refresh();
    } catch (error: any) {
      console.error("❌ Delete error:", error);
      toast.error(error?.response?.data?.message || "Failed to cancel invoice");
    }
  };

  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);

  // CSV Export Configuration
  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "GRN No", accessor: (item: any) => item.grnNumber || "" },
      { header: "Invoice No", accessor: (item: any) => item.invoiceNo || "" },
      { header: "GRN Date", accessor: (item: any) => formatDate(item.grnDate) },
      {
        header: "Supplier",
        accessor: (item: any) => item.supplier?.displayName || item.supplier?.legalName || "",
      },
      { header: "Net Amount", accessor: (item: any) => Number(item.netAmount || 0).toFixed(2) },
      { header: "Payment Status", accessor: (item: any) => item.paymentStatus || "—" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Bill_Invoice_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const createButton = can("invoice.create") ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/invoice/create")}>
      Receive Goods
    </ActionPill>
  ) : null;

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Bill & Invoice List"
        subtitle={`${(allInvoices?.length || 0).toLocaleString("en-IN")} GRN invoice${allInvoices?.length === 1 ? "" : "s"} · supplier bills booked against goods received`}
        primaryAction={createButton}
        actions={
          can("invoice.export") ? (
            <ExportCSVButton
              fetchData={fetchInvoicesForExport}
              columns={csvColumns}
              filename={csvFilename}
              text="Export"
            />
          ) : null
        }
      />

      <Toolbar
        searchValue={searchTerm}
        onSearchChange={(v) => {
          setSearchTerm(v);
          setCurrentPage(1);
        }}
        searchPlaceholder="Search GRN, bill no or supplier"
        searchLabel="Search GRN invoices"
      />

      <DataTable
        error={listError}
        onRetry={refresh}
        data={data}
        rowKey={(item) => item.id}
        loading={loading}
        ariaLabel="GRN invoices"
        emptyMessage={searchTerm ? `No invoices match "${searchTerm}".` : "No supplier bills yet."}
        emptyAction={searchTerm ? undefined : createButton}
        pagination={{
          currentPage,
          totalPages,
          onPageChange: (page) => setCurrentPage(page),
        }}
        columns={[
          {
            header: "#",
            width: "56px",
            render: (_item, index) => (
              <span className="tabular-nums text-ink-subtle">
                {(currentPage - 1) * ITEMS_PER_PAGE + index + 1}
              </span>
            ),
          },
          {
            header: "GRN no",
            render: (item) => (
              <button
                type="button"
                onClick={() => navigate(`/invoice/details/${item.id}`)}
                className="font-semibold text-accent hover:underline underline-offset-4"
              >
                {item.grnNumber}
              </button>
            ),
          },
          {
            header: "Bill no",
            render: (item) => <span className="text-ink-muted">{item.invoiceNo || "—"}</span>,
          },
          {
            header: "GRN date",
            render: (item) => (
              <span className="tabular-nums text-ink-muted">{formatDate(item.grnDate)}</span>
            ),
          },
          {
            header: "Supplier",
            render: (item) => (
              <span className="font-medium text-ink">
                {item.supplier?.displayName || item.supplier?.legalName || "N/A"}
              </span>
            ),
          },
          {
            header: "Net amount",
            align: "right",
            render: (item) => (
              <span className="font-semibold tabular-nums text-ink">
                {formatMoney(item.netAmount)}
              </span>
            ),
          },
          {
            header: "Status",
            render: (item) =>
              String(item.status || "").toUpperCase() === "CANCELLED" ? (
                <StatusBadge status="CANCELLED" />
              ) : (
                <StatusBadge status="POSTED" customText="Posted" tone="success" />
              ),
          },
          {
            header: "Actions",
            align: "right",
            render: (item) => {
              return (
                <div className="flex items-center justify-end gap-1.5">
                  <ViewButton onClick={() => navigate(`/invoice/details/${item.id}`)} />
                  {String(item.status || "").toUpperCase() !== "CANCELLED" && (
                    <EditButton onClick={() => navigate(`/invoice/edit/${item.id}`)} />
                  )}
                  {String(item.status || "").toUpperCase() !== "CANCELLED" && (
                    <DeleteButton onClick={() => handleDeleteClick(item.id)} />
                  )}
                  <HistoryLink entity="grn_invoices" entityId={item.id} />
                </div>
              );
            },
          },
        ]}
      />

      {/* Cancel with reason (P1-10d): the GRN stays in the books as CANCELLED. */}
      <CancelReasonModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Cancel this GRN / invoice?"
        confirmText="Cancel GRN"
      />
    </div>
  );
};

export default InvoiceList;
