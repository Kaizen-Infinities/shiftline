// src/pages/sales/SalesInvoiceView.tsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { ArrowLeft, Download, IndianRupee, Printer } from "lucide-react";
import {
  ActionPill,
  Chip,
  PageHeader,
  SearchField,
  SectionLabel,
  SkeletonRows,
  SkeletonTile,
  Tile,
} from "../../components/ui/v2";
import { KeyFigure } from "../sales/shared/tradeUi";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { GST_STATES } from "@shiftline/shared";
import { useSelector, useDispatch } from "react-redux";
import { salesInvoiceService } from "../../services/salesInvoiceService";
import { useSocketSync } from "../../hooks/useSocketSync";
import { fetchCompany } from "../../features/company/companySlice";
import { customerService } from "../../services/customerService";
import EInvoicePanel from "../compliance/components/EInvoicePanel";
import EwayBillPanel from "../compliance/components/EwayBillPanel";
import CommonModal from "../../components/ui/Modal/CommonModal";
import TextInput from "../../components/form/TextInput/TextInput";
import SelectInput from "../../components/form/SelectInput/SelectInput";
import DateInput from "../../components/form/DateInput/DateInput";
import { usePermission } from "../../hooks/usePermission";

const stateName = (code?: string | null) =>
  GST_STATES.find((st) => st.code === code)?.name ?? code ?? "";

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

const getMobileFromCustomer = (cust: any) => {
  if (!cust) return "";
  const m = cust.mobile;
  if (Array.isArray(m) && m.length > 0) {
    return m[0].number || m[0].value || "";
  }
  if (typeof m === "string") return m;
  return "";
};

// Extracts address from CustomerAddress[] (addresses stored as JSON in each record)
const getCustomerAddress = (cust: any) => {
  if (!cust || !Array.isArray(cust.addresses) || cust.addresses.length === 0) return null;
  const defaultEntry = cust.addresses.find((a: any) => a.is_default) || cust.addresses[0];
  const addr = defaultEntry?.address;
  if (!addr || typeof addr !== "object") return null;
  return {
    addressLine1: addr.addressLine1 || addr.line1 || "",
    addressLine2: addr.addressLine2 || addr.line2 || "",
    city: addr.city || "",
    state: addr.state || "",
    pincode: addr.pincode || "",
  };
};

// Basic number-to-words for Indian Rupees (integer part only, extend as needed)
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

// ─── Component ─────────────────────────────────────────────────────────
const SalesInvoiceView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch<any>();
  const { id: idParam } = useParams<{ id: string }>();

  const [invoice, setInvoice] = useState<any | null>((location.state as any) || null);
  const [loading, setLoading] = useState(!location.state);

  const [invoicesList, setInvoicesList] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [customerBalance, setCustomerBalance] = useState<{ amount: number; type: string } | null>(
    null
  );

  const { data: company } = useSelector((state: any) => state.company);
  const { can } = usePermission();

  // P2-12: receipts recorded on this invoice, and the "Record receipt" dialog.
  const [receipts, setReceipts] = useState<any[]>([]);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [recordingReceipt, setRecordingReceipt] = useState(false);
  const [receiptForm, setReceiptForm] = useState({
    amount: "",
    paymentDate: new Date().toISOString().split("T")[0],
    instrumentType: "CASH" as "CASH" | "BANK" | "CHEQUE",
    referenceNumber: "",
    chequeNo: "",
    chequeDate: "",
    chequeBank: "",
    chequeParty: "",
    settlementRate: "",
  });
  const [receiptErrors, setReceiptErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    dispatch(fetchCompany());
  }, [dispatch]);

  const fetchList = useCallback(async () => {
    try {
      const response = await salesInvoiceService.fetchAll({ page: 1, pageSize: 100 });
      setInvoicesList(response.data || []);
    } catch (error) {
      console.error("Failed to load invoice list", error);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const loadDetail = useCallback(
    async (idToLoad: string) => {
      if (!idToLoad) return;
      setLoading(true);
      try {
        const data = await salesInvoiceService.fetchById(idToLoad);
        setInvoice(data);
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 404) {
          toast.error("Invoice not found");
          navigate("/sales-invoices");
        } else {
          toast.error("Failed to load invoice details");
        }
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  // Load invoice details when idParam changes
  useEffect(() => {
    const id = idParam || (location.state as any)?.id;
    if (!id) return;
    loadDetail(id.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam]);

  // P2-12: the receipts recorded on this invoice (cheque status joined in by the server).
  const loadReceipts = useCallback(async (invoiceId: string) => {
    try {
      const list = await salesInvoiceService.fetchReceipts(invoiceId);
      setReceipts(Array.isArray(list) ? list : []);
    } catch {
      setReceipts([]);
    }
  }, []);

  useEffect(() => {
    if (invoice?.id) loadReceipts(invoice.id);
  }, [invoice?.id, loadReceipts]);

  // Fetch customer balance when invoice loads
  useEffect(() => {
    if (!invoice?.customerId) {
      setCustomerBalance(null);
      return;
    }
    customerService
      .fetchById(invoice.customerId)
      .then((cust: any) => {
        const bal = Number(cust.balanceAmount ?? cust.netBalance ?? cust.openingBalance ?? 0);
        const bType = (cust.balanceType || cust.openingBalanceType || "").toString().toUpperCase();
        setCustomerBalance({
          amount: bal,
          type: bType.startsWith("D") ? "Dr" : bType.startsWith("C") ? "Cr" : "",
        });
      })
      .catch(() => setCustomerBalance(null));
  }, [invoice?.customerId, invoice?.id]);

  // Auto-navigate to first invoice only when there is no id at all
  useEffect(() => {
    const id = idParam || (location.state as any)?.id;
    if (!id && !loadingList && invoicesList.length > 0) {
      navigate(`/sales-invoices/details/${invoicesList[0].id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoicesList, loadingList]);

  const handleSocketUpdate = useCallback(() => {
    fetchList();
    // Re-load current invoice detail only if we have a valid database id (from URL param)
    if (idParam) {
      loadDetail(idParam);
    }
  }, [fetchList, idParam, loadDetail]);

  useSocketSync("salesInvoice", undefined, handleSocketUpdate);

  const filteredInvoices = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return invoicesList.filter((inv) => {
      const invoiceNo = inv.invoiceNo?.toLowerCase() ?? "";
      const customerName = (
        inv.customer?.displayName ||
        inv.customer?.firmName ||
        ""
      ).toLowerCase();
      return invoiceNo.includes(term) || customerName.includes(term);
    });
  }, [invoicesList, searchTerm]);

  // ─── Tax calculations per item (CGST/SGST or IGST) ─────────────────
  const isInterStateByName = useMemo(() => {
    if (!invoice) return false;
    return (invoice.items || []).some((item: any) => Number(item.igstAmount) > 0);
  }, [invoice]);
  // P1-08: the stored supply type wins; the name comparison only covers documents from before it.
  const isInterState = invoice?.supplyType
    ? invoice.supplyType !== "INTRA_STATE"
    : isInterStateByName;

  const itemsWithTax = useMemo(() => {
    if (!invoice?.items) return [];
    return invoice.items.map((item: any) => {
      const qty = Number(item.quantity ?? item.qty ?? 0);
      const rate = Number(item.unitPrice ?? item.rate ?? 0);
      const amount = Number(item.amount ?? qty * rate);
      const taxPercent = Number(item.taxRate ?? item.taxPercent ?? item.tax ?? 0);

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
        unit: item.product?.uom?.uomName || item.unit || "Pcs.",
        cgstRate,
        sgstRate,
        igstRate,
        cgstAmount,
        sgstAmount,
        igstAmount,
        totalAmount,
      };
    });
  }, [invoice, isInterState]);

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
  const totalTax = totalCgst + totalSgst + totalIgst;
  const invoiceDiscount = Number(invoice?.totalDiscount || 0);
  const invDiscountValue = Number(invoice?.discountValue || 0);
  const invDiscountType = (invoice as any)?.discountType || "";
  const grandTotal = Number(invoice?.grandTotal ?? totalTaxable + totalTax);

  // Parse charge rows from narration
  const CHARGE_META: Record<string, { label: string; sign: 1 | -1 }> = {
    LORRY_FREIGHT: { label: "Lorry Freight", sign: 1 },
    LORRY_FREIGHT_MINUS: { label: "Lorry Freight", sign: -1 },
    OTHERS_PLUS: { label: "Others", sign: 1 },
    OTHERS_MINUS: { label: "Others", sign: -1 },
    ROUND_OFF_PLUS: { label: "Round Off", sign: 1 },
    ROUND_OFF_MINUS: { label: "Round Off", sign: -1 },
    TDS: { label: "TDS", sign: -1 },
  };
  const viewChargeRows = useMemo(() => {
    const rows: any[] = [];
    // From narration
    if (invoice?.narration) {
      try {
        const parsed = JSON.parse(invoice.narration);
        (parsed?.__chargeRows__ || [])
          .filter((r: any) => Number(r.amount) > 0)
          .forEach((r: any) =>
            rows.push({
              label: CHARGE_META[r.type]?.label || r.type,
              sign: CHARGE_META[r.type]?.sign ?? 1,
              amount: Number(r.amount),
            })
          );
      } catch {}
    }
    // From billSundry
    const sundry = invoice?.billSundry;
    if (Array.isArray(sundry)) {
      sundry
        .filter((r: any) => Number(r.amount) > 0)
        .forEach((r: any) => {
          const typeStr = String(r.type || "").toUpperCase();
          const isDeduction = typeStr.includes("DISCOUNT") || typeStr.includes("MINUS");
          const cleanLabel = (r.type || "Sundry")
            .replace(/_/g, " ")
            .replace(/\b(MINUS|PLUS|minus|plus)\b/gi, "")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\b\w/g, (c: string) => c.toUpperCase());
          rows.push({
            label: cleanLabel || "Sundry",
            sign: isDeduction ? -1 : 1,
            amount: Number(r.amount),
          });
        });
    }
    return rows;
  }, [invoice?.narration, invoice?.billSundry]);

  const totalWeight = useMemo(
    () => itemsWithTax.reduce((s: number, i: any) => s + Number(i.weight || 0), 0),
    [itemsWithTax]
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

  const amountInWords = useMemo(() => numberToWords(grandTotal), [grandTotal]);

  const handleDownloadPdf = async () => {
    try {
      const html2canvas = (await import("html2canvas-pro")).default;
      const { jsPDF } = await import("jspdf");

      const element = document.getElementById("printable-invoice-card");
      if (!element) return;

      const canvas = await html2canvas(element, { scale: 2, useCORS: true });
      // JPEG keeps the page snapshot at a few hundred KB instead of several MB as PNG.
      const imgData = canvas.toDataURL("image/jpeg", 0.9);

      const pdf = new jsPDF("p", "mm", "a4");
      const margin = 10;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pageWidth - 2 * margin;
      const availableHeight = pageHeight - 2 * margin;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Use full available printable height for 1-page document to match print preview height
      const renderHeight = imgHeight < availableHeight ? availableHeight : imgHeight;

      let heightLeft = renderHeight;
      let position = margin;

      pdf.addImage(imgData, "JPEG", margin, position, imgWidth, renderHeight);
      heightLeft -= availableHeight;

      while (heightLeft > 0) {
        position -= availableHeight;
        pdf.addPage();
        pdf.addImage(imgData, "JPEG", margin, position, imgWidth, imgHeight);
        heightLeft -= availableHeight;
      }

      pdf.save(`Invoice-${invoice?.invoiceNo || "invoice"}.pdf`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to generate PDF");
    }
  };

  // P2-12: how much of the invoice is still outstanding (grand total plus TCS, less receipts).
  const alreadyReceived = useMemo(
    () => receipts.reduce((s, p: any) => s + (Number(p.amount) || 0), 0),
    [receipts]
  );
  const outstanding = Math.max(0, Math.round((grandTotal - alreadyReceived) * 100) / 100);
  const isForeign = invoice?.currencyCode && invoice.currencyCode !== "INR";

  const validateReceipt = (): boolean => {
    const errs: Record<string, string> = {};
    const amt = Number(receiptForm.amount);
    if (!amt || amt <= 0) errs.amount = "Amount must be greater than 0";
    else if (amt > outstanding + 0.01)
      errs.amount = `Exceeds the outstanding balance (₹${formatMoney(outstanding)})`;
    if (!receiptForm.paymentDate) errs.paymentDate = "Date is required";
    if (receiptForm.instrumentType === "CHEQUE" && !receiptForm.chequeNo.trim())
      errs.chequeNo = "Cheque number is required";
    setReceiptErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleRecordReceipt = async () => {
    if (!invoice?.id || !validateReceipt()) return;
    setRecordingReceipt(true);
    try {
      const payload: any = {
        amount: Number(receiptForm.amount),
        paymentDate: receiptForm.paymentDate,
        instrumentType: receiptForm.instrumentType,
        referenceNumber: receiptForm.referenceNumber || undefined,
      };
      if (receiptForm.instrumentType === "CHEQUE") {
        payload.chequeNo = receiptForm.chequeNo;
        payload.chequeDate = receiptForm.chequeDate || receiptForm.paymentDate;
        payload.chequeBank = receiptForm.chequeBank || undefined;
        payload.chequeParty = receiptForm.chequeParty || undefined;
      }
      if (isForeign && receiptForm.settlementRate) {
        payload.settlementRate = Number(receiptForm.settlementRate);
      }
      const updated = await salesInvoiceService.recordReceipt(invoice.id, payload);
      setInvoice(updated);
      await loadReceipts(invoice.id);
      toast.success("Receipt recorded");
      setShowReceiptModal(false);
      setReceiptForm({
        amount: "",
        paymentDate: new Date().toISOString().split("T")[0],
        instrumentType: "CASH",
        referenceNumber: "",
        chequeNo: "",
        chequeDate: "",
        chequeBank: "",
        chequeParty: "",
        settlementRate: "",
      });
      setReceiptErrors({});
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to record receipt");
    } finally {
      setRecordingReceipt(false);
    }
  };

  const isCancelled =
    Boolean(invoice?.cancelledAt) || String(invoice?.status || "").toUpperCase() === "CANCELLED";
  const canRecordReceipt =
    Boolean(invoice) && can("sales-invoices.edit") && !invoice?.cancelledAt && outstanding > 0;

  return (
    <div className="sl-page-doc grid w-full grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)] print:block">
      {/* ── Left rail: other invoices ── */}
      <aside
        aria-label="Sales invoices"
        className="sl-tile no-print hidden h-[calc(100vh-140px)] flex-col overflow-hidden lg:sticky lg:top-4 lg:flex"
      >
        <div className="flex flex-col gap-3 border-b border-line-soft p-4">
          <button
            type="button"
            onClick={() => navigate("/sales-invoices")}
            className="flex items-center gap-2 text-left text-base font-semibold text-ink hover:text-accent"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Sales Invoices
          </button>
          <SearchField
            value={searchTerm}
            onValueChange={setSearchTerm}
            placeholder="Search invoice or customer"
            label="Search invoices"
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
              const isSelected = String(inv.id) === String(idParam || invoice?.id);
              const st = String(inv.status || "").toUpperCase();
              return (
                <button
                  type="button"
                  key={inv.id}
                  onClick={() => navigate(`/sales-invoices/details/${inv.id}`)}
                  aria-current={isSelected ? "page" : undefined}
                  className={`mb-1 block w-full rounded-[14px] px-3 py-2.5 text-left transition-colors ${isSelected ? "bg-nav-active" : "hover:bg-card-2"}`}
                >
                  <div className="mb-0.5 flex items-start justify-between gap-2">
                    <span className="font-semibold text-ink">{inv.invoiceNo}</span>
                    <Chip
                      size="sm"
                      tone={st === "PAID" ? "success" : st === "CANCELLED" ? "danger" : "muted"}
                    >
                      {inv.status || "Draft"}
                    </Chip>
                  </div>
                  <div className="truncate text-[13px] text-ink-muted">
                    {inv.customer?.displayName || inv.customer?.firmName || "N/A"}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[12px] text-ink-subtle">
                    <span className="tabular-nums">{formatDate(inv.invoiceDate)}</span>
                    <span className="font-semibold tabular-nums text-ink">
                      ₹{formatMoney(inv.grandTotal)}
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

      {/* ── Right Content (Invoice Details) ── */}
      <div className="min-w-0 print:block print:h-auto print:overflow-visible print:p-0">
        {loading || !invoice ? (
          <div className="flex flex-col gap-4" role="status">
            <span className="sr-only">Loading invoice details...</span>
            <SkeletonTile lines={2} />
            <SkeletonTile lines={4} height={320} />
          </div>
        ) : (
          <div className="mx-auto max-w-5xl">
            <div className="no-print">
              <PageHeader
                title={`Sales invoice #${invoice.invoiceNo}`}
                meta={
                  isCancelled ? (
                    <Chip dot tone="danger">
                      Cancelled
                    </Chip>
                  ) : outstanding > 0 ? (
                    <Chip dot tone="warning">
                      Unpaid
                    </Chip>
                  ) : (
                    <Chip dot tone="success">
                      Paid
                    </Chip>
                  )
                }
                subtitle={`${invoice.customer?.displayName || invoice.customer?.firmName || "Customer"} · ${formatDate(invoice.invoiceDate)}`}
                back="/sales-invoices"
                backLabel="Back to Sales Invoices"
                primaryAction={
                  canRecordReceipt ? (
                    <ActionPill
                      icon={<IndianRupee size={17} />}
                      onClick={() => setShowReceiptModal(true)}
                    >
                      Record Receipt
                    </ActionPill>
                  ) : null
                }
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

              {/* Summary */}
              <Tile className="mb-4">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <KeyFigure
                    label="Invoice total"
                    value={`₹${formatMoney(invoice.grandTotal)}`}
                    emphasis
                  />
                  <KeyFigure label="Received" value={`₹${formatMoney(alreadyReceived)}`} />
                  <KeyFigure label="Outstanding" value={`₹${formatMoney(outstanding)}`} />
                  <KeyFigure
                    label="Customer GSTIN"
                    value={invoice.customerGstin ?? invoice.customer?.gstin ?? "Unregistered"}
                  />
                </div>
              </Tile>

              {/* Receipts (P2-12): cash, bank or cheque, and the cheque register's own status */}
              <Tile
                padding="none"
                title="Receipts"
                subtitle={`Received ₹${formatMoney(alreadyReceived)} · Outstanding ₹${formatMoney(outstanding)}`}
                className="mb-4"
              >
                {receipts.length === 0 ? (
                  <p className="m-0 px-4 pb-4 text-sm text-ink-subtle sm:px-5">
                    No receipts recorded yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto border-t border-line-soft">
                    <table className="w-full text-sm">
                      <caption className="sr-only">Receipts against this invoice</caption>
                      <thead className="bg-card-2">
                        <tr>
                          <th scope="col" className="sl-th px-4 py-2.5 text-left">
                            Date
                          </th>
                          <th scope="col" className="sl-th px-4 py-2.5 text-left">
                            Method
                          </th>
                          <th scope="col" className="sl-th px-4 py-2.5 text-left">
                            Reference
                          </th>
                          <th scope="col" className="sl-th px-4 py-2.5 text-left">
                            Cheque Status
                          </th>
                          <th scope="col" className="sl-th px-4 py-2.5 text-right">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipts.map((p: any, idx: number) => (
                          <tr key={p.id || idx} className="border-t border-line-soft">
                            <td className="px-4 py-2.5 tabular-nums text-ink">
                              {formatDate(p.paymentDate)}
                            </td>
                            <td className="px-4 py-2.5 text-ink">{p.paymentMethod || "—"}</td>
                            <td className="px-4 py-2.5 text-ink-subtle">
                              {p.referenceNumber || p.chequeNo || "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              {p.cheque ? (
                                <Chip
                                  size="sm"
                                  dot
                                  tone={
                                    p.cheque.status === "CLEARED"
                                      ? "success"
                                      : p.cheque.status === "BOUNCED"
                                        ? "danger"
                                        : "warning"
                                  }
                                >
                                  {p.cheque.status}
                                </Chip>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                              ₹{formatMoney(p.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Tile>

              {/* E-invoice (P1-11) */}
              <div className="mb-4">
                <EInvoicePanel
                  docType="INV"
                  docId={invoice.id}
                  docDate={invoice.invoiceDate}
                  buyerGstin={invoice.customerGstin ?? invoice.customer?.gstin}
                  documentCancelled={Boolean(invoice.cancelledAt)}
                />
                <div className="mt-3">
                  <EwayBillPanel
                    docType="INV"
                    docRef={invoice.id}
                    documentCancelled={Boolean(invoice.cancelledAt)}
                  />
                </div>
              </div>

              <SectionLabel>Invoice copy</SectionLabel>
            </div>

            {/* Print + screen overrides — invoice card always white/black regardless of theme */}
            <style>{`
                            #printable-invoice-card,
                            #printable-invoice-card * {
                                color: #000 !important;
                                border-color: #000 !important;
                            }
                            #printable-invoice-card {
                                background: #fff !important;
                            }
                            @media print {
                                @page { size: A4 portrait; margin: 10mm; }
                                html, body {
                                    background: #fff !important;
                                    height: auto;
                                    overflow: visible !important;
                                    margin: 0 !important;
                                    padding: 0 !important;
                                }
                                body * { visibility: hidden !important; }
                                #printable-invoice-card,
                                #printable-invoice-card * {
                                    visibility: visible !important;
                                    -webkit-print-color-adjust: exact;
                                    print-color-adjust: exact;
                                }
                                #printable-invoice-card {
                                    position: absolute;
                                    left: 0; top: 0;
                                    width: 100%;
                                    height: 100%;
                                    box-shadow: none !important;
                                    margin: 0 !important;
                                    padding: 4mm !important;
                                    font-size: 12px !important;
                                    border-width: 1.5px !important;
                                }
                                #printable-invoice-card table {
                                    font-size: 11px !important;
                                }
                                #printable-invoice-card td,
                                #printable-invoice-card th {
                                    padding: 2px 4px !important;
                                }
                                .no-print { display: none !important; visibility: hidden !important; }
                                .wt-hide { display: none !important; visibility: hidden !important; }
                            }
                        `}</style>

            {/* GST Tax Invoice Card — always white bg, black text */}
            <div
              id="printable-invoice-card"
              className="font-[Arial,sans-serif] border-[2px] w-full min-h-[100mm] flex flex-col justify-between box-border text-[13px] shadow-lg font-medium p-6"
            >
              <div>
                {/* Top bar */}

                {/* Header */}
                <div className="text-center border-b-[2px] border-black px-3 py-3">
                  <div className="text-base uppercase font-bold tracking-[3px]">
                    {invoice.documentType === "BILL_OF_SUPPLY"
                      ? "Bill of Supply"
                      : invoice.documentType === "EXPORT_INVOICE"
                        ? "Export Invoice"
                        : "Tax Invoice"}
                  </div>
                </div>

                {/* Invoice meta block */}
                <div className="flex border-b-[2px] border-black">
                  <div className="flex-1 border-r-[2px] border-black p-3 space-y-1.5">
                    <MetaRow label="Invoice No." value={invoice.invoiceNo} />
                    <MetaRow label="Dated" value={formatDate(invoice.invoiceDate)} />
                    <MetaRow
                      label="Due Date"
                      value={invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
                    />
                    {invoice.placeOfSupply && (
                      <MetaRow
                        label="Place of Supply"
                        value={`${stateName(invoice.placeOfSupply)} (${invoice.placeOfSupply})`}
                      />
                    )}
                    {invoice.documentType !== "BILL_OF_SUPPLY" && (
                      <MetaRow
                        label="Reverse Charge"
                        value={invoice.reverseCharge ? "Yes" : "No"}
                      />
                    )}
                  </div>
                  <div className="flex-1 p-3 space-y-1.5">
                    <MetaRow
                      label="Transport"
                      value={(invoice.transport as any)?.name || invoice.transportName || "—"}
                    />
                    {invoice.salesOrder?.orderNo && (
                      <MetaRow label="Ref. Order No." value={invoice.salesOrder.orderNo} />
                    )}
                    {invoice.numberOfBundle && (
                      <MetaRow label="No. of Bundle" value={String(invoice.numberOfBundle)} />
                    )}
                  </div>
                </div>

                {/* Billed To / Shipped To */}
                {(() => {
                  const cust = invoice.customer;
                  const so = invoice.salesOrder;
                  const custName = cust?.displayName || cust?.firmName || "N/A";
                  const mobile = so?.mobile || getMobileFromCustomer(cust);

                  // Billing: from sales order or customer
                  const billingAddr = {
                    line1: so?.billingAddressLine1 || cust?.billingAddressLine1 || "",
                    city: so?.billingCity || cust?.billingCity || "",
                    state: so?.billingState || cust?.billingState || "",
                    pincode: so?.billingPincode || cust?.billingPincode || "",
                  };
                  // Fallback to customer addresses if empty
                  if (!billingAddr.line1) {
                    const addr = getCustomerAddress(cust);
                    if (addr) {
                      billingAddr.line1 = addr.addressLine1;
                      billingAddr.city = addr.city;
                      billingAddr.state = addr.state;
                      billingAddr.pincode = addr.pincode;
                    }
                  }

                  // Shipping: from invoice → sales order → customer addresses → billing fallback
                  const shippingAddr = {
                    line1: invoice.shippingAddressLine1 || so?.shippingAddressLine1 || "",
                    city: invoice.shippingCity || so?.shippingCity || "",
                    state: invoice.shippingState || so?.shippingState || "",
                    pincode: invoice.shippingPincode || so?.shippingPincode || "",
                  };
                  if (
                    !shippingAddr.line1 &&
                    Array.isArray(cust?.addresses) &&
                    cust.addresses.length > 1
                  ) {
                    const secondAddr = cust.addresses[1]?.address || cust.addresses[1];
                    shippingAddr.line1 = secondAddr?.addressLine1 || secondAddr?.line1 || "";
                    shippingAddr.city = secondAddr?.city || "";
                    shippingAddr.state = secondAddr?.state || "";
                    shippingAddr.pincode = secondAddr?.pincode || "";
                  }
                  if (!shippingAddr.line1) {
                    shippingAddr.line1 = billingAddr.line1;
                    shippingAddr.city = billingAddr.city;
                    shippingAddr.state = billingAddr.state;
                    shippingAddr.pincode = billingAddr.pincode;
                  }

                  const formatAddr = (a: {
                    line1: string;
                    city: string;
                    state: string;
                    pincode: string;
                  }) =>
                    [
                      a.line1,
                      a.city,
                      a.state ? `${a.state}${a.pincode ? ` - ${a.pincode}` : ""}` : a.pincode,
                    ]
                      .filter(Boolean)
                      .join(", ");

                  return (
                    <div className="flex border-b-[2px] border-black">
                      <div className="flex-1 border-r-[2px] border-black p-3">
                        <div className="font-bold mb-1.5 text-[12px] uppercase tracking-wide">
                          Billed to :
                        </div>
                        <div className="font-semibold">{custName}</div>
                        <div className="font-semibold">{formatAddr(billingAddr)}</div>
                        {mobile && <div className="mt-1 font-semibold">Mobile: {mobile}</div>}
                      </div>
                      <div className="flex-1 p-3">
                        <div className="font-bold mb-1.5 text-[12px] uppercase tracking-wide">
                          Shipped to :
                        </div>
                        <div className="font-semibold">{custName}</div>
                        <div className="font-semibold">{formatAddr(shippingAddr)}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Items Table */}
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <Th w="35px">S.N.</Th>
                      <Th>Description of Goods</Th>
                      <Th w="62px">HSN/SAC</Th>
                      <Th w="55px" align="right">
                        Qty.
                      </Th>
                      <th
                        className="border border-black px-2 py-1 text-[11px] font-bold uppercase bg-gray-100 wt-hide"
                        style={{ width: "65px", textAlign: "right" }}
                      >
                        Weight(KG)
                      </th>
                      <Th w="60px" align="right">
                        Price
                      </Th>
                      <Th w="80px" align="right">
                        Amount(Rs.)
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsWithTax.map((item: any, idx: number) => (
                      <tr key={item.id || idx} style={{ height: "30px" }}>
                        <Td align="center">{idx + 1}.</Td>
                        <Td>{item.description || item.product?.productName || "N/A"}</Td>
                        <Td align="center">{item.hsnCode || item.product?.hsnCode?.code || ""}</Td>
                        <Td align="right">{item.qty}</Td>
                        <td className="border border-black px-2 py-1 text-right wt-hide">
                          {Number(item.weight || 0).toFixed(1)}
                        </td>
                        <Td align="right">{item.rate.toFixed(2)}</Td>
                        <Td align="right">{item.amount.toFixed(2)}</Td>
                      </tr>
                    ))}
                    {Array.from({ length: Math.max(0, 8 - itemsWithTax.length) }).map((_, idx) => (
                      <tr key={`empty-${idx}`} style={{ height: "24px" }}>
                        <Td align="center"></Td>
                        <Td></Td>
                        <Td></Td>
                        <Td align="right"></Td>
                        <td className="border border-black px-2 py-1 wt-hide"></td>
                        <Td align="right"></Td>
                        <Td align="right"></Td>
                      </tr>
                    ))}
                    {(!invoice.items || invoice.items.length === 0) && (
                      <tr>
                        <td
                          colSpan={7}
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
                        colSpan={4}
                        className="border border-black px-2 py-1 text-right font-bold"
                      >
                        Total
                      </td>
                      <td className="border border-black px-2 py-1 text-right font-bold wt-hide">
                        {totalWeight.toFixed(1)}
                      </td>
                      <td className="border border-black px-2 py-1"></td>
                      <td className="border border-black px-2 py-1 text-right font-bold">
                        {formatMoney(totalTaxable)}
                      </td>
                    </tr>
                    {invoiceDiscount > 0 && (
                      <>
                        <tr>
                          <td
                            colSpan={4}
                            className="border border-black px-2 py-1 text-right text-[13px] text-red-600"
                          >
                            Discount{" "}
                            {invDiscountValue > 0
                              ? `(${invDiscountValue}${invDiscountType === "PERCENT" ? "%" : " Flat"})`
                              : ""}{" "}
                            (-)
                          </td>
                          <td className="border border-black px-2 py-1 wt-hide"></td>
                          <td className="border border-black px-2 py-1 text-right text-[13px] text-red-600">
                            - {formatMoney(invoiceDiscount)}
                          </td>
                        </tr>
                        <tr>
                          <td
                            colSpan={4}
                            className="border border-black px-2 py-1 text-right text-[13px]"
                          >
                            Taxable Amount
                          </td>
                          <td className="border border-black px-2 py-1 wt-hide"></td>
                          <td className="border border-black px-2 py-1 text-right text-[13px]">
                            {formatMoney(totalTaxable - invoiceDiscount)}
                          </td>
                        </tr>
                      </>
                    )}
                    {totalTax > 0 &&
                      (isInterState ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="border border-black px-2 py-1 text-right text-[13px]"
                          >
                            IGST
                          </td>
                          <td className="border border-black px-2 py-1 wt-hide"></td>
                          <td className="border border-black px-2 py-1 text-right text-[13px]">
                            + {formatMoney(totalIgst)}
                          </td>
                        </tr>
                      ) : (
                        <>
                          <tr>
                            <td
                              colSpan={4}
                              className="border border-black px-2 py-1 text-right text-[13px]"
                            >
                              CGST
                            </td>
                            <td className="border border-black px-2 py-1 wt-hide"></td>
                            <td className="border border-black px-2 py-1 text-right text-[13px]">
                              + {formatMoney(totalCgst)}
                            </td>
                          </tr>
                          <tr>
                            <td
                              colSpan={4}
                              className="border border-black px-2 py-1 text-right text-[13px]"
                            >
                              SGST
                            </td>
                            <td className="border border-black px-2 py-1 wt-hide"></td>
                            <td className="border border-black px-2 py-1 text-right text-[13px]">
                              + {formatMoney(totalSgst)}
                            </td>
                          </tr>
                        </>
                      ))}
                    {Number(invoice.tcsAmount) > 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="border border-black px-2 py-1 text-right text-[13px]"
                        >
                          TCS{invoice.tcsSectionCode ? ` (u/s ${invoice.tcsSectionCode})` : ""}
                        </td>
                        <td className="border border-black px-2 py-1 wt-hide"></td>
                        <td className="border border-black px-2 py-1 text-right text-[13px]">
                          + {formatMoney(invoice.tcsAmount)}
                        </td>
                      </tr>
                    )}
                    {viewChargeRows.map((cr: any, idx: number) => (
                      <tr key={idx}>
                        <td
                          colSpan={4}
                          className="border border-black px-2 py-1 text-right text-[11px]"
                        >
                          {cr.label}
                        </td>
                        <td className="border border-black px-2 py-1 wt-hide"></td>
                        <td className="border border-black px-2 py-1 text-right text-[11px]">
                          {cr.sign === 1 ? "+" : "-"} {formatMoney(cr.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td
                        colSpan={4}
                        className="border border-black px-2 py-1 text-right font-bold"
                      >
                        Grand Total
                      </td>
                      <td className="border border-black px-2 py-1 wt-hide"></td>
                      <td className="border border-black px-2 py-1 text-right font-bold">
                        {formatMoney(grandTotal)}
                      </td>
                    </tr>
                  </tfoot>
                </table>

                {/* Amount in words */}
                <div className="px-3 py-2.5 border-t-[2px] border-black text-[13px]">
                  <span className="font-bold">Amount in Words:</span> Rupees {amountInWords}
                </div>

                {/* Customer Balance */}
                {customerBalance && (
                  <div className="border-t border-black">
                    {(() => {
                      const isDr = customerBalance.type === "Dr";
                      const invoiceAmt = grandTotal;
                      const closingRaw = isDr
                        ? customerBalance.amount + invoiceAmt
                        : customerBalance.amount - invoiceAmt;
                      const closingAbs = Math.abs(closingRaw);
                      const closingType =
                        closingRaw > 0
                          ? isDr
                            ? "Dr"
                            : "Cr"
                          : closingRaw < 0
                            ? isDr
                              ? "Cr"
                              : "Dr"
                            : "";
                      return (
                        <table className="w-full text-[13px]">
                          <tbody>
                            <tr>
                              <td className="px-2 py-1 text-right">Opening Balance</td>
                              <td className="px-2 py-1 text-right w-[120px]">
                                ₹
                                {customerBalance.amount.toLocaleString("en-IN", {
                                  minimumFractionDigits: 2,
                                })}{" "}
                                {customerBalance.type}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-right">Invoice Amount</td>
                              <td className="px-2 py-1 text-right">
                                ₹{invoiceAmt.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-2 py-1 text-right font-bold text-[14px]">
                                Closing Balance
                              </td>
                              <td className="px-2 py-1 text-right font-bold text-[15px]">
                                ₹{closingAbs.toLocaleString("en-IN", { minimumFractionDigits: 2 })}{" "}
                                {closingType}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>
                )}
              </div>

              <div>
                {/* Notes */}
                {invoice.notes && (
                  <div className="px-2 py-2 border-t border-black text-[13px]">
                    <span className="font-bold">Notes :</span> {invoice.notes}
                  </div>
                )}

                {/* Footer: Terms + Signature */}
                <div className="flex border-t-[2px] border-black text-[13px]">
                  <div className="flex-1 border-r border-black p-3">
                    <div className="font-bold text-[12px] uppercase tracking-wide">
                      Receiver's Signature :
                    </div>
                    <div className="mt-10"></div>
                  </div>
                  <div className="flex-1 p-3 flex flex-col justify-between">
                    <div></div>
                    <div className="text-right font-bold mt-10">
                      For {company?.legalName || company?.companyName || "Company"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* P2-12: Record receipt dialog */}
      <CommonModal
        show={showReceiptModal}
        onHide={() => {
          setShowReceiptModal(false);
          setReceiptErrors({});
        }}
        title="Record Receipt"
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2">
            <ActionPill
              variant="secondary"
              onClick={() => {
                setShowReceiptModal(false);
                setReceiptErrors({});
              }}
              disabled={recordingReceipt}
            >
              Cancel
            </ActionPill>
            <ActionPill
              onClick={handleRecordReceipt}
              loading={recordingReceipt}
              loadingText="Recording..."
            >
              Record Receipt
            </ActionPill>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-[14px] bg-chip px-3 py-2 text-sm text-chip-fg">
            Outstanding:{" "}
            <span className="font-semibold tabular-nums">₹{formatMoney(outstanding)}</span>
          </div>
          <TextInput
            label="Amount (₹) *"
            name="amount"
            type="number"
            value={receiptForm.amount}
            onChange={(e) => setReceiptForm((p) => ({ ...p, amount: e.target.value }))}
            error={receiptErrors.amount}
          />
          <DateInput
            label="Payment Date *"
            name="paymentDate"
            value={receiptForm.paymentDate}
            onChange={(e) => setReceiptForm((p) => ({ ...p, paymentDate: e.target.value }))}
          />
          {receiptErrors.paymentDate && (
            <span className="sl-field-error">{receiptErrors.paymentDate}</span>
          )}
          <SelectInput
            label="Instrument"
            name="instrumentType"
            value={receiptForm.instrumentType}
            options={[
              { label: "Cash", value: "CASH" },
              { label: "Bank Transfer", value: "BANK" },
              { label: "Cheque", value: "CHEQUE" },
            ]}
            onChange={(e) =>
              setReceiptForm((p) => ({ ...p, instrumentType: e.target.value as any }))
            }
          />
          {receiptForm.instrumentType !== "CHEQUE" && (
            <TextInput
              label="Reference Number"
              name="referenceNumber"
              value={receiptForm.referenceNumber}
              onChange={(e) => setReceiptForm((p) => ({ ...p, referenceNumber: e.target.value }))}
            />
          )}
          {receiptForm.instrumentType === "CHEQUE" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextInput
                label="Cheque No. *"
                name="chequeNo"
                value={receiptForm.chequeNo}
                onChange={(e) => setReceiptForm((p) => ({ ...p, chequeNo: e.target.value }))}
                error={receiptErrors.chequeNo}
              />
              <DateInput
                label="Cheque Date"
                name="chequeDate"
                value={receiptForm.chequeDate}
                onChange={(e) => setReceiptForm((p) => ({ ...p, chequeDate: e.target.value }))}
              />
              <TextInput
                label="Bank"
                name="chequeBank"
                value={receiptForm.chequeBank}
                onChange={(e) => setReceiptForm((p) => ({ ...p, chequeBank: e.target.value }))}
              />
              <TextInput
                label="Drawer"
                name="chequeParty"
                value={receiptForm.chequeParty}
                onChange={(e) => setReceiptForm((p) => ({ ...p, chequeParty: e.target.value }))}
              />
              <p className="sl-field-hint m-0 sm:col-span-2">
                A cheque dated after the payment date is treated as post-dated: the register row is
                created now, and the receipt posts only once it clears.
              </p>
            </div>
          )}
          {isForeign && (
            <TextInput
              label={`Settlement Rate (1 ${invoice?.currencyCode} = ₹, defaults to the rate table)`}
              name="settlementRate"
              type="number"
              value={receiptForm.settlementRate}
              onChange={(e) => setReceiptForm((p) => ({ ...p, settlementRate: e.target.value }))}
            />
          )}
        </div>
      </CommonModal>
    </div>
  );
};

// ─── Small table helpers ─────────────────────────────────────────────
const MetaRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex text-[13px]">
    <span className="w-[110px] font-bold">{label}</span>
    <span>: {value}</span>
  </div>
);

const Th: React.FC<{
  children?: React.ReactNode;
  w?: string;
  align?: "left" | "center" | "right";
}> = ({ children, w, align = "left" }) => (
  <th
    className={`border border-black px-2 py-1 font-bold bg-[#f7f7f7] text-${align}`}
    style={w ? { width: w } : undefined}
  >
    {children}
  </th>
);

const Td: React.FC<{ children?: React.ReactNode; align?: "left" | "center" | "right" }> = ({
  children,
  align = "left",
}) => <td className={`border border-black px-2 py-1 align-middle text-${align}`}>{children}</td>;

export default SalesInvoiceView;
