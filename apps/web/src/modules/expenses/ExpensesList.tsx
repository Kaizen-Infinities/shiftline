import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "../../components/ui/TailwindPrimitives";
import { FaFilePdf } from "react-icons/fa";
import { Plus, Receipt } from "lucide-react";
import { ActionPill, PageHeader } from "../../components/ui/v2";
import { toast } from "react-toastify";
import { usePageShortcuts } from "../../hooks/usePageShortcuts";

import DataTable from "../../components/ui/table/DataTable";
import SearchInput from "../../components/ui/SearchInput/SearchInput";
import ViewButton from "../../components/ui/viewbutton/ViewButton";
import EditButton from "../../components/ui/EditButton/EditButton";
import DeleteButton from "../../components/ui/DeleteButton/DeleteButton";
import CancelReasonModal from "../../components/ui/CancelReasonModal/CancelReasonModal";
import HistoryLink from "../../components/ui/HistoryLink/HistoryLink";
import { usePermission } from "../../hooks/usePermission";
import CommonViewModal from "../../components/ui/CommonViewModal/CommonViewModal";
import ExpensesCreate from "./Expensescreate";
import { useExpenses } from "../../hooks/useExpenses";
import CommonModal from "../../components/ui/Modal/CommonModal";
import { useSocketSync } from "../../hooks/useSocketSync";
import { assetService, type AssetClassRow } from "../../services/assetService";

const ITEMS_PER_PAGE = 15;

interface Expense {
  id: string;
  expenseNumber: string;
  expenseCategory: string;
  date: string;
  expense: string;
  amount: string;
  description: string;
  supplier?: { legalName: string; supplierCode: string } | any;
  paymentMethod: string;
  status: string;
  notes: string;
  receiptInvoice: string;
  rejectReason?: string | null;
  /** P2-05: the deduction recorded when this bill was created with `deductTds: true`. */
  tdsSection?: string | null;
  tdsRate?: string | number | null;
  tdsAmount?: string | number | null;
}

const ExpensesList: React.FC = () => {
  const { expenses, loading, error, total, loadExpenses, removeExpense, transitionExpense } =
    useExpenses();
  const { can } = usePermission();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [capitalising, setCapitalising] = useState<Expense | null>(null);

  const [viewMode, setViewMode] = useState<"list" | "create" | "edit">("list");
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);

  usePageShortcuts({
    onRefresh: () => fetchExpenseData(),
    onDelete: () => setShowDeleteModal(true),
  });

  const fetchExpenseData = useCallback(() => {
    loadExpenses({
      page: currentPage,
      limit: ITEMS_PER_PAGE,
      search: searchTerm || undefined,
      category: filterCategory || undefined,
      status: filterStatus || undefined,
    });
  }, [currentPage, searchTerm, filterCategory, filterStatus, loadExpenses]);

  useSocketSync("expense", undefined, fetchExpenseData);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchExpenseData();
    }, 500);
    return () => clearTimeout(timer);
  }, [currentPage, searchTerm, filterCategory, filterStatus, loadExpenses]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleView = useCallback((expense: Expense) => {
    setSelectedExpense(expense);
    setShowViewModal(true);
  }, []);

  const handleEdit = useCallback((expense: Expense) => {
    setSelectedExpense(expense);
    setViewMode("edit");
  }, []);

  const triggerDelete = useCallback((id: string) => {
    setExpenseToDelete(id);
    setShowDeleteModal(true);
  }, []);

  const reload = () =>
    loadExpenses({
      page: currentPage,
      limit: ITEMS_PER_PAGE,
      search: searchTerm || undefined,
      category: filterCategory || undefined,
      status: filterStatus || undefined,
    });

  // Expense claims (P1-10d): Draft → Pending → Approved (posts the voucher) / Rejected.
  const transition = async (id: string, action: "submit" | "approve", label: string) => {
    try {
      await transitionExpense(id, action);
      toast.success(label);
      reload();
    } catch (err: any) {
      toast.error(err.message || "Could not update the expense");
    }
  };
  const handleRejectConfirm = async (reason: string) => {
    if (!rejecting) return;
    try {
      await transitionExpense(rejecting, "reject", reason);
      toast.success("Expense rejected");
      reload();
    } catch (err: any) {
      toast.error(err.message || "Could not reject the expense");
    } finally {
      setRejecting(null);
    }
  };

  const handleDeleteConfirm = async (reason: string) => {
    if (expenseToDelete !== null) {
      try {
        await removeExpense(expenseToDelete, reason);
        toast.success("Expense cancelled; its ledger entries were reversed.");
        loadExpenses({
          page: currentPage,
          limit: ITEMS_PER_PAGE,
          search: searchTerm || undefined,
          category: filterCategory || undefined,
          status: filterStatus || undefined,
        });
      } catch (err: any) {
        toast.error(err.message || "Failed to cancel expense.");
      } finally {
        setShowDeleteModal(false);
        setExpenseToDelete(null);
      }
    }
  };

  const handleSaveComplete = () => {
    setViewMode("list");
    setSelectedExpense(null);
    loadExpenses({
      page: currentPage,
      limit: ITEMS_PER_PAGE,
      search: searchTerm || undefined,
      category: filterCategory || undefined,
      status: filterStatus || undefined,
    });
  };

  const handleCancel = () => {
    setViewMode("list");
    setSelectedExpense(null);
  };

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE) || 1;
  const paginatedExpenses = expenses || [];

  const categories = [
    "Office Supplies",
    "Travel & Lodging",
    "Software & Hosting",
    "Utilities",
    "Salaries",
    "Rent",
    "Marketing",
    "Others",
  ];
  const statuses = ["Draft", "Pending", "Approved", "Rejected", "Cancelled"];

  const formatDateString = (isoString: string) => {
    if (!isoString) return "N/A";
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  if (viewMode === "create" || (viewMode === "edit" && selectedExpense)) {
    return (
      <ExpensesCreate
        onSaveComplete={handleSaveComplete}
        onCancel={handleCancel}
        initialData={viewMode === "edit" ? selectedExpense : undefined}
      />
    );
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Expense Management"
        subtitle="Business expenses and staff claims, posted to the books when approved"
        icon={<Receipt size={20} />}
        primaryAction={
          <ActionPill icon={<Plus size={18} />} onClick={() => setViewMode("create")}>
            Add Expense
          </ActionPill>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={searchTerm} onChange={handleSearch} placeholder="Search expenses..." />
        <select
          aria-label="Category"
          className="sl-input h-11 w-full text-sm sm:w-56"
          value={filterCategory}
          onChange={(e) => {
            setFilterCategory(e.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="">All Categories</option>
          {categories.map((cat, idx) => (
            <option key={idx} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>
      <div className="w-full">
        {/* Table */}
        <DataTable
          data={paginatedExpenses}
          rowKey={(item) => item.id}
          loading={loading}
          emptyMessage="No expenses found."
          pagination={{
            currentPage,
            totalPages,
            onPageChange: (page) => setCurrentPage(page),
          }}
          columns={[
            {
              header: "#",
              width: "60px",
              render: (_item, index) => (currentPage - 1) * ITEMS_PER_PAGE + index + 1,
            },
            { header: "EXPENSE NUMBER", accessor: "expenseNumber" },
            {
              header: "CATEGORY",
              render: (item) => (
                <span className="bg-card-2 text-ink-muted px-2 py-1 rounded text-xs border border-line">
                  {item.expenseCategory}
                </span>
              ),
            },
            { header: "DATE", render: (item) => formatDateString(item.date) },
            { header: "EXPENSE", accessor: "expense" },
            {
              header: "AMOUNT",
              render: (item) => (
                <span className="font-semibold text-accent">
                  ₹{parseFloat(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              ),
            },
            {
              header: "SUPPLIER",
              render: (item) => item.supplier?.legalName || item.supplier || "N/A",
            },
            { header: "PAYMENT METHOD", accessor: "paymentMethod" },
            {
              header: "STATUS",
              render: (item) => {
                const s = String(item.status || "Draft");
                const cls =
                  s === "Approved"
                    ? "sl-chip-success"
                    : s === "Pending"
                      ? "sl-chip-warning"
                      : s === "Rejected"
                        ? "sl-chip-danger"
                        : s === "Cancelled"
                          ? "bg-card-2 text-ink-muted line-through"
                          : "sl-chip-muted";
                return (
                  <span
                    className={`sl-chip sl-chip-sm ${cls}`}
                    title={item.rejectReason || undefined}
                  >
                    {s === "Pending" ? "Pending approval" : s}
                  </span>
                );
              },
            },
            {
              header: "ACTIONS",
              render: (item) => {
                const s = String(item.status || "Draft");
                const open = s !== "Cancelled";
                return (
                  <div className="flex items-center gap-2">
                    <ViewButton onClick={() => handleView(item)} />
                    {open && s !== "Approved" && can("expenses.edit") && (
                      <EditButton onClick={() => handleEdit(item)} />
                    )}
                    {(s === "Draft" || s === "Rejected") && can("expenses.edit") && (
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-[12.5px] font-semibold text-ink hover:bg-card-2"
                        onClick={() => transition(item.id, "submit", "Sent for approval")}
                      >
                        Submit
                      </button>
                    )}
                    {(s === "Pending" || s === "Draft") && can("expenses.approve") && (
                      <>
                        <button
                          type="button"
                          className="rounded border border-[color:var(--color-success)]/40 px-2 py-1 text-[12.5px] font-semibold text-[color:var(--color-success)] hover:bg-[color:var(--color-success)]/10"
                          onClick={() => transition(item.id, "approve", "Approved and posted")}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="rounded border border-[color:var(--color-danger)]/40 px-2 py-1 text-[12.5px] font-semibold text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger)]/10"
                          onClick={() => setRejecting(item.id)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {s === "Approved" && can("assets.create") && (
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-[12.5px] font-semibold text-ink hover:bg-card-2"
                        onClick={() => setCapitalising(item)}
                        title="Put this expense on the fixed-asset register instead of the P&L"
                      >
                        Capitalise as asset
                      </button>
                    )}
                    {open && can("expenses.delete") && (
                      <DeleteButton onClick={() => triggerDelete(item.id)} />
                    )}
                    <HistoryLink entity="expenses" entityId={item.id} />
                  </div>
                );
              },
            },
          ]}
        />

        {/* View Modal */}
        <CommonViewModal
          show={showViewModal}
          onHide={() => setShowViewModal(false)}
          modalTitle="Expense Details"
          avatarText={selectedExpense ? selectedExpense.expenseNumber.charAt(0).toUpperCase() : ""}
          headerTitle={selectedExpense ? selectedExpense.expenseNumber : ""}
          headerSubtitle={selectedExpense ? `Category: ${selectedExpense.expenseCategory}` : ""}
          sections={
            selectedExpense
              ? [
                  {
                    fields: [
                      { label: "Expense Number", value: selectedExpense.expenseNumber },
                      { label: "Category", value: selectedExpense.expenseCategory },
                      { label: "Expense Date", value: formatDateString(selectedExpense.date) },
                      { label: "Expense Name", value: selectedExpense.expense },
                    ],
                  },
                  {
                    fields: [
                      {
                        label: "Amount",
                        value: `₹${parseFloat(selectedExpense.amount).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}`,
                      },
                      {
                        label: "Supplier",
                        value:
                          selectedExpense.supplier?.legalName || selectedExpense.supplier || "N/A",
                      },
                      { label: "Payment Method", value: selectedExpense.paymentMethod },
                      {
                        label: "Status",
                        value:
                          selectedExpense.status === "Pending"
                            ? "Pending Approval"
                            : selectedExpense.status,
                      },
                    ],
                  },
                  {
                    title: "Additional Information",
                    fields: [
                      { label: "Description", value: selectedExpense.description || "N/A" },
                      { label: "Internal Notes", value: selectedExpense.notes || "N/A" },
                    ],
                  },
                  ...(Number(selectedExpense.tdsAmount) > 0
                    ? [
                        {
                          title: "TDS Deducted (P2-05)",
                          fields: [
                            { label: "Section", value: selectedExpense.tdsSection || "N/A" },
                            {
                              label: "Rate",
                              value: `${Number(selectedExpense.tdsRate || 0)}%`,
                            },
                            {
                              label: "TDS Amount",
                              value: `₹${Number(selectedExpense.tdsAmount).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                              })}`,
                            },
                            {
                              label: "Net Payable",
                              value: `₹${(
                                parseFloat(selectedExpense.amount) -
                                Number(selectedExpense.tdsAmount)
                              ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`,
                            },
                          ],
                        },
                      ]
                    : []),
                  {
                    title: "Attachment",
                    fields: [
                      {
                        label: "Receipt / Invoice",
                        value: selectedExpense.receiptInvoice ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px",
                              marginTop: "4px",
                            }}
                          >
                            {selectedExpense.receiptInvoice.toLowerCase().endsWith(".pdf") ? (
                              <a
                                href={selectedExpense.receiptInvoice}
                                target="_blank"
                                rel="noreferrer"
                                className="btn btn-outline-primary btn-sm"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  width: "fit-content",
                                }}
                              >
                                <FaFilePdf /> View PDF Document
                              </a>
                            ) : (
                              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <img
                                  src={selectedExpense.receiptInvoice}
                                  alt="Receipt Copy"
                                  style={{
                                    maxWidth: "100%",
                                    maxHeight: "300px",
                                    objectFit: "contain",
                                    border: "1px solid var(--color-border)",
                                    borderRadius: "6px",
                                  }}
                                  onError={(e: any) => {
                                    e.target.style.display = "none";
                                    e.target.nextSibling.style.display = "block";
                                  }}
                                />
                                <a
                                  href={selectedExpense.receiptInvoice}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-link btn-sm text-decoration-none p-0 text-start"
                                  style={{ width: "fit-content" }}
                                >
                                  Open in New Tab
                                </a>
                              </div>
                            )}
                          </div>
                        ) : (
                          "No attachment"
                        ),
                      },
                    ],
                  },
                ]
              : []
          }
        />

        {/* Cancel with reason (P1-10d): the expense stays in the books as Cancelled. */}
        <CancelReasonModal
          show={showDeleteModal}
          onHide={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteConfirm}
          title="Cancel this expense?"
          confirmText="Cancel expense"
        />
        <CancelReasonModal
          show={rejecting !== null}
          onHide={() => setRejecting(null)}
          onConfirm={handleRejectConfirm}
          title="Reject this expense claim?"
          message="The claimant sees the reason and can correct and resubmit the claim."
          confirmText="Reject claim"
        />
        {capitalising && (
          <CapitaliseExpenseDialog
            expense={capitalising}
            onCancel={() => setCapitalising(null)}
            onDone={() => {
              setCapitalising(null);
              toast.success("Capitalised as a fixed asset");
              loadExpenses();
            }}
          />
        )}
      </div>
    </div>
  );
};

/** Moves an approved expense's cost onto the fixed-asset register instead of the P&L (P2-07). */
const CapitaliseExpenseDialog: React.FC<{
  expense: Expense;
  onCancel: () => void;
  onDone: () => void;
}> = ({ expense, onCancel, onDone }) => {
  const [classes, setClasses] = useState<AssetClassRow[]>([]);
  const [classId, setClassId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(expense.expense);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void assetService.classes().then((rows) => {
      setClasses(rows);
      if (rows[0]) setClassId(rows[0].id);
    });
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await assetService.capitalise({
        sourceDocType: "EXPENSE",
        sourceDocId: expense.id,
        classId,
        code: code.trim(),
        name: name.trim(),
      });
      onDone();
    } catch (err) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "Could not capitalise this expense"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="sl-dialog w-full max-w-md p-6">
        <h2 className="sl-dialog-title">Capitalise as an asset</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {expense.expense} — ₹
          {parseFloat(expense.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}. The
          cost moves off the expense ledger and onto the asset ledger.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <label className="sl-label !mb-0 flex-col items-start gap-0">
            Asset class
            <select
              className="sl-input mt-1.5 h-11 w-full text-sm"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.usefulLifeYears} yrs, {c.method})
                </option>
              ))}
            </select>
          </label>
          <label className="sl-label !mb-0 flex-col items-start gap-0">
            Asset code
            <input
              className="sl-input mt-1.5 h-11 w-full text-sm"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="FA-0001"
            />
          </label>
          <label className="sl-label !mb-0 flex-col items-start gap-0">
            Asset name
            <input
              className="sl-input mt-1.5 h-11 w-full text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-[color:var(--color-danger)]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="sl-btn sl-pill-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="sl-cta sl-pill-sm"
            disabled={busy || !classId || !code.trim() || !name.trim()}
            onClick={submit}
          >
            Capitalise
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpensesList;
