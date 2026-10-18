import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FaBoxes, FaPlus, FaTimes, FaTrash } from "react-icons/fa";
import { toast } from "react-toastify";
import { returnService, type PurchaseReturn } from "../../../../services/returnService";
import { supplierService } from "../../../../services/supplierService";
import { rawMaterialService } from "../../../../services/rawMaterialService";
import { grnInvoiceService } from "../../../../services/grnInvoiceService";
import { storeService } from "../../../../services/storeService";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { useListCache } from "../../../../hooks/useListCache";
import { useSocketSync } from "../../../../hooks/useSocketSync";

import CustomButton from "../../../../components/ui/Button/Button";
import ViewButton from "../../../../components/ui/viewbutton/ViewButton";
import SearchInput from "../../../../components/ui/SearchInput/SearchInput";
import FilterPopover from "../../../../components/ui/FilterPopover/FilterPopover";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import DataTable, { type DataTableColumn } from "../../../../components/ui/table/DataTable";
import { PageHeader } from "../../../../components/ui/v2";
import ExportCSVButton from "../../../../components/ui/ExportCSVButton/ExportCSVButton";
import CommonViewModal from "../../../../components/ui/CommonViewModal/CommonViewModal";
import StatusBadge from "../../../../components/ui/StatusBadge/Badge";
import { usePermission } from "../../../../hooks/usePermission";

interface FormReturnRow {
  rawMaterialId: string;
  materialName: string;
  uom: string;
  quantity: number;
  purchasedQty: number;
  alreadyReturnedQty: number;
  maxReturnable: number;
  unitPrice: number;
  reason?: string;
  isGrnLinked?: boolean;
}

interface FilterState {
  supplierId: string;
  status: string;
}

const DEFAULT_FILTERS: FilterState = {
  supplierId: "",
  status: "",
};

export const PurchaseReturnPage: React.FC = () => {
  const { can } = usePermission();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [selectedViewReturn, setSelectedViewReturn] = useState<PurchaseReturn | null>(null);

  const [searchTerm, setSearchTerm] = useState<string>("");
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FilterState>(DEFAULT_FILTERS);

  const activeFilterCount = [appliedFilters.supplierId, appliedFilters.status].filter(
    Boolean
  ).length;
  const hasActiveFilters = activeFilterCount > 0;

  const handleFilterOpen = () => setDraftFilters(appliedFilters);
  const handleApplyFilters = () => setAppliedFilters(draftFilters);
  const handleClearFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  };
  const handleRemoveFilter = (key: keyof FilterState) => {
    setAppliedFilters((prev) => ({ ...prev, [key]: "" }));
  };

  const { data: company } = useAppSelector((state) => state.company);

  // Form state
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierInvoices, setSupplierInvoices] = useState<any[]>([]);
  const [selectedGrnId, setSelectedGrnId] = useState<string>("");
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [fetchingGrn, setFetchingGrn] = useState<boolean>(false);

  const [refundMode, setRefundMode] = useState<"CREDIT_NOTE" | "CASH" | "BANK">("CREDIT_NOTE");
  // A price adjustment raises the debit note without moving stock (P1-08).
  const [kind, setKind] = useState<"GOODS_RETURN" | "PRICE_ADJUSTMENT">("GOODS_RETURN");
  const [reason, setReason] = useState<string>("");
  const [narration, setNarration] = useState<string>("");
  const [returnRows, setReturnRows] = useState<FormReturnRow[]>([]);

  const cacheKey = `accounts:purchase-returns`;

  // The returns are the page's data. Suppliers, materials and stores only feed the form, so they
  // settle separately: one failed lookup shows a message and leaves the others loaded.
  const fetcher = useCallback(async (_signal: AbortSignal) => {
    const [rRes, sRes, mRes, stRes] = await Promise.allSettled([
      returnService.fetchPurchaseReturns(),
      supplierService.fetchAllSuppliers(),
      rawMaterialService.fetchAll(),
      storeService.fetchAll({ limit: 100 }),
    ]);
    if (rRes.status === "rejected") {
      toast.error(rRes.reason?.message || "Failed to load purchase returns");
      throw rRes.reason;
    }
    const failed: string[] = [];
    if (sRes.status === "fulfilled") {
      setSuppliers(Array.isArray(sRes.value) ? sRes.value : []);
    } else {
      failed.push("suppliers");
    }
    if (mRes.status === "fulfilled") {
      const v: any = mRes.value;
      setMaterials(Array.isArray(v) ? v : (v?.rawMaterials ?? []));
    } else {
      failed.push("raw materials");
    }
    if (stRes.status === "fulfilled") {
      const v: any = stRes.value;
      setStores(Array.isArray(v) ? v : v?.stores || v?.data || []);
    } else {
      failed.push("stores");
    }
    setOptionsError(
      failed.length ? `Could not load ${failed.join(", ")}. Retry to load them again.` : null
    );
    const list = rRes.value || [];
    return { data: list, total: list.length };
  }, []);

  const {
    data: returns,
    loading,
    refreshing,
    refresh,
    error: listError,
  } = useListCache<PurchaseReturn>({
    cacheKey,
    socketModule: "purchaseReturn",
    fetcher,
  });

  useSocketSync("grnInvoice", undefined, refresh);
  useSocketSync("supplier", undefined, refresh);
  useSocketSync("rawMaterial", undefined, refresh);

  // When Supplier changes, fetch GRN Invoices
  useEffect(() => {
    if (!supplierId) {
      setSupplierInvoices([]);
      setSelectedGrnId("");
      setReturnRows([]);
      return;
    }

    const fetchGrns = async () => {
      try {
        const res = await grnInvoiceService.fetchAll({
          supplierId: Number(supplierId),
          limit: 100,
        });
        const list = Array.isArray(res) ? res : res?.grnInvoices || res?.data || [];
        setSupplierInvoices(list);
      } catch (err) {
        console.error("Failed to fetch GRN invoices", err);
      }
    };

    fetchGrns();
  }, [supplierId]);

  // When GRN Invoice changes, fetch line items & calculate remaining returnable quantities
  useEffect(() => {
    if (!selectedGrnId) {
      setReturnRows([]);
      return;
    }

    const fetchGrnDetails = async () => {
      setFetchingGrn(true);
      try {
        const grn = await grnInvoiceService.fetchById(selectedGrnId);
        if (grn?.storeId) {
          setSelectedStoreId(grn.storeId);
        }

        // Calculate already returned quantities for this GRN
        const previousReturns = returns.filter(
          (r) => String(r.grnInvoiceId) === String(selectedGrnId) && r.status !== "CANCELLED"
        );
        const alreadyReturnedMap = new Map<string, number>();
        previousReturns.forEach((ret) => {
          (ret.items || []).forEach((ritem: any) => {
            const rmId = String(ritem.rawMaterialId);
            alreadyReturnedMap.set(
              rmId,
              (alreadyReturnedMap.get(rmId) || 0) + Number(ritem.quantity)
            );
          });
        });

        if (grn && Array.isArray(grn.items)) {
          const initialRows: FormReturnRow[] = grn.items.map((item: any) => {
            const rmId = String(item.productId || item.rawMaterialId || item.id);
            const matchedMat = materials.find((m) => String(m.rawMaterialId || m.id) === rmId);
            const nameDisplay = matchedMat?.materialName || item.description || `Material #${rmId}`;
            const purchasedQty = Number(item.quantity) || 0;
            const alreadyReturnedQty = alreadyReturnedMap.get(rmId) || 0;
            const maxReturnable = Math.max(0, purchasedQty - alreadyReturnedQty);

            return {
              rawMaterialId: rmId,
              materialName: nameDisplay,
              uom: item.uom || (matchedMat?.baseUom ? matchedMat.baseUom.split(",")[0].trim() : ""),
              quantity: 0,
              purchasedQty,
              alreadyReturnedQty,
              maxReturnable,
              unitPrice: Number(item.unitPrice),
              reason: "",
              isGrnLinked: true,
            };
          });
          setReturnRows(initialRows);
        }
      } catch (err: any) {
        toast.error(err?.message || "Failed to load GRN invoice items");
      } finally {
        setFetchingGrn(false);
      }
    };

    fetchGrnDetails();
  }, [selectedGrnId, materials, returns]);

  const handleAddManualRow = () => {
    if (materials.length === 0) return;
    const first = materials[0];
    const rmId = String(first.rawMaterialId || first.id);
    const baseUom = first.baseUom ? first.baseUom.split(",")[0].trim() : "";
    setReturnRows((prev) => [
      ...prev,
      {
        rawMaterialId: rmId,
        materialName: first.materialName || first.name || `Material #${rmId}`,
        uom: baseUom,
        quantity: 1,
        purchasedQty: 0,
        alreadyReturnedQty: 0,
        maxReturnable: 99999,
        unitPrice: Number(first.unitPrice || 0),
        reason: "",
        isGrnLinked: false,
      },
    ]);
  };

  const handleRowMaterialChange = (index: number, rmId: string) => {
    const matchedMat = materials.find((m) => String(m.rawMaterialId || m.id) === rmId);
    setReturnRows((prev) => {
      const updated = [...prev];
      updated[index].rawMaterialId = rmId;
      updated[index].materialName =
        matchedMat?.materialName || matchedMat?.name || `Material #${rmId}`;
      updated[index].uom = matchedMat?.baseUom ? matchedMat.baseUom.split(",")[0].trim() : "";
      updated[index].unitPrice = Number(matchedMat?.unitPrice || updated[index].unitPrice || 0);
      return updated;
    });
  };

  const handleRowQuantityChange = (index: number, qtyVal: number) => {
    setReturnRows((prev) => {
      const updated = [...prev];
      const max = updated[index].maxReturnable;
      if (qtyVal > max) {
        toast.warning(`Maximum returnable quantity for ${updated[index].materialName} is ${max}`);
      }
      const validQty = Math.max(0, Math.min(qtyVal, max));
      updated[index].quantity = validQty;
      return updated;
    });
  };

  const handleRowPriceChange = (index: number, priceVal: number) => {
    setReturnRows((prev) => {
      const updated = [...prev];
      updated[index].unitPrice = Math.max(0, priceVal);
      return updated;
    });
  };

  const handleRemoveRow = (index: number) => {
    setReturnRows((prev) => prev.filter((_, i) => i !== index));
  };

  const grandTotal = returnRows.reduce((sum, r) => sum + r.quantity * r.unitPrice, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !company?.id) {
      toast.error("Please select a supplier and ensure company context is active");
      return;
    }

    if (kind === "GOODS_RETURN" && !selectedGrnId && !selectedStoreId) {
      toast.error("Please select a Store/Warehouse when no GRN Invoice is linked");
      return;
    }

    if (!reason.trim()) {
      toast.error("Reason for Return is required for audit trail");
      return;
    }

    const activeReturnItems = returnRows.filter((r) => r.quantity > 0);
    if (activeReturnItems.length === 0) {
      toast.error("Please enter a return quantity greater than 0 for at least one raw material");
      return;
    }

    setSubmitting(true);
    try {
      await returnService.createPurchaseReturn({
        supplierId: parseInt(supplierId, 10),
        grnInvoiceId: selectedGrnId || undefined,
        storeId: selectedStoreId || undefined,
        kind,
        refundMode,
        reason: reason.trim(),
        narration,
        companyId: company.id,
        items: activeReturnItems.map((r) => ({
          rawMaterialId: r.rawMaterialId,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          reason: r.reason || reason,
        })),
      });

      toast.success("Purchase Return processed & stock deducted!");
      setShowModal(false);
      resetForm();
      refresh();
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message || err?.message || "Failed to create Purchase Return"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSupplierId("");
    setSupplierInvoices([]);
    setSelectedGrnId("");
    setSelectedStoreId("");
    setReturnRows([]);
    setRefundMode("CREDIT_NOTE");
    setReason("");
    setNarration("");
  };

  const supplierOptions = useMemo(() => {
    return suppliers.map((s) => ({
      label: s.legalName || s.displayName || `Supplier #${s.id}`,
      value: String(s.id),
    }));
  }, [suppliers]);

  const activeSupplierName = suppliers.find(
    (s) => String(s.id) === appliedFilters.supplierId
  )?.legalName;

  const filteredReturns = useMemo(() => {
    return returns.filter((r) => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch =
          r.returnNo?.toLowerCase().includes(term) ||
          r.supplier?.legalName?.toLowerCase().includes(term) ||
          (r.supplier as any)?.displayName?.toLowerCase().includes(term) ||
          r.grnInvoice?.invoiceNo?.toLowerCase().includes(term) ||
          r.reason?.toLowerCase().includes(term) ||
          r.status?.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      if (appliedFilters.supplierId) {
        if (String(r.supplierId) !== appliedFilters.supplierId) return false;
      }

      if (appliedFilters.status) {
        if (r.status !== appliedFilters.status) return false;
      }

      return true;
    });
  }, [returns, searchTerm, appliedFilters]);

  const fetchPurchaseReturnsForExport = useCallback(async () => {
    try {
      const list = await returnService.fetchPurchaseReturns();
      if (Array.isArray(list) && list.length > 0) return list;
    } catch (e) {
      console.warn("fetchPurchaseReturns failed, using current returns:", e);
    }
    return Array.isArray(returns) ? returns : [];
  }, [returns]);

  const { csvColumns, csvFilename } = useMemo(() => {
    const columns = [
      { header: "Return No", accessor: (item: any) => item.returnNo || "" },
      { header: "Debit Note", accessor: (item: any) => item.debitNoteNo || "" },
      {
        header: "Kind",
        accessor: (item: any) =>
          item.kind === "PRICE_ADJUSTMENT" ? "Price adjustment" : "Goods return",
      },
      {
        header: "Return Date",
        accessor: (item: any) =>
          item.returnDate ? new Date(item.returnDate).toLocaleDateString("en-IN") : "",
      },
      {
        header: "Supplier",
        accessor: (item: any) => item.supplier?.legalName || item.supplier?.displayName || "",
      },
      {
        header: "GRN Invoice",
        accessor: (item: any) =>
          item.grnInvoice?.invoiceNo || (item.grnInvoiceId ? `GRN #${item.grnInvoiceId}` : ""),
      },
      {
        header: "Grand Total (₹)",
        accessor: (item: any) => Number(item.grandTotal ?? 0).toFixed(2),
      },
      { header: "Reason", accessor: (item: any) => item.reason || "" },
      { header: "Status", accessor: (item: any) => item.status || "" },
    ];
    return {
      csvColumns: columns,
      csvFilename: `Purchase_Returns_${new Date().toISOString().split("T")[0]}.csv`,
    };
  }, []);

  const columns: DataTableColumn<PurchaseReturn>[] = [
    {
      header: "#",
      width: "60px",
      render: (_item, index) => index + 1,
      align: "center",
    },
    {
      header: "RETURN NO",
      render: (item) => (
        <button
          onClick={() => setSelectedViewReturn(item)}
          className="tabular-nums font-semibold text-accent hover:underline cursor-pointer"
        >
          {item.returnNo}
        </button>
      ),
    },
    {
      header: "DATE",
      render: (item) => (
        <span className="tabular-nums text-xs">
          {item.returnDate ? new Date(item.returnDate).toLocaleDateString("en-IN") : "—"}
        </span>
      ),
    },
    {
      header: "SUPPLIER",
      render: (item) => (
        <span className="font-semibold text-ink">
          {item.supplier?.legalName || (item.supplier as any)?.displayName || "—"}
        </span>
      ),
    },
    {
      header: "STATUS",
      render: (item) => <StatusBadge status={item.status} />,
      align: "center",
    },
    {
      header: "GRAND TOTAL (₹)",
      render: (item) => (
        <span className="tabular-nums font-semibold text-accent whitespace-nowrap">
          ₹{Number(item.grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
        </span>
      ),
      align: "right",
    },
    {
      header: "REASON",
      render: (item) => (
        <span className="text-ink-subtle truncate max-w-xs block">{item.reason || "—"}</span>
      ),
    },
    {
      header: "ACTIONS",
      align: "center",
      render: (item) => (
        <div className="flex items-center justify-center gap-2">
          <ViewButton onClick={() => setSelectedViewReturn(item)} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="w-full">
        <PageHeader
          title="Purchase returns"
          subtitle="Goods you send back to suppliers; each return raises a debit note."
          actions={
            <div className="flex flex-wrap items-center gap-3 relative w-full md:w-auto">
              <SearchInput
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Return no, supplier, reason..."
              />

              <FilterPopover
                activeFilterCount={activeFilterCount}
                hasActiveFilters={hasActiveFilters}
                onOpen={handleFilterOpen}
                onApply={handleApplyFilters}
                onClear={handleClearFilters}
              >
                <div className="space-y-3">
                  <div>
                    <label className="sl-label">Supplier</label>
                    <SelectInput
                      name="filterSupplier"
                      value={draftFilters.supplierId}
                      options={supplierOptions}
                      defaultOptionLabel="All Suppliers"
                      searchable={true}
                      noMargin
                      onChange={(e) =>
                        setDraftFilters((p) => ({ ...p, supplierId: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label className="sl-label">Status</label>
                    <SelectInput
                      name="filterStatus"
                      value={draftFilters.status}
                      options={[
                        { value: "APPROVED", label: "Approved" },
                        { value: "COMPLETED", label: "Completed" },
                      ]}
                      defaultOptionLabel="All Statuses"
                      searchable={false}
                      noMargin
                      onChange={(e) => setDraftFilters((p) => ({ ...p, status: e.target.value }))}
                    />
                  </div>
                </div>
              </FilterPopover>

              {can("purchase-returns.export") && (
                <ExportCSVButton
                  fetchData={fetchPurchaseReturnsForExport}
                  columns={csvColumns}
                  filename={csvFilename}
                  text="Export"
                />
              )}

              <CustomButton
                text="New Purchase Return"
                icon={FaPlus}
                onClick={() => {
                  resetForm();
                  setShowModal(true);
                }}
              />
            </div>
          }
        />

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <span className="text-xs text-ink-subtle">Active filters:</span>

            {appliedFilters.supplierId && (
              <span className="sl-chip">
                Supplier: {activeSupplierName || appliedFilters.supplierId}
                <FaTimes
                  className="cursor-pointer hover:text-ink ml-0.5"
                  onClick={() => handleRemoveFilter("supplierId")}
                />
              </span>
            )}

            {appliedFilters.status && (
              <span className="sl-chip">
                Status: {appliedFilters.status}
                <FaTimes
                  className="cursor-pointer hover:text-ink ml-0.5"
                  onClick={() => handleRemoveFilter("status")}
                />
              </span>
            )}
          </div>
        )}

        {optionsError && (
          <div
            role="alert"
            className="mb-3 flex items-center justify-between gap-3 rounded border border-line bg-card-2 px-3 py-2 text-xs text-[color:var(--color-danger)]"
          >
            <span>{optionsError}</span>
            <button type="button" onClick={refresh} className="font-semibold underline">
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        <DataTable
          error={listError}
          sourceRowCount={returns.length}
          onRetry={refresh}
          columns={columns}
          data={filteredReturns}
          rowKey={(item) => item.id}
          loading={loading}
          emptyMessage="No purchase return records found."
        />
      </div>

      {/* ── Purchase Return Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-card border border-line-soft rounded-xl shadow-2xl w-[720px] max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden po-return-compact"
            onClick={(e) => e.stopPropagation()}
          >
            <style>{`
              .po-return-compact input, .po-return-compact select { height: 30px !important; min-height: 30px !important; font-size: 12px !important; padding-top: 0 !important; padding-bottom: 0 !important; }
              .po-return-compact textarea { font-size: 12px !important; }
            `}</style>

            {/* Header */}
            <div className="px-4 py-2.5 bg-card text-ink border-b border-line-soft flex items-center justify-between shrink-0">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <FaBoxes className="text-sm" /> New Purchase Return (Debit Note)
              </h2>
              <button onClick={() => setShowModal(false)} className="text-ink-muted hover:text-ink">
                <FaTimes className="text-sm" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0" noValidate>
              <div className="p-4 space-y-3 overflow-y-auto flex-1">
                {/* ── Return Details ── */}
                <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                  <div>
                    <label className="sl-label">
                      Supplier <span className="text-[color:var(--color-danger)]">*</span>
                    </label>
                    <select
                      value={supplierId}
                      required
                      onChange={(e) => setSupplierId(e.target.value)}
                      className="w-full px-2 border border-line bg-card-2 rounded text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
                    >
                      <option value="">Select Supplier</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.supplierCode} - {s.legalName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="sl-label">
                      Store / Warehouse <span className="text-[color:var(--color-danger)]">*</span>
                    </label>
                    <select
                      value={selectedStoreId}
                      required
                      onChange={(e) => setSelectedStoreId(e.target.value)}
                      className="w-full px-2 border border-line bg-card-2 rounded text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
                    >
                      <option value="">Select Store</option>
                      {stores.map((st) => (
                        <option
                          key={String(st.storeId || st.id)}
                          value={String(st.storeId || st.id)}
                        >
                          {st.storeCode ? `${st.storeCode} - ` : ""}
                          {st.storeName || st.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="sl-label">
                      Kind <span className="text-[color:var(--color-danger)]">*</span>
                    </label>
                    <select
                      value={kind}
                      required
                      onChange={(e) =>
                        setKind(e.target.value as "GOODS_RETURN" | "PRICE_ADJUSTMENT")
                      }
                      className="w-full px-2 border border-line bg-card-2 rounded text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
                      aria-label="Return kind"
                    >
                      <option value="GOODS_RETURN">Goods return (stock moves out)</option>
                      <option value="PRICE_ADJUSTMENT">Price adjustment (debit note only)</option>
                    </select>
                  </div>
                  <div>
                    <label className="sl-label">
                      Refund Mode <span className="text-[color:var(--color-danger)]">*</span>
                    </label>
                    <select
                      value={refundMode}
                      required
                      onChange={(e) => setRefundMode(e.target.value as any)}
                      className="w-full px-2 border border-line bg-card-2 rounded text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
                    >
                      <option value="CREDIT_NOTE">Debit Note</option>
                      <option value="CASH">Cash Refund</option>
                      <option value="BANK">Bank Refund</option>
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="sl-label">
                      Reason for Return <span className="text-[color:var(--color-danger)]">*</span>
                    </label>
                    <input
                      type="text"
                      value={reason}
                      required
                      placeholder="e.g. Damaged material / Substandard quality"
                      onChange={(e) => setReason(e.target.value)}
                      className="w-full px-2 border border-line bg-card-2 rounded text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
                    />
                  </div>
                </div>

                {/* ── Return Items ── */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11.5px] font-semibold text-ink uppercase tracking-wide">
                      Return Raw Materials
                    </label>
                    <button
                      type="button"
                      onClick={handleAddManualRow}
                      className="flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:text-primary/80 cursor-pointer"
                    >
                      <FaPlus className="w-2.5 h-2.5" /> Add Row
                    </button>
                  </div>

                  {returnRows.length === 0 ? (
                    <div className="p-3 border border-dashed border-line rounded text-center text-[12.5px] text-ink-subtle">
                      Click Add Row to select raw materials.
                    </div>
                  ) : (
                    <div className="border border-line rounded overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-card-2 text-ink-subtle uppercase text-[11.5px] tracking-wide font-bold border-b border-line">
                          <tr>
                            <th className="px-2 py-1.5 w-8 text-center">#</th>
                            <th className="px-2 py-1.5">Raw Material</th>
                            <th className="px-2 py-1.5 w-16 text-center">UOM</th>
                            <th className="px-2 py-1.5 w-20 text-center">Qty</th>
                            <th className="px-2 py-1.5 w-24 text-right">Price (₹)</th>
                            <th className="px-2 py-1.5 w-24 text-right">Total (₹)</th>
                            <th className="px-2 py-1.5 w-8"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line-soft">
                          {returnRows.map((row, idx) => {
                            const lineTot = row.quantity * row.unitPrice;
                            const matchedMat = materials.find(
                              (m: any) => String(m.rawMaterialId || m.id) === row.rawMaterialId
                            );
                            const uomList = (matchedMat?.baseUom || row.uom || "")
                              .split(",")
                              .map((u: string) => u.trim())
                              .filter(Boolean);
                            return (
                              <tr key={idx} className="hover:bg-card-2/50 transition-colors">
                                <td className="px-2 py-1 text-center text-[12.5px] font-bold text-ink-subtle">
                                  {idx + 1}
                                </td>
                                <td className="px-2 py-1">
                                  {row.isGrnLinked ? (
                                    <div className="font-semibold text-ink text-[12.5px]">
                                      {row.materialName}
                                    </div>
                                  ) : (
                                    <select
                                      value={row.rawMaterialId}
                                      onChange={(e) => handleRowMaterialChange(idx, e.target.value)}
                                      className="w-full px-1 border border-line rounded text-[12.5px] bg-card text-ink focus:outline-none focus:border-primary"
                                    >
                                      {materials.map((m) => {
                                        const rmId = String(m.rawMaterialId || m.id);
                                        return (
                                          <option key={rmId} value={rmId}>
                                            {m.materialName || m.name || rmId}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  )}
                                </td>
                                <td className="px-2 py-1">
                                  {uomList.length > 1 ? (
                                    <select
                                      value={row.uom}
                                      onChange={(e) =>
                                        setReturnRows((prev) => {
                                          const u = [...prev];
                                          u[idx] = { ...u[idx], uom: e.target.value };
                                          return u;
                                        })
                                      }
                                      className="w-full px-1 border border-line rounded text-[12.5px] tabular-nums bg-card text-ink focus:outline-none focus:border-primary"
                                    >
                                      {uomList.map((u: string) => (
                                        <option key={u} value={u}>
                                          {u}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="block text-center text-[12.5px] tabular-nums text-ink-muted">
                                      {row.uom || "—"}
                                    </span>
                                  )}
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max={row.maxReturnable}
                                    step="0.01"
                                    value={row.quantity || ""}
                                    placeholder="0"
                                    disabled={row.maxReturnable <= 0}
                                    onChange={(e) =>
                                      handleRowQuantityChange(idx, parseFloat(e.target.value) || 0)
                                    }
                                    className="w-full px-1 border border-line rounded text-center tabular-nums font-semibold text-primary bg-card focus:outline-none focus:border-primary disabled:opacity-60"
                                  />
                                </td>
                                <td className="px-2 py-1">
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.unitPrice || ""}
                                    disabled={row.isGrnLinked}
                                    onChange={(e) =>
                                      handleRowPriceChange(idx, parseFloat(e.target.value) || 0)
                                    }
                                    className="w-full px-1 border border-line rounded text-right tabular-nums bg-card text-ink focus:outline-none focus:border-primary disabled:opacity-60"
                                  />
                                </td>
                                <td className="px-2 py-1 text-right tabular-nums font-semibold text-ink text-[12.5px]">
                                  ₹{lineTot.toFixed(2)}
                                </td>
                                <td className="px-2 py-1 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRow(idx)}
                                    className="p-0.5 text-[color:var(--color-danger)] hover:text-[color:var(--color-danger)] rounded transition cursor-pointer"
                                  >
                                    <FaTrash className="w-2.5 h-2.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-line bg-card-2">
                          <tr>
                            <td
                              colSpan={5}
                              className="px-2 py-1.5 text-right text-[11.5px] font-bold text-ink uppercase tracking-wide"
                            >
                              Grand Total:
                            </td>
                            <td className="px-2 py-1.5 text-right font-bold text-sm text-primary tabular-nums">
                              ₹{grandTotal.toFixed(2)}
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {/* ── Narration ── */}
                <div>
                  <label className="sl-label">Narration / Internal Notes</label>
                  <textarea
                    value={narration}
                    rows={2}
                    placeholder="Additional accounting notes..."
                    onChange={(e) => setNarration(e.target.value)}
                    className="w-full px-2 py-1.5 border border-line bg-card-2 rounded text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-line shrink-0">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={submitting}
                  className="sl-btn sl-pill-sm"
                >
                  Clear
                </button>
                <button type="submit" disabled={submitting} className="sl-cta sl-pill-sm">
                  {submitting ? "Processing..." : "Submit Return"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Details View Modal */}
      <CommonViewModal
        show={Boolean(selectedViewReturn)}
        onHide={() => setSelectedViewReturn(null)}
        modalTitle="Purchase Return Details"
        avatarText={selectedViewReturn?.returnNo ? "PR" : ""}
        headerTitle={selectedViewReturn?.returnNo || ""}
        headerSubtitle={
          selectedViewReturn?.supplier?.legalName ||
          (selectedViewReturn?.supplier as any)?.displayName ||
          ""
        }
        statusNode={<StatusBadge status={selectedViewReturn?.status || "COMPLETED"} />}
        sections={[
          {
            fields: [
              {
                label: "Return Date",
                value: selectedViewReturn
                  ? new Date(selectedViewReturn.returnDate).toLocaleDateString("en-IN")
                  : "—",
              },
              {
                label: "Supplier",
                value:
                  selectedViewReturn?.supplier?.legalName ||
                  (selectedViewReturn?.supplier as any)?.displayName ||
                  "—",
              },
              {
                label: "GRN Invoice",
                value: selectedViewReturn?.grnInvoice?.invoiceNo
                  ? selectedViewReturn.grnInvoice.invoiceNo
                  : selectedViewReturn?.grnInvoiceId
                    ? `GRN #${selectedViewReturn.grnInvoiceId}`
                    : "Direct Return",
              },
              {
                label: "Debit Note",
                value: selectedViewReturn?.debitNoteNo || "—",
              },
              {
                label: "Kind",
                value:
                  selectedViewReturn?.kind === "PRICE_ADJUSTMENT"
                    ? "Price adjustment"
                    : "Goods return",
              },
              {
                label: "GST",
                value: selectedViewReturn
                  ? `₹${Number(selectedViewReturn.taxAmount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                  : "—",
              },
              {
                label: "Grand Total",
                value: selectedViewReturn
                  ? `₹${Number(selectedViewReturn.grandTotal).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                  : "—",
              },
            ],
          },
        ]}
        customContent={
          selectedViewReturn && (
            <div className="space-y-3">
              <div>
                <h4 className="font-semibold text-ink mb-1.5 text-[11.5px] uppercase tracking-wide">
                  Returned Raw Materials
                </h4>
                <div className="border border-line rounded overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-card-2 text-ink-muted font-semibold text-[12px] border-b border-line-soft">
                      <tr>
                        <th className="px-3 py-1.5">Material ID</th>
                        <th className="px-3 py-1.5">Material Name</th>
                        <th className="px-3 py-1.5 text-center">Returned Qty</th>
                        <th className="px-3 py-1.5 text-right">Unit Price (₹)</th>
                        <th className="px-3 py-1.5 text-right">Line Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {selectedViewReturn.items && selectedViewReturn.items.length > 0 ? (
                        selectedViewReturn.items.map((item, i) => (
                          <tr key={item.id || i} className="hover:bg-card-2 transition-colors">
                            <td className="px-3 py-1.5 tabular-nums text-accent font-medium">
                              {item.rawMaterialId}
                            </td>
                            <td className="px-3 py-1.5 font-medium text-ink">
                              {item.rawMaterial?.materialName ||
                                item.rawMaterial?.name ||
                                item.rawMaterialId}
                            </td>
                            <td className="px-3 py-1.5 text-center tabular-nums font-semibold text-ink">
                              {item.quantity}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ink">
                              ₹{Number(item.unitPrice).toFixed(2)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-ink">
                              ₹
                              {(
                                Number(item.lineTotal) ||
                                Number(item.quantity) * Number(item.unitPrice)
                              ).toFixed(2)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-ink-subtle text-xs">
                            No item details found for this return.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedViewReturn.narration && (
                <div className="bg-card-2 p-2 rounded border border-line text-xs">
                  <span className="font-semibold text-ink block mb-0.5 text-[11.5px] uppercase tracking-wide">
                    Narration / Notes
                  </span>
                  <p className="text-ink-muted leading-relaxed">{selectedViewReturn.narration}</p>
                </div>
              )}
            </div>
          )
        }
      />
    </div>
  );
};

export default PurchaseReturnPage;
