import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History, X } from "lucide-react";
import { toast } from "react-toastify";
import { useParams, useNavigate } from "react-router-dom";
import { supplierService } from "../../../services/supplierService";

import TextInput from "../../../components/form/TextInput/TextInput";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import { ActionPill, Chip, PageHeader, SkeletonRows } from "../../../components/ui/v2";
import { PAGE_CLASS, formatDateIN, formatINR } from "../../sales/shared/tradeUi";
import { supplierMaterialPriceService } from "../../../services/Suppliermaterialpriceservice";
import type {
  SupplierMaterialPriceRow,
  SupplierMaterialPrice,
} from "../../../features/supplier/types";

const fmtDate = (d: string | null) => formatDateIN(d);
const fmtMoney = (n: number) => (n > 0 ? formatINR(n) : "—");
const todayISO = () => new Date().toISOString().split("T")[0];

const SupplierMaterialPricingList: React.FC = () => {
  // Route is expected to be something like /suppliers/:supplierId/material-prices
  const { supplierId } = useParams<{ supplierId: string }>();
  const navigate = useNavigate();

  const [rows, setRows] = useState<SupplierMaterialPriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [supplierName, setSupplierName] = useState("");

  // Expand/collapse state for the inline history sub-table
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);
  const [historyByMaterial, setHistoryByMaterial] = useState<
    Record<string, SupplierMaterialPrice[]>
  >({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);

  // Revise-price modal state
  const [reviseTarget, setReviseTarget] = useState<SupplierMaterialPriceRow | null>(null);
  const [revisePrice, setRevisePrice] = useState("");
  const [reviseDate, setReviseDate] = useState(todayISO());
  const [revising, setRevising] = useState(false);

  const loadCurrentList = async () => {
    if (!supplierId) return;
    setLoading(true);
    try {
      const res = await supplierMaterialPriceService.fetchCurrent(supplierId);
      let dataArray: SupplierMaterialPriceRow[] = [];
      if (Array.isArray(res)) {
        dataArray = res;
      } else if (res && typeof res === "object") {
        if (Array.isArray((res as any).data)) {
          dataArray = (res as any).data;
        } else if (Array.isArray((res as any).data?.data)) {
          dataArray = (res as any).data.data;
        }
      }
      setRows(dataArray);
    } catch (err) {
      console.error("frontend loadCurrentList - error:", err);
      toast.error("Failed to load supplier material pricing.");
    } finally {
      setLoading(false);
    }
  };

  const loadSupplierName = async () => {
    if (!supplierId) return;
    try {
      const supplier = await supplierService.fetchById(supplierId);
      setSupplierName(supplier.legalName || supplier.displayName || "");
    } catch (err) {
      console.error("Failed to load supplier details:", err);
    }
  };

  useEffect(() => {
    loadCurrentList();
    loadSupplierName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  const toggleHistory = async (row: SupplierMaterialPriceRow) => {
    const materialId = row.rawMaterialId;

    if (expandedMaterialId === materialId) {
      setExpandedMaterialId(null);
      return;
    }
    setExpandedMaterialId(materialId);

    if (!historyByMaterial[materialId]) {
      setHistoryLoading(materialId);
      try {
        const res = await supplierMaterialPriceService.fetchHistory(supplierId!, materialId);
        let historyArray: SupplierMaterialPrice[] = [];
        if (Array.isArray(res)) {
          historyArray = res;
        } else if (res && typeof res === "object") {
          if (Array.isArray((res as any).data)) {
            historyArray = (res as any).data;
          } else if (Array.isArray((res as any).data?.data)) {
            historyArray = (res as any).data.data;
          }
        }
        setHistoryByMaterial((prev) => ({ ...prev, [materialId]: historyArray }));
      } catch (err) {
        console.error(err);
        toast.error("Failed to load price history.");
      } finally {
        setHistoryLoading(null);
      }
    }
  };

  const openReviseModal = (row: SupplierMaterialPriceRow) => {
    setReviseTarget(row);
    setRevisePrice("");
    setReviseDate(todayISO());
  };

  const closeReviseModal = () => {
    setReviseTarget(null);
  };

  const submitRevise = async () => {
    if (!reviseTarget || !supplierId) return;

    const priceNum = Number(revisePrice);
    if (!revisePrice || isNaN(priceNum) || priceNum <= 0) {
      toast.error("Enter a valid price greater than 0.");
      return;
    }
    if (!reviseDate) {
      toast.error("Select an effective (valid from) date.");
      return;
    }

    setRevising(true);
    try {
      await supplierMaterialPriceService.revise(supplierId, {
        rawMaterialId: reviseTarget.rawMaterialId,
        price: priceNum,
        validFrom: reviseDate,
      });

      toast.success(`Price for "${reviseTarget.materialName}" updated.`);

      setHistoryByMaterial((prev) => {
        const copy = { ...prev };
        delete copy[reviseTarget.rawMaterialId];
        return copy;
      });

      closeReviseModal();
      loadCurrentList();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.response?.data?.message || "Failed to revise price.");
    } finally {
      setRevising(false);
    }
  };

  const columns: DataTableColumn<SupplierMaterialPriceRow>[] = [
    {
      header: "Raw material",
      render: (row) => <span className="font-semibold text-ink">{row.materialName}</span>,
    },
    {
      header: "Current price",
      align: "right",
      render: (row) => (
        <span className="font-semibold tabular-nums text-ink">{fmtMoney(row.price)}</span>
      ),
    },
    {
      header: "Valid from",
      render: (row) => (
        <span className="tabular-nums text-ink-muted">{fmtDate(row.validFrom)}</span>
      ),
    },
    {
      header: "Revisions",
      align: "right",
      render: (row) => (
        <Chip size="sm" tone="muted" className="tabular-nums">
          {row.revisionCount}
        </Chip>
      ),
    },
    {
      header: "Actions",
      align: "right",
      render: (row) => {
        const isExpanded = expandedMaterialId === row.rawMaterialId;
        return (
          <div className="flex items-center justify-end gap-2">
            <ActionPill
              size="sm"
              variant="secondary"
              icon={<History size={15} />}
              iconRight={isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              aria-expanded={isExpanded}
              onClick={() => toggleHistory(row)}
            >
              History
            </ActionPill>
            <ActionPill size="sm" variant="blue" onClick={() => openReviseModal(row)}>
              Revise Price
            </ActionPill>
          </div>
        );
      },
    },
  ];

  const renderHistory = (row: SupplierMaterialPriceRow) => {
    if (expandedMaterialId !== row.rawMaterialId) return null;
    const history = historyByMaterial[row.rawMaterialId];
    return (
      <div className="bg-card-2 px-4 py-4 sm:px-6">
        {historyLoading === row.rawMaterialId ? (
          <SkeletonRows rows={3} columns={4} rowHeight={40} label="Loading history" />
        ) : (
          <div className="sl-tile overflow-hidden">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Price history of {row.materialName}</caption>
              <thead className="bg-card-2">
                <tr>
                  <th scope="col" className="sl-th px-4 py-2.5 text-right">
                    Price
                  </th>
                  <th scope="col" className="sl-th px-4 py-2.5">
                    Valid from
                  </th>
                  <th scope="col" className="sl-th px-4 py-2.5">
                    Valid to
                  </th>
                  <th scope="col" className="sl-th px-4 py-2.5">
                    Recorded on
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {(history || [])
                  .slice()
                  .sort((a, b) => b.validFrom.localeCompare(a.validFrom))
                  .map((h) => (
                    <tr key={h.id}>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink">
                        {fmtMoney(h.price)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-muted">
                        {fmtDate(h.validFrom)}
                      </td>
                      <td className="px-4 py-2.5">
                        {h.validTo ? (
                          <span className="tabular-nums text-ink-muted">{fmtDate(h.validTo)}</span>
                        ) : (
                          <Chip size="sm" tone="success" dot>
                            Current
                          </Chip>
                        )}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-subtle">
                        {fmtDate(h.createdAt)}
                      </td>
                    </tr>
                  ))}
                {(!history || history.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                      No history found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Raw Material Pricing"
        subtitle={
          supplierName
            ? `${supplierName} · a revision closes the current price and keeps it in history`
            : "A revision closes the current price and keeps it in history"
        }
        back="/suppliers"
        backLabel="Back to Suppliers"
        breadcrumbs={[
          { label: "Suppliers", to: "/suppliers" },
          { label: supplierName || "Pricing" },
        ]}
      />

      <DataTable
        columns={columns}
        data={rows}
        rowKey={(row) => row.rawMaterialId}
        loading={loading}
        ariaLabel="Raw material prices"
        emptyMessage="No raw materials priced for this supplier yet."
        renderSubRow={renderHistory}
      />

      {/* REVISE PRICE MODAL */}
      {reviseTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
          <div className="sl-backdrop" onClick={closeReviseModal} aria-hidden="true" />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="revise-price-title"
            className="sl-dialog mx-auto flex w-full max-w-lg flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-line-soft px-6 py-4">
              <h3 id="revise-price-title" className="sl-h2 m-0">
                Revise Price{" "}
                <span className="font-normal text-ink-muted">· {reviseTarget.materialName}</span>
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={closeReviseModal}
                className="sl-icon-btn sl-icon-btn-ghost"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6 rounded-[14px] bg-chip p-4">
                <p className="m-0 text-sm leading-relaxed text-chip-fg">
                  Current price is{" "}
                  <strong className="font-semibold tabular-nums">
                    {fmtMoney(reviseTarget.price)}
                  </strong>{" "}
                  since <span className="font-medium">{fmtDate(reviseTarget.validFrom)}</span>.
                  Setting a new price below will close the current row and start a new one — the old
                  price stays in history.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <TextInput
                  label="New Price (₹)"
                  name="revisePrice"
                  type="number"
                  value={revisePrice}
                  onChange={(e) => setRevisePrice(e.target.value)}
                  min={0}
                  step={0.01}
                  required
                />
                <TextInput
                  label="Effective From"
                  name="reviseDate"
                  type="date"
                  value={reviseDate}
                  onChange={(e) => setReviseDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-line-soft px-6 py-4">
              <ActionPill variant="secondary" onClick={closeReviseModal}>
                Cancel
              </ActionPill>
              <ActionPill onClick={submitRevise} loading={revising} loadingText="Saving...">
                Save New Price
              </ActionPill>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierMaterialPricingList;
