import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "../../components/ui/TailwindPrimitives";
import { FaPlus, FaFilePdf } from "react-icons/fa";
import { toast } from "react-toastify";
import { usePageShortcuts } from "../../hooks/usePageShortcuts";

import DataTable from "../../components/ui/table/DataTable";
import SearchInput from "../../components/ui/SearchInput/SearchInput";
import ViewButton from "../../components/ui/viewbutton/ViewButton";
import EditButton from "../../components/ui/EditButton/EditButton";
import DeleteButton from "../../components/ui/DeleteButton/DeleteButton";
import CustomButton from "../../components/ui/Button/Button";
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
    <div>
      <div className="max-w-[1024px] xl:mr-auto bg-card rounded-2xl shadow-sm border border-line overflow-hidden">
        {/* Page Header */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 p-6 border-b border-line">
          <div>
            <h2 className="text-2xl font-bold text-ink">Expense Management</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 relative w-full lg:w-auto">
            <SearchInput
              value={searchTerm}
              onChange={handleSearch}
              placeholder="Search expenses..."
            />
            <select
              className="border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
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
            <CustomButton text="Add Expense" icon={FaPlus} onClick={() => setViewMode("create")} />
          </div>
        </div>

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
                <span className="font-semibold text-blue-600">
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
                    ? "bg-emerald-100 text-emerald-800"
                    : s === "Pending"
                      ? "bg-amber-100 text-amber-800"
                      : s === "Rejected"
                        ? "bg-rose-100 text-rose-800"
                        : s === "Cancelled"
                          ? "bg-slate-200 text-slate-700 line-through"
                          : "bg-card-2 text-ink-muted";
                return (
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${cls}`}
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
                        className="rounded border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-card-2"
                        onClick={() => transition(item.id, "submit", "Sent for approval")}
                      >
                        Submit
                      </button>
                    )}
                    {(s === "Pending" || s === "Draft") && can("expenses.approve") && (
                      <>
                        <button
                          type="button"
                          className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
                          onClick={() => transition(item.id, "approve", "Approved and posted")}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() => setRejecting(item.id)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {s === "Approved" && can("assets.create") && (
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-card-2"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-line-soft bg-card p-4">
        <h2 className="text-lg font-semibold text-ink">Capitalise as an asset</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {expense.expense} — ₹
          {parseFloat(expense.amount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}. The
          cost moves off the expense ledger and onto the asset ledger.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <label className="text-sm text-ink-muted">
            Asset class
            <select
              className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
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
          <label className="text-sm text-ink-muted">
            Asset code
            <input
              className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="FA-0001"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Asset name
            <input
              className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded border border-line px-3 py-1.5 text-sm font-semibold text-ink"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
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
