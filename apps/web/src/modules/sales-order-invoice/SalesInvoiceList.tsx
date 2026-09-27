import React, { useState, useCallback, useEffect, useMemo } from "react";
import { usePageShortcuts } from "../../hooks/usePageShortcuts";
import { FaWhatsapp } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import CommonViewModal from "../../components/ui/CommonViewModal/CommonViewModal";
import CommonConfirmModal from "../../components/ui/CommonConfirmModal/CommonConfirmModal";
import CancelReasonModal from "../../components/ui/CancelReasonModal/CancelReasonModal";
import HistoryLink from "../../components/ui/HistoryLink/HistoryLink";
import { salesInvoiceService } from "../../services/salesInvoiceService";
import ViewButton from "../../components/ui/viewbutton/ViewButton";
import DeleteButton from "../../components/ui/DeleteButton/DeleteButton";
import StatusBadge from "../../components/ui/StatusBadge/Badge";
import EditButton from "../../components/ui/EditButton/EditButton";
import DataTable, { type DataTableColumn } from "../../components/ui/table/DataTable";
import ExportCSVButton from "../../components/ui/ExportCSVButton/ExportCSVButton";
import EmailButton from "../../components/ui/EmailButton/EmailButton";
import WhatsappButton from "../../components/ui/WhatsappButton/WhatsappButton";
import { Mail, Plus } from "lucide-react";
import { ActionPill, PageHeader, Toolbar } from "../../components/ui/v2";
import { PAGE_CLASS, formatDateIN, formatINR } from "../sales/shared/tradeUi";
import { useAppSelector } from "../../hooks/reduxHooks";
import { useListCache, markStaleByPrefix } from "../../hooks/useListCache";
import { usePermission } from "../../hooks/usePermission";

const ITEMS_PER_PAGE = 15;

const getMobileFromCustomer = (cust: any) => {
  if (!cust) return "";
  const m = cust.mobile;
  if (Array.isArray(m) && m.length > 0) {
    return m[0].number || m[0].value || "";
  }
  if (typeof m === "string") return m;
  return "";
};

const calculateSalesPendingAmount = (item: any) => {
  const status = (item.status || "").toUpperCase();
  if (status === "PAID" || status === "CLOSED") return 0;
  const net = Number(item.grandTotal || 0);
  const rawPayments = Array.isArray(item.payments)
    ? item.payments
    : typeof item.payments === "string"
      ? JSON.parse(item.payments || "[]")
      : [];
  const paid = rawPayments.reduce((sum: number, p: any) => sum + Number(p?.amount || 0), 0);
  const pending = net - paid;
  return pending > 0 ? pending : 0;
};

const INVOICE_CACHE_PREFIX = "salesInvoices:";

const SalesInvoiceList: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const canSendWhatsappEmail =
    can("sales-invoices.whatsapp-email") || can("sales-invoices.whatsapp_email");
  const canEdit = can("sales-invoices.edit");
  const canDelete = can("sales-invoices.delete");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const company = useAppSelector((state) => state.company.data);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailInvoice, setEmailInvoice] = useState<any | null>(null);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  const [showWhatsappModal, setShowWhatsappModal] = useState(false);
  const [whatsappInvoice, setWhatsappInvoice] = useState<any | null>(null);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const cacheKey = `${INVOICE_CACHE_PREFIX}${currentPage}:${ITEMS_PER_PAGE}:${debouncedSearch}`;

  const fetcher = useCallback(
    async (_signal: AbortSignal) => {
      const response = await salesInvoiceService.fetchAll({
        page: currentPage,
        pageSize: ITEMS_PER_PAGE,
        search: debouncedSearch || undefined,
      });
      return { data: response.data || [], total: response.total ?? 0 };
    },
    [currentPage, debouncedSearch]
  );

  const {
    data,
    total,
    loading,
    refresh,
    error: listError,
  } = useListCache({
    cacheKey,
    socketModule: "salesInvoice",
    fetcher,
    enabled: can("sales-invoices.view"),
  });

  const handleDeleteConfirm = async (reason: string) => {
    if (itemToDelete === null) return;

    try {
      await salesInvoiceService.cancel(itemToDelete, reason);
      toast.success("Invoice cancelled; its ledger entries were reversed.");
      setShowDeleteModal(false);
      setItemToDelete(null);
      markStaleByPrefix(INVOICE_CACHE_PREFIX);
      refresh();
    } catch (error: any) {
      console.error("Delete error:", error);
      toast.error(error?.response?.data?.message || "Failed to cancel invoice");
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  const formatCurrency = (amount: any) =>
    `₹${Number(amount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

  const handleOpenEmailModal = async (item: any) => {
    try {
      setSendingEmail(true);
      const fullItem = await salesInvoiceService.fetchById(item.id);
      setEmailInvoice(fullItem);
      setRecipientEmail((fullItem.customer as any)?.email || "");
      setEmailSubject(`Invoice ${fullItem.invoiceNo}`);
      setEmailMessage(
        `Dear ${fullItem.customer?.displayName || fullItem.customer?.firmName || "Customer"},\n\nPlease find the attached invoice for your reference.\n\nBest regards,\n${company?.companyName || "Our team"}`
      );
      setShowEmailModal(true);
    } catch (error: any) {
      toast.error("Failed to load invoice details");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendEmail = async () => {
    if (!emailInvoice || !recipientEmail) {
      toast.error("Recipient email is required.");
      return;
    }
    setSendingEmail(true);
    try {
      await salesInvoiceService.emailInvoice(
        emailInvoice.id,
        recipientEmail,
        emailSubject,
        emailMessage
      );

      toast.success("Email sent successfully!");
      setShowEmailModal(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.response?.data?.message || "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  };

  const handleOpenWhatsappModal = async (item: any) => {
    try {
      setSendingWhatsapp(true);
      const fullItem = await salesInvoiceService.fetchById(item.id);
      setWhatsappInvoice(fullItem);

      // Extract best mobile number from customer object
      let rPhone = "";
      if (fullItem.customer?.mobile) {
        if (Array.isArray(fullItem.customer.mobile) && fullItem.customer.mobile.length > 0) {
          rPhone = fullItem.customer.mobile[0].number || fullItem.customer.mobile[0].value || "";
        } else if (typeof fullItem.customer.mobile === "string") {
          rPhone = fullItem.customer.mobile;
        }
      }
      setRecipientPhone(rPhone);

      setWhatsappMessage(
        `Dear ${fullItem.customer?.displayName || fullItem.customer?.firmName || "Customer"},\n\nPlease find the attached invoice for your reference.\n\nBest regards,\n${company?.companyName || "Our team"}`
      );
      setShowWhatsappModal(true);
    } catch (error: any) {
      toast.error("Failed to load invoice details");
    } finally {
      setSendingWhatsapp(false);
    }
  };

  const handleSendWhatsapp = async () => {
    if (!whatsappInvoice || !recipientPhone) {
      toast.error("Recipient phone is required.");
      return;
    }
    setSendingWhatsapp(true);
    try {
      const formattedPhone = recipientPhone.replace(/^\+/, "");
      await salesInvoiceService.whatsappInvoice(
        whatsappInvoice.id,
        formattedPhone,
        whatsappMessage
      );

      toast.success("WhatsApp message sent successfully!");
      setShowWhatsappModal(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.response?.data?.message || "Failed to send WhatsApp message");
    } finally {
      setSendingWhatsapp(false);
    }
  };

  const handleOpenView = async (item: any) => {
    navigate(`/sales-invoices/details/${item.id}`);
    // try {
    //     const details = await salesInvoiceService.fetchById(item.id);
    //     setSelectedItem(details);
    //     setShowViewModal(true);
    // } catch (error) {
    //     toast.error("Failed to load invoice details");
    // }
  };

  const fetchSalesInvoicesForExport = useCallback(async () => {
    const res = await salesInvoiceService.fetchAll({ page: 1, pageSize: 100000 });
    return Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
  }, []);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Invoice No", accessor: (item: any) => item.invoiceNo || "" },
      { header: "Invoice Date", accessor: (item: any) => formatDate(item.invoiceDate) },
      { header: "Due Date", accessor: (item: any) => formatDate(item.dueDate) },
      {
        header: "Customer",
        accessor: (item: any) => item.customer?.displayName || item.customer?.firmName || "N/A",
      },
      {
        header: "Net Amount",
        accessor: (item: any) =>
          item.grandTotal != null ? Number(item.grandTotal).toFixed(2) : "0.00",
      },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Sales_Invoice_List_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const columns: DataTableColumn<any>[] = [
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
      header: "Invoice no",
      render: (item) => (
        <button
          type="button"
          onClick={() => handleOpenView(item)}
          className="font-semibold text-accent hover:underline underline-offset-4"
        >
          {item.invoiceNo}
        </button>
      ),
    },
    {
      header: "Date",
      render: (item) => (
        <span className="tabular-nums text-ink-muted">{formatDateIN(item.invoiceDate)}</span>
      ),
    },
    {
      header: "Customer",
      render: (item) => (
        <div className="min-w-0 leading-tight">
          <div className="font-medium text-ink">
            {item.customer?.displayName || item.customer?.firmName || "N/A"}
          </div>
          {item.customer?.gstin && (
            <div className="mt-0.5 text-[12px] tabular-nums text-ink-subtle">
              {item.customer.gstin}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Taxable",
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-ink-muted">{formatINR(item.subTotal)}</span>
      ),
    },
    {
      header: "Tax",
      align: "right",
      render: (item) => (
        <span className="tabular-nums text-ink-subtle">{formatINR(item.taxTotal)}</span>
      ),
    },
    {
      header: "Net amount",
      align: "right",
      render: (item) => (
        <span className="font-semibold tabular-nums text-ink">{formatINR(item.grandTotal)}</span>
      ),
    },
    {
      header: "Status",
      render: (item) => (
        <StatusBadge
          status={
            String(item.status || "").toUpperCase() === "CANCELLED" ? "CANCELLED" : "INVOICED"
          }
        />
      ),
    },
    {
      header: "Actions",
      render: (item) => (
        <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
          {canSendWhatsappEmail && <EmailButton onClick={() => handleOpenEmailModal(item)} />}
          {canSendWhatsappEmail && <WhatsappButton onClick={() => handleOpenWhatsappModal(item)} />}
          <ViewButton onClick={() => handleOpenView(item)} />
          {item.status !== "PAID" && item.status !== "CANCELLED" && canEdit && (
            <EditButton onClick={() => navigate(`/sales-invoices/edit/${item.id}`)} />
          )}
          {canDelete && item.status !== "CANCELLED" && (
            <DeleteButton
              onClick={() => {
                setItemToDelete(item.id);
                setShowDeleteModal(true);
              }}
            />
          )}
          <HistoryLink entity="sales_invoices" entityId={item.id} />
        </div>
      ),
      align: "right",
    },
  ];

  const canCreate = can("sales-invoices.create");
  const createButton = canCreate ? (
    <ActionPill icon={<Plus size={18} />} onClick={() => navigate("/sales-invoices/create")}>
      New Invoice
    </ActionPill>
  ) : null;

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Sales Invoice List"
        subtitle={
          loading && !total
            ? "Tax invoices raised to customers"
            : `${total.toLocaleString("en-IN")} invoice${total === 1 ? "" : "s"} · cancel reverses the ledger entries`
        }
        primaryAction={createButton}
        actions={
          can("sales-invoices.export") ? (
            <ExportCSVButton
              fetchData={fetchSalesInvoicesForExport}
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
        searchPlaceholder="Search number or customer"
        searchLabel="Search invoices"
      />

      <DataTable
        error={listError}
        onRetry={refresh}
        columns={columns}
        data={data}
        rowKey={(item) => item.id}
        loading={loading}
        ariaLabel="Sales invoices"
        emptyMessage={
          debouncedSearch ? `No invoices match "${debouncedSearch}".` : "No invoices yet."
        }
        emptyAction={debouncedSearch ? undefined : createButton}
        pagination={{
          currentPage,
          totalPages,
          onPageChange: setCurrentPage,
        }}
      />

      {/* View Modal */}
      <CommonViewModal
        show={showViewModal}
        onHide={() => setShowViewModal(false)}
        modalTitle="Sales Invoice details"
        avatarText={selectedItem ? selectedItem.invoiceNo.charAt(0).toUpperCase() : ""}
        headerTitle={selectedItem ? selectedItem.invoiceNo : ""}
        headerSubtitle={
          selectedItem
            ? `Customer: ${selectedItem.customer?.displayName || selectedItem.customer?.firmName || "N/A"}`
            : ""
        }
        sections={
          selectedItem
            ? [
                {
                  fields: [
                    { label: "Invoice No", value: selectedItem.invoiceNo },
                    { label: "Invoice Date", value: formatDate(selectedItem.invoiceDate) },
                    { label: "Due Date", value: formatDate(selectedItem.dueDate) },
                    {
                      label: "Mobile Number",
                      value: getMobileFromCustomer(selectedItem.customer) || "N/A",
                    },
                  ],
                },
                {
                  title: "Billing & Shipping Details",
                  fields: [
                    {
                      label: "Billing address",
                      value:
                        [
                          selectedItem.customer?.billingAddressLine1,
                          selectedItem.customer?.billingCity,
                          selectedItem.customer?.billingState,
                          selectedItem.customer?.billingPincode,
                        ]
                          .filter(Boolean)
                          .join(", ") || "N/A",
                    },
                    {
                      label: "Shipping address",
                      value:
                        [
                          selectedItem.customer?.shippingAddressLine1,
                          selectedItem.customer?.shippingCity,
                          selectedItem.customer?.shippingState,
                          selectedItem.customer?.shippingPincode,
                        ]
                          .filter(Boolean)
                          .join(", ") || "N/A",
                    },
                  ],
                },
                {
                  title: "Invoice Summary",
                  fields: [
                    { label: "Total items", value: String(selectedItem.items?.length ?? 0) },
                    { label: "Subtotal", value: formatCurrency(selectedItem.subTotal) },
                    { label: "Total tax", value: formatCurrency(selectedItem.taxTotal) },
                    { label: "Grand Total", value: formatCurrency(selectedItem.grandTotal) },
                    { label: "Notes", value: selectedItem.notes || "N/A" },
                  ],
                },
              ]
            : []
        }
      />

      {/* Cancel with reason (P1-10d): the invoice stays in the books as CANCELLED. */}
      <CancelReasonModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        title="Cancel this invoice?"
        confirmText="Cancel invoice"
      />

      <CommonConfirmModal
        show={showEmailModal}
        onHide={() => setShowEmailModal(false)}
        onConfirm={handleSendEmail}
        title="Send Email"
        message={`Are you sure you want to send the invoice to ${recipientEmail || "this customer"}?`}
        warningText="This will generate a PDF and send it to the customer."
        confirmText="Send Email"
        loadingText="Sending..."
        confirmIcon={Mail}
        confirmVariant="primary"
        isLoading={sendingEmail}
      />

      <CommonConfirmModal
        show={showWhatsappModal}
        onHide={() => setShowWhatsappModal(false)}
        onConfirm={handleSendWhatsapp}
        title="Send WhatsApp"
        message={
          <div className="text-left mt-2 flex flex-col gap-3">
            <p className="text-sm text-ink-subtle mb-2">
              Are you sure you want to send the invoice via WhatsApp?
            </p>
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1">
                Phone Number (with country code, e.g. 919876543210)
              </label>
              {(() => {
                const phones = [];
                if (whatsappInvoice?.customer) {
                  if (Array.isArray(whatsappInvoice.customer.mobile)) {
                    whatsappInvoice.customer.mobile.forEach((m: any) => {
                      if (m.number || m.value)
                        phones.push({ label: m.label || "Mobile", number: m.number || m.value });
                    });
                  } else if (
                    typeof whatsappInvoice.customer.mobile === "string" &&
                    whatsappInvoice.customer.mobile
                  ) {
                    phones.push({ label: "Mobile", number: whatsappInvoice.customer.mobile });
                  }
                  if (
                    typeof whatsappInvoice.customer.altPhone === "string" &&
                    whatsappInvoice.customer.altPhone
                  ) {
                    phones.push({
                      label: "Alternative",
                      number: whatsappInvoice.customer.altPhone,
                    });
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
        warningText="This will generate a PDF and send it to the customer's WhatsApp."
        confirmText="Send WhatsApp"
        loadingText="Sending..."
        confirmIcon={FaWhatsapp}
        confirmVariant="primary"
        isLoading={sendingWhatsapp}
      />
    </div>
  );
};

export default SalesInvoiceList;
