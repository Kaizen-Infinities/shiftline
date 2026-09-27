import React, { useState, useEffect, useCallback, useMemo } from "react";
import { usePageShortcuts } from "../../../../hooks/usePageShortcuts";
import { FaWhatsapp } from "react-icons/fa";
import { Plus } from "lucide-react";
import { ActionPill, PageHeader, Toolbar } from "../../../../components/ui/v2";
import { PAGE_CLASS, formatDateIN, formatINR } from "../../../sales/shared/tradeUi";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";

import ViewButton from "../../../../components/ui/viewbutton/ViewButton";
import EditButton from "../../../../components/ui/EditButton/EditButton";
import DeleteButton from "../../../../components/ui/DeleteButton/DeleteButton";
import CommonConfirmModal from "../../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import EmailButton from "../../../../components/ui/EmailButton/EmailButton";
import WhatsappButton from "../../../../components/ui/WhatsappButton/WhatsappButton";
import ExportCSVButton from "../../../../components/ui/ExportCSVButton/ExportCSVButton";

import IconButton from "../../../../components/ui/IconButton/IconButton";
import PurchaseOrderViewModal from "../components/PurchaseOrderViewModal";
import { usePermission } from "../../../../hooks/usePermission";
import { purchaseOrderService } from "../../../../services/purchaseOrderService";
import type { PurchaseOrder, PurchaseOrderStatus } from "../../../../features/purchaseOrder/types";
import { useListCache } from "../../../../hooks/useListCache";
import DataTable from "../../../../components/ui/table/DataTable";
import StatusBadge from "../../../../components/ui/StatusBadge/Badge";
import FilterPopover from "../../../../components/ui/FilterPopover/FilterPopover";
import TextInput from "../../../../components/form/TextInput/TextInput";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import { FiClipboard } from "react-icons/fi";

const ITEMS_PER_PAGE = 15;

const PurchaseOrderListPage: React.FC = () => {
  const navigate = useNavigate();

  const company = useSelector((state: any) => state.company.data);
  const { can } = usePermission();
  const canCreate = can("purchaseOrders.create");
  const canEdit = can("purchaseOrders.edit");
  const canDelete = can("purchaseOrders.delete");
  const canExport = can("purchaseOrders.export");
  const canSendWhatsappEmail =
    can("purchaseOrders.whatsapp-email") || can("purchaseOrders.whatsapp_email");

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | "">("");
  const [draftStatusFilter, setDraftStatusFilter] = useState<PurchaseOrderStatus | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [draftFromDate, setDraftFromDate] = useState("");
  const [draftToDate, setDraftToDate] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [poToDelete, setPoToDelete] = useState<string | number | null>(null);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailPo, setEmailPo] = useState<any | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  const [showWhatsappModal, setShowWhatsappModal] = useState(false);
  const [whatsappPo, setWhatsappPo] = useState<any | null>(null);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);

  const fetchPOsForExport = useCallback(async () => {
    const response = await purchaseOrderService.fetchAll({ page: 1, pageSize: 100000 });
    return Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
  }, []);

  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const response = await purchaseOrderService.fetchAll({ pageSize: 10000 });
    const list = Array.isArray(response?.data)
      ? response.data
      : Array.isArray(response)
        ? response
        : [];
    return { data: list, total: response?.total || list.length };
  }, []);

  const {
    data: allPurchaseOrders,
    loading,
    refresh,
    error: listError,
  } = useListCache<any>({
    cacheKey: "purchaseOrders:list",
    socketModule: "purchaseOrder",
    fetcher,
  });

  usePageShortcuts({ onRefresh: () => refresh(), onDelete: () => setShowDeleteModal(true) });

  const purchaseOrders = useMemo(() => {
    return allPurchaseOrders.filter((po: any) => {
      const matchesSearch =
        !searchTerm ||
        po.orderNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.supplier?.legalName?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = !statusFilter || po.status === statusFilter;
      const matchesFrom = !fromDate || (po.orderDate && po.orderDate >= fromDate);
      const matchesTo = !toDate || (po.orderDate && po.orderDate <= toDate);
      return matchesSearch && matchesStatus && matchesFrom && matchesTo;
    });
  }, [allPurchaseOrders, searchTerm, statusFilter, fromDate, toDate]);

  const totalPages = Math.ceil(purchaseOrders.length / ITEMS_PER_PAGE);
  const paginatedPOs = purchaseOrders.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const hasActiveFilters = !!(statusFilter || fromDate || toDate);
  const activeFilterCount = [statusFilter, fromDate, toDate].filter(Boolean).length;

  const handleOpenEmailModal = async (item: any) => {
    try {
      setSendingEmail(true);
      const fullItem = await purchaseOrderService.fetchById(item.id);
      setEmailPo(fullItem);
      setShowEmailModal(true);
    } catch (error: any) {
      toast.error("Failed to load PO details");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailPo) return;
    setSendingEmail(true);
    try {
      const recipientEmail = (emailPo.supplier as any)?.email;
      if (!recipientEmail) {
        toast.error("Supplier email is not available.");
        setSendingEmail(false);
        return;
      }
      const emailSubject = `Purchase Order Invoice - ${emailPo.poNumber}`;
      const emailMessage = `Dear ${emailPo.supplier?.supplierName || "Supplier"},\n\nPlease find the attached Purchase Order invoice for your reference.\n\nBest regards,\n${company?.companyName || "Company"}`;

      await purchaseOrderService.emailPoInvoice(emailPo.id, {
        to: recipientEmail,
        subject: emailSubject,
        message: emailMessage,
      });

      toast.success("Email sent successfully!");
      setShowEmailModal(false);
      setEmailPo(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleOpenWhatsappModal = async (item: any) => {
    try {
      setSendingWhatsapp(true);
      const fullItem = await purchaseOrderService.fetchById(item.id);
      setWhatsappPo(fullItem);

      let rPhone = "";
      if (fullItem.supplier?.mobile) {
        if (Array.isArray(fullItem.supplier.mobile) && fullItem.supplier.mobile.length > 0) {
          rPhone = fullItem.supplier.mobile[0].number || fullItem.supplier.mobile[0].value || "";
        } else if (typeof fullItem.supplier.mobile === "string") {
          rPhone = fullItem.supplier.mobile;
        }
      }
      setRecipientPhone(rPhone);

      setShowWhatsappModal(true);
    } catch (error: any) {
      toast.error("Failed to load PO details");
    } finally {
      setSendingWhatsapp(false);
    }
  };

  const handleSendWhatsapp = async () => {
    if (!whatsappPo || !recipientPhone) return;
    setSendingWhatsapp(true);
    try {
      const formattedPhone = recipientPhone.replace(/^\+/, "");
      const whatsappMessage = `Dear ${whatsappPo.supplier?.supplierName || "Supplier"},\n\nPlease find the attached Purchase Order ${whatsappPo.poNumber} for your reference.\n\nBest regards,\n${company?.companyName || "Company"}`;

      await purchaseOrderService.whatsappPO(whatsappPo.id, {
        to: formattedPhone,
        message: whatsappMessage,
      });

      toast.success("WhatsApp message sent successfully!");
      setShowWhatsappModal(false);
      setWhatsappPo(null);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to send WhatsApp message");
    } finally {
      setSendingWhatsapp(false);
    }
  };

  const handleApplyFilters = useCallback(() => {
    setStatusFilter(draftStatusFilter);
    setFromDate(draftFromDate);
    setToDate(draftToDate);
    setCurrentPage(1);
  }, [draftStatusFilter, draftFromDate, draftToDate]);

  const handleClearFilters = useCallback(() => {
    setDraftStatusFilter("");
    setDraftFromDate("");
    setDraftToDate("");
    setStatusFilter("");
    setFromDate("");
    setToDate("");
    setCurrentPage(1);
  }, []);

  const handleOpenFilter = useCallback(() => {
    setDraftStatusFilter(statusFilter);
    setDraftFromDate(fromDate);
    setDraftToDate(toDate);
  }, [statusFilter, fromDate, toDate]);

  const handleView = useCallback((po: PurchaseOrder) => {
    setSelectedPO(po);
    setShowViewModal(true);
  }, []);

  const handleEdit = useCallback(
    (po: PurchaseOrder) => {
      navigate(`/purchase-orders/edit/${po.id}`, { state: po });
    },
    [navigate]
  );

  const triggerDelete = useCallback((id: string | number) => {
    setPoToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const handleDeleteConfirm = async () => {
    if (!poToDelete) return;

    try {
      await purchaseOrderService.delete(String(poToDelete));
      toast.success("Purchase Order deleted successfully!");
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete purchase order");
    } finally {
      setShowDeleteModal(false);
      setPoToDelete(null);
    }
  };

  // CSV Export Configuration
  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "PO Number", accessor: (item: any) => item.poNumber || "" },
      {
        header: "PO Date",
        accessor: (item: any) =>
          item.poDate
            ? new Date(item.poDate).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              })
            : "",
      },
      { header: "Supplier", accessor: (item: any) => item.supplier?.supplierName || "" },
      { header: "Net Amount", accessor: (item: any) => Number(item.netAmount ?? 0).toFixed(2) },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Purchase_Orders_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const STATUS_LABEL: Record<string, string> = {
    DRAFT: "Draft",
    PENDING: "Pending",
    APPROVED: "Approved",
    PARTIALLY_RECEIVED: "Partially received",
    REJECTED: "Rejected",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  };
  const statusCounts: Record<string, number> = {};
  (allPurchaseOrders || []).forEach((po: any) => {
    const k = String(po.status || "");
    if (k) statusCounts[k] = (statusCounts[k] || 0) + 1;
  });
  const statusChips = [
    { key: "", label: "All", count: allPurchaseOrders?.length || 0 },
    ...Object.keys(STATUS_LABEL)
      .filter((k) => statusCounts[k])
      .map((k) => ({ key: k, label: STATUS_LABEL[k], count: statusCounts[k] })),
  ];
  const filtered = Boolean(searchTerm) || hasActiveFilters;

  const createButton = canCreate ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/purchase-orders/create")}>
      New Purchase Order
    </ActionPill>
  ) : null;

  return (
    <div className={PAGE_CLASS}>
      <div>
        <PageHeader
          title="Purchase Orders Management"
          subtitle={`${(allPurchaseOrders?.length || 0).toLocaleString("en-IN")} purchase order${allPurchaseOrders?.length === 1 ? "" : "s"} · approved orders are received against a GRN invoice`}
          primaryAction={createButton}
          actions={
            canExport ? (
              <ExportCSVButton
                fetchData={fetchPOsForExport}
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
            setPoToDelete(null);
          }}
          searchPlaceholder="Search PO no or supplier"
          searchLabel="Search purchase orders"
          filters={statusChips}
          filterValue={statusFilter}
          onFilterChange={(k) => {
            setStatusFilter(k as PurchaseOrderStatus | "");
            setDraftStatusFilter(k as PurchaseOrderStatus | "");
            setCurrentPage(1);
          }}
          filtersLabel="Purchase order status"
          right={
            <FilterPopover
              activeFilterCount={activeFilterCount}
              hasActiveFilters={hasActiveFilters}
              onApply={handleApplyFilters}
              onClear={handleClearFilters}
              onOpen={handleOpenFilter}
            >
              <div className="space-y-3">
                <TextInput
                  label="From Date"
                  name="draftFromDate"
                  type="date"
                  value={draftFromDate}
                  onChange={(e) => setDraftFromDate(e.target.value)}
                />
                <TextInput
                  label="To Date"
                  name="draftToDate"
                  type="date"
                  value={draftToDate}
                  onChange={(e) => setDraftToDate(e.target.value)}
                />
                <SelectInput
                  label="Status"
                  name="draftStatusFilter"
                  value={draftStatusFilter}
                  options={[
                    { value: "", label: "All Status" },
                    { value: "DRAFT", label: "Draft" },
                    { value: "PENDING", label: "Pending" },
                    { value: "APPROVED", label: "Approved" },
                    { value: "REJECTED", label: "Rejected" },
                    { value: "COMPLETED", label: "Completed" },
                    { value: "CANCELLED", label: "Cancelled" },
                  ]}
                  onChange={(e) => setDraftStatusFilter(e.target.value as PurchaseOrderStatus | "")}
                />
              </div>
            </FilterPopover>
          }
        />

        <DataTable
          error={listError}
          onRetry={refresh}
          data={paginatedPOs}
          rowKey={(item) => item.id}
          loading={loading}
          ariaLabel="Purchase orders"
          emptyMessage={
            filtered ? "No purchase orders match these filters." : "No purchase orders yet."
          }
          emptyAction={
            filtered ? (
              <button
                type="button"
                className="sl-btn sl-pill-md"
                onClick={() => {
                  setSearchTerm("");
                  handleClearFilters();
                }}
              >
                Clear filters
              </button>
            ) : (
              createButton
            )
          }
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
              header: "PO number",
              render: (item) => (
                <button
                  type="button"
                  onClick={() => handleView(item)}
                  className="font-semibold text-accent hover:underline underline-offset-4"
                >
                  {item.poNumber || "-"}
                </button>
              ),
            },
            {
              header: "PO date",
              render: (item) => (
                <span className="tabular-nums text-ink-muted">{formatDateIN(item.poDate)}</span>
              ),
            },
            {
              header: "Supplier",
              render: (item) => (
                <span className="font-medium text-ink">{item.supplier?.supplierName || "N/A"}</span>
              ),
            },
            {
              header: "Net amount",
              align: "right",
              render: (item) => (
                <span className="font-semibold tabular-nums text-ink">
                  {formatINR(item.netAmount ?? 0)}
                </span>
              ),
            },
            {
              header: "Status",
              render: (item) => <StatusBadge status={item.status} />,
            },
            {
              header: "Actions",
              align: "right",
              render: (item) => (
                <div className="flex items-center justify-end gap-1.5">
                  <ViewButton onClick={() => handleView(item)} />
                  {canEdit && item.status !== "COMPLETED" && item.status !== "CANCELLED" && (
                    <EditButton onClick={() => handleEdit(item)} />
                  )}
                  {item.status !== "REJECTED" &&
                    item.status !== "CANCELLED" &&
                    item.status !== "PENDING" &&
                    item.status !== "DRAFT" && (
                      <>
                        <IconButton
                          icon={FiClipboard}
                          variant="info"
                          title="PO Invoice"
                          onClick={() => navigate(`/po-invoice/${item.id}`)}
                        />
                        {canSendWhatsappEmail && (
                          <EmailButton
                            onClick={() => handleOpenEmailModal(item)}
                            disabled={sendingEmail && emailPo?.id === item.id}
                          />
                        )}
                        {canSendWhatsappEmail && (
                          <WhatsappButton
                            onClick={() => handleOpenWhatsappModal(item)}
                            disabled={sendingWhatsapp && whatsappPo?.id === item.id}
                          />
                        )}
                      </>
                    )}
                  {canDelete && item.status === "DRAFT" && (
                    <DeleteButton onClick={() => triggerDelete(item.id)} />
                  )}
                </div>
              ),
            },
          ]}
        />

        {/* Modals */}
        <PurchaseOrderViewModal
          show={showViewModal}
          onHide={() => setShowViewModal(false)}
          purchaseOrder={selectedPO}
        />

        <CommonConfirmModal
          show={showDeleteModal}
          title="Delete Purchase Order"
          message="Are you sure you want to delete this purchase order? This action cannot be undone."
          confirmText="Delete"
          confirmVariant="danger"
          isDangerous={true}
          onConfirm={handleDeleteConfirm}
          onHide={() => setShowDeleteModal(false)}
        />

        {/* Email Confirmation Modal */}
        <CommonConfirmModal
          show={showEmailModal}
          title="Send Email"
          message={`Are you sure you want to send the PO Invoice for ${emailPo?.poNumber} to ${(emailPo?.supplier as any)?.email || "the supplier"}?`}
          confirmText={sendingEmail ? "Sending..." : "Send Email"}
          confirmVariant="primary"
          onConfirm={handleSendEmail}
          onHide={() => setShowEmailModal(false)}
        />

        <CommonConfirmModal
          show={showWhatsappModal}
          title="Send WhatsApp"
          message={
            <div className="text-left mt-2 flex flex-col gap-3">
              <p className="text-sm text-ink-subtle mb-2">
                Are you sure you want to send the Purchase Order via WhatsApp?
              </p>
              <div>
                <label className="block text-sm font-medium text-ink-muted mb-1">
                  Phone Number (with country code, e.g. 919876543210)
                </label>
                {(() => {
                  const phones = [];
                  if (whatsappPo?.supplier) {
                    if (Array.isArray(whatsappPo.supplier.mobile)) {
                      whatsappPo.supplier.mobile.forEach((m: any) => {
                        if (m.number || m.value)
                          phones.push({ label: m.label || "Mobile", number: m.number || m.value });
                      });
                    } else if (
                      typeof whatsappPo.supplier.mobile === "string" &&
                      whatsappPo.supplier.mobile
                    ) {
                      phones.push({ label: "Mobile", number: whatsappPo.supplier.mobile });
                    }
                    if (
                      typeof whatsappPo.supplier.altPhone === "string" &&
                      whatsappPo.supplier.altPhone
                    ) {
                      phones.push({ label: "Alternative", number: whatsappPo.supplier.altPhone });
                    }
                  }

                  if (phones.length > 1) {
                    return (
                      <select
                        className="sl-input h-11 w-full text-sm"
                        value={recipientPhone}
                        onChange={(e) => setRecipientPhone(e.target.value)}
                      >
                        {phones.map((p, idx) => (
                          <option key={idx} value={p.number}>
                            {p.label ? `${p.label} (${p.number})` : p.number}
                          </option>
                        ))}
                      </select>
                    );
                  }
                  return (
                    <input
                      type="text"
                      className="sl-input h-11 w-full text-sm"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                    />
                  );
                })()}
              </div>
            </div>
          }
          confirmText={sendingWhatsapp ? "Sending..." : "Send WhatsApp"}
          confirmIcon={FaWhatsapp}
          confirmVariant="primary"
          onConfirm={handleSendWhatsapp}
          onHide={() => setShowWhatsappModal(false)}
        />
      </div>
    </div>
  );
};

export default PurchaseOrderListPage;
