import React, { useState, useCallback, useEffect, useMemo } from "react";
import { FaFilePdf } from "react-icons/fa";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SearchField,
  SkeletonRows,
  SkeletonTile,
  Tile,
} from "../../../../components/ui/v2";
import { KeyFigure } from "../../../sales/shared/tradeUi";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useSelector, useDispatch } from "react-redux";

import CancelReasonModal from "../../../../components/ui/CancelReasonModal/CancelReasonModal";
import { grnInvoiceService } from "../../../../services/grnInvoiceService";
import { useSocketSync } from "../../../../hooks/useSocketSync";
import { fetchCompany } from "../../../../features/company/companySlice";
import CommonLoader from "../../../../components/ui/Loader/CommonLoader";
import { usePermission } from "../../../../hooks/usePermission";
import { assetService, type AssetClassRow } from "../../../../services/assetService";
import { bankingService, type ChequeRow } from "../../../../services/bankingService";

// ─── Formatting helpers ─────────────────────────────────────────────────
const formatMoney = (val: string | number | null | undefined) => {
  const n = Number(val ?? 0);
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (val: string | null | undefined) => {
  if (!val) return "—";
  return new Date(val).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

// Basic number-to-words for Indian Rupees (integer part only)
const numberToWords = (num: number): string => {
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000)
      return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + inWords(n % 100) : "");
    if (n < 100000)
      return (
        inWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + inWords(n % 1000) : "")
      );
    if (n < 10000000)
      return (
        inWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + inWords(n % 100000) : "")
      );
    return (
      inWords(Math.floor(n / 10000000)) +
      " Crore" +
      (n % 10000000 ? " " + inWords(n % 10000000) : "")
    );
  };

  const rounded = Math.round(num);
  if (rounded === 0) return "Zero Only";
  return inWords(rounded) + " Only";
};

const GrnInvoiceViewPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: idParam } = useParams<{ id: string }>();
  const dispatch = useDispatch<any>();
  const { data: company } = useSelector((state: any) => state.company);

  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);

  // Left pane list state
  const [invoicesList, setInvoicesList] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);
  const { can } = usePermission();
  const [capitalisingLine, setCapitalisingLine] = useState<{ id: string; label: string } | null>(
    null
  );
  // Cheque register rows for this GRN's payments (P2-06/P2-11) — sourceDocId names the invoice.
  const [cheques, setCheques] = useState<ChequeRow[]>([]);

  // Fetch company settings on mount
  useEffect(() => {
    dispatch(fetchCompany());
  }, [dispatch]);

  // Fetch all invoices for the sidebar list
  const fetchInvoicesList = useCallback(async () => {
    setLoadingList(true);
    try {
      const response = await grnInvoiceService.fetchAll({
        page: 1,
        pageSize: 100,
      });
      setInvoicesList(response.data || []);
    } catch (error) {
      console.error("Failed to load sidebar list", error);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoicesList();
  }, [fetchInvoicesList]);

  // Load active invoice detail by ID
  const loadDetail = useCallback(
    async (id: string) => {
      setLoadingDetail(true);
      try {
        const details = await grnInvoiceService.fetchById(id);
        setSelectedItem(details);
      } catch (error) {
        toast.error("Failed to load invoice details");
        navigate("/invoice");
      } finally {
        setLoadingDetail(false);
      }
    },
    [navigate]
  );

  useEffect(() => {
    if (idParam) {
      loadDetail(idParam);
    }
  }, [idParam, loadDetail]);

  // Cheque register rows for this bill's cheque payments (P2-11).
  useEffect(() => {
    if (!selectedItem?.id) {
      setCheques([]);
      return;
    }
    bankingService
      .cheques({ kind: "ISSUED" })
      .then((rows) =>
        setCheques((rows as any[]).filter((c) => c.sourceDocId === selectedItem.id) as ChequeRow[])
      )
      .catch(() => setCheques([]));
  }, [selectedItem?.id]);

  const handleSocketUpdate = useCallback(() => {
    fetchInvoicesList();
    if (idParam) {
      loadDetail(idParam);
    }
  }, [fetchInvoicesList, idParam, loadDetail]);

  useSocketSync("grnInvoice", undefined, handleSocketUpdate);

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

      // Determine redirect/selection after delete
      const remaining = invoicesList.filter((inv) => String(inv.id) !== String(itemToDelete));
      setInvoicesList(remaining);
      if (remaining.length > 0) {
        navigate(`/invoice/details/${remaining[0].id}`);
      } else {
        navigate("/invoice");
      }
    } catch (error: any) {
      console.error("❌ Delete error:", error);
      toast.error(error?.response?.data?.message || "Failed to delete invoice");
    }
  };

  // Filter sidebar list
  const filteredInvoices = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return invoicesList.filter((inv) => {
      const grnNumber = inv.grnNumber?.toLowerCase() ?? "";
      const invoiceNo = inv.invoiceNo?.toLowerCase() ?? "";
      const supplierName = (
        inv.supplier?.displayName ||
        inv.supplier?.legalName ||
        ""
      ).toLowerCase();
      return grnNumber.includes(term) || invoiceNo.includes(term) || supplierName.includes(term);
    });
  }, [invoicesList, searchTerm]);

  // Tax calculations per item (CGST/SGST or IGST)
  const isInterState = useMemo(() => {
    if (!selectedItem) return false;
    // P1-08: the stored supply type wins; older GRNs are read off their IGST amounts.
    if (selectedItem.supplyType) return selectedItem.supplyType !== "INTRA_STATE";
    return (selectedItem.items || []).some((item: any) => Number(item.igstAmount) > 0);
  }, [selectedItem]);

  const itemsWithTax = useMemo(() => {
    if (!selectedItem?.items) return [];
    return selectedItem.items.map((item: any) => {
      const qty = Number(item.quantity ?? item.qty ?? 0);
      const rate = Number(item.unitPrice ?? item.rate ?? 0);
      const amount = Number(item.taxableAmount ?? qty * rate);
      const taxPercent = Number(item.tax ?? 0);

      const cgstRate = Number(item.cgstRate ?? (isInterState ? 0 : taxPercent / 2));
      const sgstRate = Number(item.sgstRate ?? (isInterState ? 0 : taxPercent / 2));
      const igstRate = Number(item.igstRate ?? (isInterState ? taxPercent : 0));

      const cgstAmount = Number(item.cgstAmount ?? (amount * cgstRate) / 100);
      const sgstAmount = Number(item.sgstAmount ?? (amount * sgstRate) / 100);
      const igstAmount = Number(item.igstAmount ?? (amount * igstRate) / 100);

      const totalAmount = amount + cgstAmount + sgstAmount + igstAmount;

      return {
        ...item,
        qty,
        rate,
        amount,
        unit: item.uom || "Pcs.",
        cgstRate,
        sgstRate,
        igstRate,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalAmount,
      };
    });
  }, [selectedItem, isInterState]);

  const totalCgst = useMemo(
    () => itemsWithTax.reduce((s: number, i: any) => s + i.cgstAmount, 0),
    [itemsWithTax]
  );
  const totalSgst = useMemo(
    () => itemsWithTax.reduce((s: number, i: any) => s + i.sgstAmount, 0),
    [itemsWithTax]
  );
  const totalIgst = useMemo(
    () => itemsWithTax.reduce((s: number, i: any) => s + i.igstAmount, 0),
    [itemsWithTax]
  );
  const totalTaxable = useMemo(
    () => itemsWithTax.reduce((s: number, i: any) => s + i.amount, 0),
    [itemsWithTax]
  );
  const grandTotal = Number(
    selectedItem?.netAmount ?? totalTaxable + totalCgst + totalSgst + totalIgst
  );

  // Tax summary grouped by rate
  const taxSummary = useMemo(() => {
    const map = new Map<
      number,
      {
        taxRate: number;
        taxableAmt: number;
        cgstAmt: number;
        sgstAmt: number;
        igstAmt: number;
        totalTax: number;
      }
    >();
    itemsWithTax.forEach((item: any) => {
      const rate = item.cgstRate + item.sgstRate + item.igstRate;
      const existing = map.get(rate) || {
        taxRate: rate,
        taxableAmt: 0,
        cgstAmt: 0,
        sgstAmt: 0,
        igstAmt: 0,
        totalTax: 0,
      };
      existing.taxableAmt += item.amount;
      existing.cgstAmt += item.cgstAmount;
      existing.sgstAmt += item.sgstAmount;
      existing.igstAmt += item.igstAmount;
      existing.totalTax += item.cgstAmount + item.sgstAmount + item.igstAmount;
      map.set(rate, existing);
    });
    return Array.from(map.values());
  }, [itemsWithTax]);

  const hasTax = useMemo(
    () => totalCgst + totalSgst + totalIgst > 0,
    [totalCgst, totalSgst, totalIgst]
  );

  const amountInWords = useMemo(() => numberToWords(grandTotal), [grandTotal]);

  const handleDownloadPdf = async () => {
    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const { jsPDF } = await import("jspdf");

      const element = document.getElementById("printable-grn-invoice-card");
      if (!element) return;

      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL("image/png");

      const pdf = new jsPDF("p", "mm", "a4");
      const margin = 10;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pageWidth - 2 * margin;
      const availableHeight = pageHeight - 2 * margin;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      const renderHeight = Math.min(imgHeight, availableHeight);

      pdf.addImage(imgData, "PNG", margin, margin, imgWidth, renderHeight);

      pdf.save(
        `Purchase-Invoice-${selectedItem?.invoiceNo || selectedItem?.grnNumber || "invoice"}.pdf`
      );
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate PDF");
    }
  };

  const payStatus = String(selectedItem?.paymentStatus || "").toUpperCase();
  const grnCancelled = String(selectedItem?.status || "").toUpperCase() === "CANCELLED";

  return (
    <div className="sl-page-doc grid w-full grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)] print:block">
      {/* ── Left rail ── */}
      <aside
        aria-label="Bills and invoices"
        className="sl-tile no-print hidden h-[calc(100vh-140px)] flex-col overflow-hidden lg:sticky lg:top-4 lg:flex"
      >
        <div className="flex flex-col gap-3 border-b border-line-soft p-4">
          <button
            type="button"
            onClick={() => navigate("/invoice")}
            className="flex items-center gap-2 text-left text-base font-semibold text-ink hover:text-accent"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Bill & Invoice
          </button>
          <SearchField
            value={searchTerm}
            onValueChange={setSearchTerm}
            placeholder="Search bill or supplier"
            label="Search bills"
            className="sm:w-full"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loadingList ? (
            <SkeletonRows
              rows={6}
              columns={2}
              header={false}
              rowHeight={64}
              label="Loading invoices"
            />
          ) : (
            filteredInvoices.map((inv) => {
              const isSelected = String(inv.id) === String(idParam);
              const paid = inv.paymentStatus?.toUpperCase() === "PAID";
              return (
                <button
                  type="button"
                  key={inv.id}
                  onClick={() => navigate(`/invoice/details/${inv.id}`)}
                  aria-current={isSelected ? "page" : undefined}
                  className={`mb-1 block w-full rounded-[14px] px-3 py-2.5 text-left transition-colors ${isSelected ? "bg-nav-active" : "hover:bg-card-2"}`}
                >
                  <div className="mb-0.5 flex items-start justify-between gap-2">
                    <span className="font-semibold text-ink">{inv.invoiceNo || inv.grnNumber}</span>
                    <Chip size="sm" tone={paid ? "success" : "warning"}>
                      {inv.paymentStatus || "Unpaid"}
                    </Chip>
                  </div>
                  <div className="truncate text-[13px] text-ink-muted">
                    {inv.supplier?.displayName || inv.supplier?.legalName || "N/A"}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[12px] text-ink-subtle">
                    <span className="tabular-nums">{formatDate(inv.grnDate)}</span>
                    <span className="font-semibold tabular-nums text-ink">
                      ₹{formatMoney(inv.netAmount)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
          {!loadingList && filteredInvoices.length === 0 && (
            <div className="p-6 text-center text-sm text-ink-muted">No invoices found.</div>
          )}
        </div>
      </aside>

      {/* ── Right Content Panel ── */}
      <div className="min-w-0 print:block print:h-auto print:overflow-visible print:p-0">
        {loadingDetail ? (
          <div className="flex flex-col gap-4" role="status">
            <span className="sr-only">Loading invoice details...</span>
            <SkeletonTile lines={2} />
            <SkeletonTile lines={4} height={320} />
          </div>
        ) : !selectedItem ? (
          <Tile>
            <EmptyState
              icon={<FileText size={28} />}
              title="Select an invoice from the sidebar to view details."
              action={
                <ActionPill variant="secondary" onClick={() => navigate("/invoice")}>
                  Back to Bill & Invoice
                </ActionPill>
              }
            />
          </Tile>
        ) : (
          <div className="mx-auto max-w-5xl">
            <div className="no-print">
              <PageHeader
                title={`Purchase invoice #${selectedItem.invoiceNo || selectedItem.grnNumber}`}
                meta={
                  <>
                    {grnCancelled ? (
                      <Chip dot tone="danger">
                        Cancelled
                      </Chip>
                    ) : (
                      <Chip dot tone={payStatus === "PAID" ? "success" : "warning"}>
                        {selectedItem.paymentStatus || "Unpaid"}
                      </Chip>
                    )}
                    {selectedItem.reverseCharge && <Chip size="sm">Reverse charge</Chip>}
                  </>
                }
                subtitle={`${selectedItem.supplier?.displayName || selectedItem.supplier?.legalName || "Supplier"} · GRN ${selectedItem.grnNumber || "—"} · ${formatDate(selectedItem.grnDate)}`}
                back="/invoice"
                backLabel="Back to Bill & Invoice"
                actions={
                  <>
                    <ActionPill
                      variant="secondary"
                      icon={<Printer size={16} />}
                      onClick={() => window.print()}
                    >
                      Print
                    </ActionPill>
                    <ActionPill
                      variant="secondary"
                      icon={<Download size={16} />}
                      onClick={handleDownloadPdf}
                    >
                      Download PDF
                    </ActionPill>
                  </>
                }
              />
              <Tile className="mb-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <KeyFigure
                    label="Net amount"
                    value={`₹${formatMoney(selectedItem.netAmount)}`}
                    emphasis
                  />
                  <KeyFigure label="Supplier bill no" value={selectedItem.invoiceNo || "—"} />
                  <KeyFigure label="GRN date" value={formatDate(selectedItem.grnDate)} />
                  <KeyFigure label="Payment" value={selectedItem.paymentStatus || "Unpaid"} />
                </div>
              </Tile>
            </div>

            {/* Currency / TDS / Payments summary (P2-11) */}
            {(selectedItem.currencyCode && selectedItem.currencyCode !== "INR") ||
            Number(selectedItem.tdsAmount) > 0 ||
            (Array.isArray(selectedItem.payments) && selectedItem.payments.length > 0) ? (
              <div className="sl-tile no-print mb-4 space-y-3 p-4 text-sm sm:p-5">
                {selectedItem.currencyCode && selectedItem.currencyCode !== "INR" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="sl-chip sl-chip-sm">{selectedItem.currencyCode}</span>
                    <span className="text-ink">
                      {selectedItem.currencyCode}{" "}
                      {Number(selectedItem.foreignTotal ?? 0).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      @ ₹{Number(selectedItem.exchangeRate ?? 1).toFixed(4)} = ₹
                      {formatMoney(selectedItem.netAmount)}
                    </span>
                  </div>
                )}
                {Number(selectedItem.tdsAmount) > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="sl-chip sl-chip-sm sl-chip-warning">
                      TDS {selectedItem.tdsSectionCode}
                    </span>
                    <span className="text-ink">
                      ₹{formatMoney(selectedItem.tdsAmount)} deducted — net payable ₹
                      {formatMoney(Number(selectedItem.netAmount) - Number(selectedItem.tdsAmount))}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate("/compliance/tds")}
                      className="text-[13px] font-semibold text-accent hover:underline"
                    >
                      View deduction →
                    </button>
                  </div>
                )}
                {Array.isArray(selectedItem.payments) && selectedItem.payments.length > 0 && (
                  <div>
                    <div className="sl-section-label mb-1">Payments</div>
                    <div className="space-y-1">
                      {(selectedItem.payments as any[]).map((p: any, idx: number) => {
                        const isCheque =
                          String(p.instrumentType ?? "").toUpperCase() === "CHEQUE" ||
                          String(p.paymentMethod ?? "")
                            .toLowerCase()
                            .includes("cheque");
                        // Matched by cheque number AND cheque date within this bill's own cheques
                        // (P2-17) — `cheques` is already scoped to this GRN's `sourceDocId`, but
                        // two payments on the same bill can share a re-typed cheque number, so
                        // the date disambiguates which register row is which.
                        const cheque = isCheque
                          ? cheques.find(
                              (c) =>
                                c.chequeNo === p.chequeNo &&
                                (!p.chequeDate ||
                                  String(c.chequeDate).slice(0, 10) ===
                                    String(p.chequeDate).slice(0, 10))
                            )
                          : undefined;
                        const postDated =
                          isCheque &&
                          p.chequeDate &&
                          new Date(p.chequeDate).getTime() > new Date(p.paymentDate).getTime();
                        return (
                          <div
                            key={p.id || idx}
                            className="flex flex-wrap items-center gap-2 text-xs"
                          >
                            <span className="text-ink-subtle">{formatDate(p.paymentDate)}</span>
                            <span className="font-semibold text-ink">{p.paymentMethod}</span>
                            <span className="font-semibold tabular-nums text-ink">
                              ₹{formatMoney(p.amount)}
                            </span>
                            {isCheque && p.chequeNo && (
                              <span className="text-ink-subtle">Cheque #{p.chequeNo}</span>
                            )}
                            {postDated && (
                              <span className="sl-chip sl-chip-sm sl-chip-warning">Post-dated</span>
                            )}
                            {cheque && (
                              <span
                                className={`sl-chip sl-chip-sm ${
                                  cheque.status === "CLEARED"
                                    ? "sl-chip-success"
                                    : cheque.status === "BOUNCED"
                                      ? "sl-chip-danger"
                                      : ""
                                }`}
                              >
                                {cheque.status}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Print stylesheet */}
            <style>{`
                            @media print {
                                @page {
                                    size: A4 portrait;
                                    margin: 8mm;
                                }
                                body * {
                                    visibility: hidden !important;
                                }
                                #printable-grn-invoice-card, #printable-grn-invoice-card * {
                                    visibility: visible !important;
                                }
                                #printable-grn-invoice-card {
                                    position: absolute;
                                    left: 0;
                                    top: 0;
                                    width: 100%;
                                    height: 277mm;
                                    background: #fff !important;
                                    box-shadow: none !important;
                                    margin: 0 !important;
                                    border-width: 1px !important;
                                    font-size: 13px !important;
                                }
                                .no-print {
                                    display: none !important;
                                }
                                html, body {
                                    height: auto;
                                    overflow: visible !important;
                                }
                                table { page-break-inside: avoid; }
                            }
                        `}</style>

            {/* GST Tax Invoice Card */}
            <div
              id="printable-grn-invoice-card"
              className="font-[Arial,sans-serif] text-black bg-white border-[1.5px] border-black w-full flex flex-col box-border text-[14px] shadow-lg font-medium"
            >
              {/* Top bar */}
              {hasTax && (
                <div className="flex justify-between items-center px-4 py-2 border-b-[1.5px] border-black text-[13px] font-semibold">
                  <div>GSTIN : {company?.gstin || "-"}</div>
                  <div className="italic">Triplicate Copy</div>
                </div>
              )}

              {/* Header */}
              <div className="text-center border-b-[1.5px] border-black px-4 py-4">
                <div className="text-xl uppercase font-extrabold tracking-[3px]">
                  Purchase Invoice
                </div>
              </div>

              {/* Invoice meta block */}
              <div className="flex border-b-[1.5px] border-black">
                <div className="flex-1 border-r-[1.5px] border-black px-4 py-3 space-y-1.5">
                  <MetaRow label="GRN No." value={selectedItem.grnNumber} />
                  <MetaRow label="Dated" value={formatDate(selectedItem.grnDate)} />
                  <MetaRow label="Due Date" value={formatDate(selectedItem.billDueDate)} />
                </div>
                <div className="flex-1 px-4 py-3 space-y-1.5">
                  <MetaRow label="Invoice No." value={selectedItem.invoiceNo || "—"} />
                  {hasTax && (
                    <MetaRow
                      label="Reverse Charge"
                      value={selectedItem.reverseCharge ? "Yes" : "No"}
                    />
                  )}
                  {selectedItem.currencyCode && selectedItem.currencyCode !== "INR" && (
                    <MetaRow
                      label="Currency"
                      value={`${selectedItem.currencyCode} @ ₹${Number(selectedItem.exchangeRate ?? 1).toFixed(4)}`}
                    />
                  )}
                  {selectedItem.purchaseOrder?.poNumber && (
                    <MetaRow label="Ref. PO No." value={selectedItem.purchaseOrder.poNumber} />
                  )}
                </div>
              </div>

              {/* Billed From / Shipped To */}
              <div className="flex border-b-[1.5px] border-black">
                <div className="flex-1 border-r-[1.5px] border-black px-4 py-3">
                  <div className="font-bold mb-1.5 text-[14px]">Billed from (Supplier) :</div>
                  <div className="font-semibold text-[14px]">
                    {selectedItem.supplier?.displayName ||
                      selectedItem.supplier?.legalName ||
                      "N/A"}
                  </div>
                  <div className="font-semibold text-[13px] mt-0.5">
                    {selectedItem.billingAddressLine1}
                    <br />
                    {selectedItem.billingCity}, {selectedItem.billingState} -{" "}
                    {selectedItem.billingPincode}
                  </div>
                  {hasTax && selectedItem.supplier?.gstin && (
                    <div className="mt-1.5 text-[13px]">
                      GSTIN / UIN : {selectedItem.supplier.gstin}
                    </div>
                  )}
                  {selectedItem.supplier?.phone && (
                    <div className="mt-1 font-semibold text-[13px]">
                      Phone: {selectedItem.supplier.phone}
                    </div>
                  )}
                </div>
                <div className="flex-1 px-4 py-3">
                  <div className="font-bold mb-1.5 text-[14px]">Shipped to (Store) :</div>
                  <div className="font-semibold text-[14px]">
                    {selectedItem.store?.storeName || "N/A"}
                  </div>
                  <div className="font-semibold text-[13px] mt-0.5">
                    {selectedItem.shippingAddressLine1 || selectedItem.billingAddressLine1}
                    <br />
                    {selectedItem.shippingCity || selectedItem.billingCity},{" "}
                    {selectedItem.shippingState || selectedItem.billingState} -{" "}
                    {selectedItem.shippingPincode || selectedItem.billingPincode}
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    <Th w="35px">S.N.</Th>
                    <Th>Description of Goods</Th>
                    <Th w="62px">HSN</Th>
                    <Th w="55px" align="right">
                      Qty.
                    </Th>
                    <Th w="45px">Unit</Th>
                    <Th w="60px" align="right">
                      Price
                    </Th>
                    {hasTax &&
                      (isInterState ? (
                        <>
                          <Th w="50px">IGST Rate</Th>
                          <Th w="65px" align="right">
                            IGST Amt
                          </Th>
                        </>
                      ) : (
                        <>
                          <Th w="50px">CGST Rate</Th>
                          <Th w="65px" align="right">
                            CGST Amt
                          </Th>
                          <Th w="50px">SGST Rate</Th>
                          <Th w="65px" align="right">
                            SGST Amt
                          </Th>
                        </>
                      ))}
                    <Th w="70px" align="right">
                      Amount(Rs.)
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {itemsWithTax.map((item: any, idx: number) => (
                    <tr key={item.id || idx}>
                      <Td align="center">{idx + 1}.</Td>
                      <Td>{item.rawMaterial?.materialName || item.description || "N/A"}</Td>
                      <Td align="center">{item.hsnCode || ""}</Td>
                      <Td align="right">{item.qty}</Td>
                      <Td align="center">{item.unit}</Td>
                      <Td align="right">{formatMoney(item.rate)}</Td>
                      {hasTax &&
                        (isInterState ? (
                          <>
                            <Td align="center">{item.igstRate}%</Td>
                            <Td align="right">{formatMoney(item.igstAmount)}</Td>
                          </>
                        ) : (
                          <>
                            <Td align="center">{item.cgstRate}%</Td>
                            <Td align="right">{formatMoney(item.cgstAmount)}</Td>
                            <Td align="center">{item.sgstRate}%</Td>
                            <Td align="right">{formatMoney(item.sgstAmount)}</Td>
                          </>
                        ))}
                      <Td align="right">{formatMoney(item.amount)}</Td>
                    </tr>
                  ))}
                  {(!selectedItem.items || selectedItem.items.length === 0) && (
                    <tr>
                      <td
                        colSpan={!hasTax ? 6 : isInterState ? 8 : 10}
                        className="border border-black px-2 py-4 text-center text-slate-500"
                      >
                        No items found for this invoice.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      colSpan={!hasTax ? 6 : isInterState ? 8 : 10}
                      className="border border-black px-2 py-1 text-right font-bold"
                    >
                      Grand Total
                    </td>
                    <td className="border border-black px-2 py-1 text-right font-bold font-mono">
                      ₹{formatMoney(grandTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Tax Summary — only shown when tax exists */}
              {hasTax && taxSummary.length > 0 && (
                <table className="w-full border-collapse text-[13.5px] mt-1">
                  <thead>
                    <tr>
                      <Th w="60px">Tax Rate</Th>
                      <Th align="right">Taxable Amt.</Th>
                      {isInterState ? (
                        <Th align="right">IGST Amt.</Th>
                      ) : (
                        <>
                          <Th align="right">CGST Amt.</Th>
                          <Th align="right">SGST Amt.</Th>
                        </>
                      )}
                      <Th align="right">Total Tax</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxSummary.map((row, i) => (
                      <tr key={i}>
                        <Td align="center">{row.taxRate}%</Td>
                        <Td align="right">{formatMoney(row.taxableAmt)}</Td>
                        {isInterState ? (
                          <Td align="right">{formatMoney(row.igstAmt)}</Td>
                        ) : (
                          <>
                            <Td align="right">{formatMoney(row.cgstAmt)}</Td>
                            <Td align="right">{formatMoney(row.sgstAmt)}</Td>
                          </>
                        )}
                        <Td align="right">{formatMoney(row.totalTax)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Bottom section — pushed to bottom of page */}
              <div className="mt-auto">
                {/* Amount in words */}
                <div className="px-4 py-2 border-t-[1.5px] border-black text-[14px] font-bold">
                  Rupees {amountInWords}
                </div>

                {/* Bank details */}
                <div className="px-4 py-2 border-t-[1.5px] border-black text-[13px]">
                  <span className="font-bold">Bank Details :</span> BANK NAME :{" "}
                  {company?.bankName || "BANK OF BARODA"}
                  &nbsp;&nbsp; BRANCH : {company?.bankBranch || "PALGHAR BRANCH"} <br />
                  A/c No : {company?.bankAccountNo || "123456789012"} &nbsp;&nbsp; IFSC CODE :{" "}
                  {company?.bankIfsc || "BARB0PALGHA"}
                </div>

                {/* Remarks / Notes */}
                {selectedItem.remarks && (
                  <div className="px-4 py-2 border-t-[1.5px] border-black text-[13px] print:block">
                    <span className="font-bold">Remarks / Notes :</span> {selectedItem.remarks}
                  </div>
                )}

                {/* Footer: Terms + Signature */}
                <div className="flex border-t-[1.5px] border-black text-[13px]">
                  <div className="flex-1 border-r-[1.5px] border-black px-4 py-3">
                    <div className="font-bold mb-1">Terms &amp; Conditions</div>
                    <div>E &amp; O.E.</div>
                    <div>1. Goods once sold will not be taken back.</div>
                    <div>
                      2. Interest @ 18% p.a. will be charged if the payment is not made within the
                      stipulated time.
                    </div>
                  </div>
                  <div className="flex-1 px-4 py-3 flex flex-col justify-between">
                    <div className="font-bold">Receiver's Signature :</div>
                    <div className="text-right font-bold mt-8">
                      For {company?.legalName || company?.companyName || "Company"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Attachment Section */}
            {selectedItem.invoiceImage && (
              <div className="sl-tile no-print mt-4 p-4 sm:p-5">
                <div className="sl-section-label mb-3">Invoice Attachment</div>
                {selectedItem.invoiceImage.toLowerCase().endsWith(".pdf") ? (
                  <a
                    href={selectedItem.invoiceImage}
                    target="_blank"
                    rel="noreferrer"
                    className="sl-btn sl-pill-md"
                  >
                    <FaFilePdf size={14} /> View PDF Document
                  </a>
                ) : (
                  <div className="flex flex-col gap-3">
                    <img
                      src={selectedItem.invoiceImage}
                      alt="Invoice Copy"
                      className="max-h-60 max-w-sm rounded-[14px] border border-line-soft object-contain"
                    />
                    <a
                      href={selectedItem.invoiceImage}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-semibold text-accent hover:underline"
                    >
                      Open in New Tab
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Capitalise a line as a fixed asset (P2-07) */}
            {can("assets.create") && itemsWithTax.length > 0 && (
              <div className="sl-tile no-print mt-4 p-4 sm:p-5">
                <div className="sl-section-label mb-3">Capitalise as a fixed asset</div>
                <div className="flex flex-col gap-2">
                  {itemsWithTax.map((item: any, idx: number) => (
                    <div
                      key={item.id || idx}
                      className="flex items-center justify-between gap-3 rounded-[14px] bg-card-2 px-3 py-2 text-sm text-ink"
                    >
                      <span>
                        {item.rawMaterial?.materialName || item.description || "Line " + (idx + 1)}
                        {" — "}
                        {formatMoney(item.amount)}
                      </span>
                      <button
                        type="button"
                        className="sl-btn sl-pill-sm"
                        disabled={!item.id}
                        onClick={() =>
                          setCapitalisingLine({
                            id: item.id,
                            label: item.rawMaterial?.materialName || item.description || "",
                          })
                        }
                      >
                        Capitalise as asset
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {capitalisingLine && selectedItem && (
        <CapitaliseGrnLineDialog
          grnId={selectedItem.id}
          lineId={capitalisingLine.id}
          label={capitalisingLine.label}
          onCancel={() => setCapitalisingLine(null)}
          onDone={() => {
            setCapitalisingLine(null);
            toast.success("Capitalised as a fixed asset");
          }}
        />
      )}

      {/* Cancel with reason (P1-10d) */}
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

// ─── Small table helpers ─────────────────────────────────────────────
const MetaRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex text-[14px]">
    <span className="w-[120px] font-bold">{label}</span>
    <span>: {value}</span>
  </div>
);

const Th: React.FC<{
  children?: React.ReactNode;
  w?: string;
  align?: "left" | "center" | "right";
}> = ({ children, w, align = "left" }) => (
  <th
    className={`border border-black px-2.5 py-1.5 font-bold bg-[#f5f5f5] text-${align}`}
    style={w ? { width: w } : undefined}
  >
    {children}
  </th>
);

const Td: React.FC<{ children?: React.ReactNode; align?: "left" | "center" | "right" }> = ({
  children,
  align = "left",
}) => (
  <td className={`border border-black px-2.5 py-1.5 align-middle text-${align}`}>{children}</td>
);

/** Moves a GRN line's cost off the purchase ledger and onto the fixed-asset register (P2-07). */
const CapitaliseGrnLineDialog: React.FC<{
  grnId: string;
  lineId: string;
  label: string;
  onCancel: () => void;
  onDone: () => void;
}> = ({ grnId, lineId, label, onCancel, onDone }) => {
  const [classes, setClasses] = useState<AssetClassRow[]>([]);
  const [classId, setClassId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(label);
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
        sourceDocType: "GRN_INVOICE",
        sourceDocId: grnId,
        lineId,
        classId,
        code: code.trim(),
        name: name.trim(),
      });
      onDone();
    } catch (err) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          "Could not capitalise this line"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="sl-backdrop" aria-hidden="true" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="capitalise-title"
        className="sl-dialog w-full max-w-md p-5"
      >
        <h2 id="capitalise-title" className="sl-h2 m-0">
          Capitalise as an asset
        </h2>
        <p className="sl-muted m-0 mt-1 text-sm">
          {label}. The cost moves off the purchase ledger and onto the asset ledger.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <label className="sl-label flex-col items-start gap-1">
            Asset class
            <select
              className="sl-input h-11 w-full text-sm font-normal"
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
          <label className="sl-label flex-col items-start gap-1">
            Asset code
            <input
              className="sl-input h-11 w-full text-sm font-normal"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="FA-0001"
            />
          </label>
          <label className="sl-label flex-col items-start gap-1">
            Asset name
            <input
              className="sl-input h-11 w-full text-sm font-normal"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="sl-field-error m-0 mt-2">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <ActionPill variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </ActionPill>
          <ActionPill
            loading={busy}
            disabled={!classId || !code.trim() || !name.trim()}
            onClick={submit}
          >
            Capitalise
          </ActionPill>
        </div>
      </div>
    </div>
  );
};

export default GrnInvoiceViewPage;
