import React, { useState, useEffect, useMemo } from "react";
import { useFormShortcuts } from "../../../../hooks/useFormShortcuts";
import { PackageCheck, Plus, Trash2 } from "lucide-react";
import { ActionPill, Chip, PageHeader } from "../../../../components/ui/v2";
import { FormFooter, KeyHint, formatINR } from "../../../sales/shared/tradeUi";
import { Container, Row, Col } from "../../../../components/ui/TailwindPrimitives";
import {
  FaPlus,
  FaTrash,
  FaArrowLeft,
  FaBoxOpen,
  FaFileInvoice,
  FaMapMarkerAlt,
  FaTruck,
  FaUser,
  FaCreditCard,
  FaHashtag,
} from "react-icons/fa";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { GST_STATES } from "@shiftline/shared";
import { useT } from "../../../../i18n/I18nProvider";

import CustomButton from "../../../../components/ui/Button/Button";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import TextInput from "../../../../components/form/TextInput/TextInput";
import QuantityInput from "../../../../components/form/QuantityInput/QuantityInput";
import BackButton from "../../../../components/ui/BackButton/BackButton";
import AddressForm from "../../../../components/form/AddressFrom/AddressFrom";
import type { StateCityOption } from "../../../../components/ui/CityStateSelect/CityStateSelect";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import TextArea from "../../../../components/form/TextArea/TextArea";
import { purchaseOrderService } from "../../../../services/purchaseOrderService";
import { grnInvoiceService } from "../../../../services/grnInvoiceService";
import type { PurchaseOrder } from "../../../../features/purchaseOrder/types";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { useSuppliers } from "../../../../hooks/useSuppliers";
import { useUOMs } from "../../../../hooks/useUOMs";
import { usePermission } from "../../../../hooks/usePermission";
import { rawMaterialService } from "../../../../services/rawMaterialService";
import { fetchStores } from "../../../../features/stores/storeSlice";
import { useSelector } from "react-redux";
import FileUpload from "../../../../components/form/FileUpload/FileUpload";
import CommonLoader from "../../../../components/ui/Loader/CommonLoader";
import { getUomMultiplier } from "../pages/PurchaseOrderForm";
import {
  tdsService,
  type TdsSectionRow,
  type TdsRateDecision,
} from "../../../../services/tdsService";
import { currencyService, type CurrencyRow } from "../../../../services/advanceService";

// ─── Types ────────────────────────────────────────────────────────────────────
interface GRNItem {
  productId: string;
  description: string;
  uom: string;
  qty: number;
  unitPrice: number;
  tax: number;
  /** HSN/SAC printed on the line; defaults from the raw material master (P1-08). */
  hsnCode: string;
  taxableAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  netAmount: number;
}

const emptyItem = (): GRNItem => ({
  productId: "",
  description: "",
  uom: "",
  qty: 1,
  unitPrice: 0,
  tax: 0,
  hsnCode: "",
  taxableAmount: 0,
  cgstRate: 0,
  cgstAmount: 0,
  sgstRate: 0,
  sgstAmount: 0,
  igstRate: 0,
  igstAmount: 0,
  netAmount: 0,
});

// ─── Component ────────────────────────────────────────────────────────────────
const InvoiceDetailPage: React.FC = () => {
  const { t } = useT();
  const navigate = useNavigate();
  useFormShortcuts({});
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const dispatch = useAppDispatch();
  const { suppliers, loadSuppliers } = useSuppliers();
  const { data: stores } = useAppSelector((state: any) => state.stores);
  const { activeUOMs, loadActiveUOMs } = useUOMs();
  const { data: company } = useSelector((state: any) => state.company);
  const companyState = company?.state;
  const { can } = usePermission();
  const canViewTds = can("tds.view");

  const [saving, setSaving] = useState(false);
  const [loadingPOs, setLoadingPOs] = useState(true);
  const [loadingPO, setLoadingPO] = useState(false);
  const [approvedPOs, setApprovedPOs] = useState<PurchaseOrder[]>([]);
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);

  const [payments, setPayments] = useState<any[]>([]);
  const [newPayment, setNewPayment] = useState({
    amount: "",
    paymentMethod: "Bank Transfer",
    referenceNumber: "",
    paymentDate: new Date().toISOString().split("T")[0],
    // Instrument type (P2-06): a cheque payment schedules for its own clearing and gets its
    // own register row; cash/bank transfer post immediately as before.
    instrumentType: "BANK" as "CASH" | "BANK" | "CHEQUE",
    chequeNo: "",
    chequeDate: "",
    chequeBank: "",
    chequeParty: "",
  });
  const [paymentErrors, setPaymentErrors] = useState<Record<string, string>>({});

  // ── TDS (P2-05/P2-11) ─────────────────────────────────────────────────────────
  const [tdsSections, setTdsSections] = useState<TdsSectionRow[]>([]);
  const [tdsPreview, setTdsPreview] = useState<TdsRateDecision | null>(null);
  const [tdsPreviewLoading, setTdsPreviewLoading] = useState(false);
  const [tdsSectionTouched, setTdsSectionTouched] = useState(false);

  // ── Currency (P2-06/P2-11) ───────────────────────────────────────────────────
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [exchangeRateTouched, setExchangeRateTouched] = useState(false);

  // ── Form ─────────────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    poId: "",
    grnNumber: "GRN-" + new Date().getFullYear() + "-001",
    invoiceNo: "",
    grnDate: new Date().toISOString().split("T")[0],
    supplierId: "",
    storeId: "",
    billingAddressLine1: "",
    billingCountry: "India",
    billingCity: "",
    billingState: "",
    billingPincode: "",
    sameAsBilling: false,
    shippingAddressLine1: "",
    shippingCountry: "India",
    shippingCity: "",
    shippingState: "",
    shippingPincode: "",
    receiveDate: "",
    billDueDate: "",
    challanNo: "",
    transport: "",
    eWayBill: "",
    invoiceImage: null as File | null,
    remarks: "",
    // Supplier details
    contactName: "",
    mobileNumber: "",
    email: "",
    gstNumber: "",
    supplierAddress: "",
    // Summary extras
    discountType: "flat" as "flat" | "percent",
    discountValue: 0,
    roundingAdjust: 0,
    // Payment
    paymentStatus: "Unpaid",
    paymentMethod: "",
    referenceNumber: "",
    paymentDate: "",
    updateStock: true,
    // Tax payable by us under reverse charge (unregistered supplier, notified goods/services).
    reverseCharge: false,
    // TDS on this bill (P2-05): offered as a toggle + section, the preview before it's accepted.
    deductTds: false,
    tdsSectionCode: "",
    // Foreign-currency bill (P2-06): item rates arrive in this currency and convert to rupees.
    currencyCode: "INR",
    exchangeRate: 1,
  });

  const [items, setItems] = useState<GRNItem[]>([]);
  // GST nature of the inward supply (P1-08): state codes (GSTIN prefix), state names only as a fallback.
  const stateCodeOf = (code?: string | null, gstin?: string | null, stateName?: string | null) =>
    code ||
    (gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : "") ||
    GST_STATES.find(
      (st) =>
        st.name.toLowerCase() ===
        String(stateName ?? "")
          .trim()
          .toLowerCase()
    )?.code ||
    "";
  const isInterState = useMemo(() => {
    const supplier = (suppliers || []).find((sp: any) => String(sp.id) === String(form.supplierId));
    const from = stateCodeOf(
      supplier?.stateCode,
      supplier?.gstin,
      supplier?.billingState || form.billingState
    );
    const to = stateCodeOf(company?.stateCode, company?.gstin, companyState);
    if (!from || !to) return false;
    return from !== to;
  }, [suppliers, form.supplierId, form.billingState, company, companyState]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Fetch on mount ────────────────────────────────────────────────────────────
  useEffect(() => {
    dispatch(fetchStores({ storeCategory: "RAW_MATERIAL" }));
    loadSuppliers();
    loadActiveUOMs();
    purchaseOrderService
      .fetchAll({ status: "APPROVED,OPEN,PARTIALLY_RECEIVED" as any })
      .then((res) => {
        const list = Array.isArray(res) ? res : res?.data || [];
        setApprovedPOs(list);
      })
      .catch(() => toast.error(t("grn.toast.loadOrders")))
      .finally(() => setLoadingPOs(false));

    if (!id) {
      grnInvoiceService
        .fetchNextCode()
        .then((code) => {
          if (code) {
            setForm((prev) => ({ ...prev, grnNumber: code }));
          }
        })
        .catch((err) => console.error("Failed to fetch next GRN number:", err));
    }

    currencyService
      .list(false)
      .then((rows) => setCurrencies(rows))
      .catch(() => {
        /* the picker just falls back to INR-only */
      });

    if (canViewTds) {
      tdsService
        .sections()
        .then((rows) => setTdsSections(rows.filter((s) => !s.isTcs)))
        .catch(() => {
          /* the toggle just has nothing to offer */
        });
    }
  }, [dispatch, loadSuppliers, loadActiveUOMs, id, canViewTds]);

  useEffect(() => {
    if (id) {
      grnInvoiceService
        .fetchById(id)
        .then((invoice) => {
          const isClosed = ["CLOSED", "PAID"].includes((invoice.paymentStatus || "").toUpperCase());
          if (isClosed) {
            toast.error(t("grn.toast.paidLocked"));
            navigate("/invoice");
            return;
          }
          setForm((prev) => ({
            ...prev,
            poId: invoice.poId ? String(invoice.poId) : "",
            grnNumber: invoice.grnNumber || "",
            invoiceNo: invoice.invoiceNo || "",
            grnDate: invoice.grnDate ? invoice.grnDate.split("T")[0] : "",
            supplierId: invoice.supplierId ? String(invoice.supplierId) : "",
            storeId: invoice.storeId || "",
            billingAddressLine1: invoice.billingAddressLine1 || "",
            billingCity: invoice.billingCity || "",
            billingState: invoice.billingState || "",
            billingPincode: invoice.billingPincode || "",
            billingCountry: invoice.billingCountry || "India",
            sameAsBilling: invoice.sameAsBilling ?? false,
            shippingAddressLine1: invoice.shippingAddressLine1 || "",
            shippingCity: invoice.shippingCity || "",
            shippingState: invoice.shippingState || "",
            shippingPincode: invoice.shippingPincode || "",
            shippingCountry: invoice.shippingCountry || "India",
            receiveDate: invoice.receiveDate ? invoice.receiveDate.split("T")[0] : "",
            billDueDate: invoice.billDueDate ? invoice.billDueDate.split("T")[0] : "",
            challanNo: invoice.challanNo || "",
            transport: invoice.transport || "",
            eWayBill: invoice.eWayBill || "",
            remarks: invoice.remarks || "",
            discountType: invoice.discountType === "PERCENT" ? "percent" : "flat",
            discountValue: Number(invoice.discountValue) || 0,
            roundingAdjust: Number(invoice.roundingAdjust) || 0,
            paymentStatus: invoice.paymentStatus || "Unpaid",
            updateStock: invoice.updateStock ?? true,
            reverseCharge: Boolean(invoice.reverseCharge),
            deductTds: Boolean(invoice.tdsAmount),
            tdsSectionCode: invoice.tdsSectionCode || "",
            currencyCode: invoice.currencyCode || "INR",
            exchangeRate: Number(invoice.exchangeRate) || 1,
          }));
          setExchangeRateTouched(true);
          if (invoice.tdsSectionCode) {
            setTdsSectionTouched(true);
            setTdsPreview({
              rate:
                Number(invoice.tdsAmount) > 0
                  ? Math.round(
                      (Number(invoice.tdsAmount) /
                        Math.max(0.01, Number(invoice.subtotal) - Number(invoice.totalDiscount))) *
                        10000
                    ) / 100
                  : 0,
              reason: "Already deducted on this bill",
              base: Number(invoice.subtotal) - Number(invoice.totalDiscount),
              belowThreshold: false,
            });
          }

          const mappedItems = (invoice.items || []).map((item: any) => {
            const qty = Number(item.quantity);
            const unitPrice = Number(item.unitPrice);
            const tax = Number(item.tax) || 0;
            const itemRawMaterial = (rawMaterials || []).find(
              (rm: any) =>
                String(rm.rawMaterialId) === String(item.productId) ||
                String(rm.id) === String(item.productId)
            );
            const mult = getUomMultiplier(item.uom, itemRawMaterial?.baseUom);
            const taxableAmount = qty * mult * unitPrice;
            const totalGstAmount = (taxableAmount * tax) / 100;

            let cgstRate = 0,
              cgstAmount = 0,
              sgstRate = 0,
              sgstAmount = 0,
              igstRate = 0,
              igstAmount = 0;
            if (
              companyState &&
              invoice.billingState &&
              companyState.toLowerCase().trim() !== invoice.billingState.toLowerCase().trim()
            ) {
              igstRate = tax;
              igstAmount = totalGstAmount;
            } else {
              cgstRate = tax / 2;
              sgstRate = tax / 2;
              cgstAmount = totalGstAmount / 2;
              sgstAmount = totalGstAmount / 2;
            }

            const materialName =
              item.product?.materialName ||
              item.product?.productName ||
              item.description ||
              item.productId ||
              "—";

            return {
              productId: item.productId || "",
              hsnCode: item.hsnCode || "",
              description: materialName,
              uom: item.uom || "",
              qty,
              unitPrice,
              tax,
              taxableAmount,
              cgstRate,
              cgstAmount,
              sgstRate,
              sgstAmount,
              igstRate,
              igstAmount,
              netAmount: taxableAmount + totalGstAmount,
            };
          });
          setItems(mappedItems);

          const parsedPayments = invoice.payments
            ? typeof invoice.payments === "string"
              ? JSON.parse(invoice.payments)
              : invoice.payments
            : [];
          const legacyPayments = parsedPayments.map((p: any) => ({
            ...p,
            isPersisted: true,
          }));
          setPayments(legacyPayments);
        })
        .catch((err) => {
          console.error("Failed to load GRN Invoice:", err);
          toast.error(t("grn.toast.loadDetails"));
          navigate("/invoice");
        });
    }
  }, [id, navigate, companyState]);

  useEffect(() => {
    const fetchRawMaterials = async () => {
      try {
        const res = await rawMaterialService.fetchAll();
        setRawMaterials(Array.isArray(res) ? res : (res?.rawMaterials ?? []));
      } catch {
        toast.error(t("grn.toast.loadRm"));
      }
    };
    fetchRawMaterials();
  }, []);

  //---- gst api--//

  useEffect(() => {
    setItems((prev) => {
      if (prev.length === 0) return prev;
      return prev.map((item) => {
        const itemRawMaterial = (rawMaterials || []).find(
          (rm: any) =>
            String(rm.rawMaterialId) === String(item.productId) ||
            String(rm.id) === String(item.productId)
        );
        const mult = getUomMultiplier(item.uom, itemRawMaterial?.baseUom);
        const taxableAmount = item.qty * mult * item.unitPrice;
        const totalGstAmount = (taxableAmount * item.tax) / 100;
        let cgstRate = 0,
          cgstAmount = 0,
          sgstRate = 0,
          sgstAmount = 0,
          igstRate = 0,
          igstAmount = 0;
        if (isInterState) {
          igstRate = item.tax;
          igstAmount = totalGstAmount;
        } else {
          cgstRate = item.tax / 2;
          sgstRate = item.tax / 2;
          cgstAmount = totalGstAmount / 2;
          sgstAmount = totalGstAmount / 2;
        }
        return {
          ...item,
          taxableAmount,
          cgstRate,
          cgstAmount,
          sgstRate,
          sgstAmount,
          igstRate,
          igstAmount,
          netAmount: taxableAmount + totalGstAmount,
        };
      });
    });
  }, [isInterState, rawMaterials]);

  // ── When PO selected → auto-fill ─────────────────────────────────────────────
  useEffect(() => {
    if (isEditMode) return;
    if (!form.poId) {
      setSelectedPO(null);
      setItems([]);
      setForm((prev) => ({
        ...prev,
        supplierId: "",
        storeId: "",
        billingAddressLine1: "",
        billingCity: "",
        billingState: "",
        billingPincode: "",
        sameAsBilling: false,
        shippingAddressLine1: "",
        shippingCity: "",
        shippingState: "",
        shippingPincode: "",
        contactName: "",
        mobileNumber: "",
        email: "",
        gstNumber: "",
        supplierAddress: "",
      }));
      return;
    }
    setLoadingPO(true);
    purchaseOrderService
      .fetchById(form.poId)
      .then((po: any) => {
        setSelectedPO(po);
        const sup = po.supplier;
        const fullSupplier = (suppliers || []).find(
          (s: any) => String(s.id) === String(po.supplierId || sup?.id)
        );
        const matchedStore = (stores || []).find(
          (s: any) => s.location?.city?.toLowerCase() === po.billingCity?.toLowerCase()
        );
        setForm((prev) => ({
          ...prev,
          supplierId: String(po.supplierId || sup?.id || ""),
          storeId: String(po.storeId || matchedStore?.storeId || ""),
          // Billing = Supplier address
          billingAddressLine1: fullSupplier?.billingAddressLine1 || sup?.billingAddressLine1 || "",
          billingCountry: fullSupplier?.billingCountry || sup?.billingCountry || "India",
          billingCity: fullSupplier?.billingCity || sup?.billingCity || "",
          billingState: fullSupplier?.billingState || sup?.billingState || "",
          billingPincode: fullSupplier?.billingPincode || sup?.billingPincode || "",
          sameAsBilling: false,
          // Shipping = PO shipping address (your store/delivery address)
          shippingAddressLine1: po.shippingAddressLine1 || "",
          shippingCountry: po.shippingCountry || "India",
          shippingCity: po.shippingCity || "",
          shippingState: po.shippingState || "",
          shippingPincode: po.shippingPincode || "",
          gstNumber: fullSupplier?.gstin || "",
          contactName: fullSupplier?.contactPerson || "",
          mobileNumber:
            Array.isArray(fullSupplier?.mobile) && fullSupplier.mobile.length > 0
              ? fullSupplier.mobile[0].number
              : typeof fullSupplier?.mobile === "string"
                ? fullSupplier.mobile
                : "",
          email: fullSupplier?.email || "",
          supplierAddress: [
            fullSupplier?.billingAddressLine1,
            fullSupplier?.billingCity,
            fullSupplier?.billingState,
          ]
            .filter(Boolean)
            .join(", "),
        }));
        // Populate items from PO, setting qty to remaining unreceived quantity
        const autoPopulatedItems = (po.items || [])
          .map((item: any) => {
            const remainingQty = (Number(item.quantity) || 0) - (Number(item.receivedQty) || 0);
            const qty = remainingQty > 0 ? remainingQty : 0;
            const unitPrice = Number(item.unitPrice || 0);
            const tax = Number(item.tax || 0);
            const itemRawMaterial = (rawMaterials || []).find(
              (rm: any) =>
                String(rm.rawMaterialId) === String(item.productId) ||
                String(rm.id) === String(item.productId)
            );
            const mult = getUomMultiplier(item.uom, itemRawMaterial?.baseUom);
            const taxableAmount = qty * mult * unitPrice;
            const totalGstAmount = (taxableAmount * tax) / 100;
            const netAmount = taxableAmount + totalGstAmount;

            let cgstRate = 0,
              cgstAmount = 0,
              sgstRate = 0,
              sgstAmount = 0,
              igstRate = 0,
              igstAmount = 0;
            if (isInterState) {
              igstRate = tax;
              igstAmount = totalGstAmount;
            } else {
              cgstRate = tax / 2;
              sgstRate = tax / 2;
              cgstAmount = totalGstAmount / 2;
              sgstAmount = totalGstAmount / 2;
            }

            const matchingRm = (rawMaterials || []).find(
              (rm: any) =>
                String(rm.rawMaterialId) === String(item.productId) ||
                String(rm.id) === String(item.productId) ||
                String(rm.materialCode) === String(item.productId)
            );
            const desc =
              item.product?.materialName ||
              item.product?.productName ||
              matchingRm?.materialName ||
              item.description ||
              item.productId ||
              "";

            return {
              productId: item.productId || "",
              description: desc,
              uom: item.uom || matchingRm?.baseUom || "",
              qty,
              unitPrice,
              tax,
              taxableAmount,
              cgstRate,
              cgstAmount,
              sgstRate,
              sgstAmount,
              igstRate,
              igstAmount,
              netAmount,
            };
          })
          .filter((item: any) => item.qty > 0);

        setItems(autoPopulatedItems);
      })
      .catch(() => toast.error(t("grn.toast.loadPo")))
      .finally(() => setLoadingPO(false));
  }, [form.poId, suppliers, stores]);

  // ── When supplier selected manually → auto-fill supplier details ──────────────
  useEffect(() => {
    if (form.poId) return;
    const sup = (suppliers || []).find((s: any) => String(s.id) === String(form.supplierId));
    if (sup) {
      setForm((prev) => ({
        ...prev,
        gstNumber: (sup as any).gstin || "",
        contactName: (sup as any).contactPerson || "",
        mobileNumber:
          Array.isArray((sup as any)?.mobile) && (sup as any).mobile.length > 0
            ? (sup as any).mobile[0].number
            : typeof (sup as any)?.mobile === "string"
              ? (sup as any).mobile
              : "",
        email: (sup as any).email || "",
        supplierAddress: [
          (sup as any).billingAddressLine1,
          (sup as any).billingCity,
          (sup as any).billingState,
        ]
          .filter(Boolean)
          .join(", "),
        billingAddressLine1: (sup as any).billingAddressLine1 || "",
        billingCity: (sup as any).billingCity || "",
        billingState: (sup as any).billingState || "",
        billingPincode: (sup as any).billingPincode || "",
        billingCountry: (sup as any).billingCountry || "India",
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        gstNumber: "",
        contactName: "",
        mobileNumber: "",
        email: "",
        supplierAddress: "",
        billingAddressLine1: "",
        billingCity: "",
        billingState: "",
        billingPincode: "",
        billingCountry: "India",
      }));
    }
  }, [form.supplierId, form.poId, suppliers]);

  const selectedSupplier = useMemo(
    () => (suppliers || []).find((s: any) => String(s.id) === String(form.supplierId)) as any,
    [suppliers, form.supplierId]
  );

  // ── Default the TDS section from the supplier master (P2-11) ──────────────────
  // Only while the person has not picked a section themselves — picking one by hand always wins.
  useEffect(() => {
    if (isEditMode || tdsSectionTouched) return;
    if (selectedSupplier?.defaultTdsSectionCode && !form.tdsSectionCode) {
      setForm((prev) => ({ ...prev, tdsSectionCode: selectedSupplier.defaultTdsSectionCode }));
    }
  }, [selectedSupplier, isEditMode, tdsSectionTouched, form.tdsSectionCode]);

  // ── Default the exchange rate from the rate table for the invoice date (P2-11) ─
  useEffect(() => {
    if (isEditMode || exchangeRateTouched) return;
    if (form.currencyCode === "INR" || !form.grnDate) return;
    let cancelled = false;
    currencyService
      .rates({ currencyCode: form.currencyCode })
      .then((rows) => {
        if (cancelled) return;
        const asOn = new Date(form.grnDate).getTime();
        const onOrBefore = rows
          .filter((r) => new Date(r.rateDate).getTime() <= asOn)
          .sort((a, b) => new Date(b.rateDate).getTime() - new Date(a.rateDate).getTime());
        const best = onOrBefore[0] || rows[0];
        if (best) setForm((prev) => ({ ...prev, exchangeRate: Number(best.rate) }));
      })
      .catch(() => {
        /* the rate stays whatever it was; the field is still editable */
      });
    return () => {
      cancelled = true;
    };
  }, [form.currencyCode, form.grnDate, isEditMode, exchangeRateTouched]);

  // ── When store selected manually → auto-fill shipping from store address ──────
  useEffect(() => {
    if (form.poId || !form.storeId) return;
    const selectedStore = (stores || []).find((s: any) => s.storeId === form.storeId);
    let addr: any = null;
    if (selectedStore?.locationDesc) {
      try {
        addr = JSON.parse(selectedStore.locationDesc);
      } catch {
        /* not JSON */
      }
    }
    setForm((prev) => ({
      ...prev,
      shippingAddressLine1: addr?.addressLine || company?.addressLine1 || "",
      shippingCity: addr?.city || company?.city || "",
      shippingState: addr?.state || company?.state || "",
      shippingPincode: addr?.zipcode || company?.zipcode || "",
      shippingCountry: addr?.country || company?.country || "India",
    }));
  }, [form.storeId, form.poId, stores, company]);

  // ── Same as billing sync effect ──────────────────────────────────────────────
  useEffect(() => {
    if (form.sameAsBilling) {
      setForm((prev) => ({
        ...prev,
        shippingAddressLine1: prev.billingAddressLine1,
        shippingCountry: prev.billingCountry,
        shippingCity: prev.billingCity,
        shippingState: prev.billingState,
        shippingPincode: prev.billingPincode,
      }));
    }
  }, [
    form.sameAsBilling,
    form.billingAddressLine1,
    form.billingCountry,
    form.billingCity,
    form.billingState,
    form.billingPincode,
  ]);

  const handleBillingStateChange = (stateData: StateCityOption) => {
    setForm((prev) => ({
      ...prev,
      billingState: stateData.name,
      billingCity: "",
    }));
    setErrors((prev) => ({
      ...prev,
      billingState: "",
      billingCity: "",
    }));
  };

  const handleBillingCityChange = (cityData: StateCityOption) => {
    setForm((prev) => ({ ...prev, billingCity: cityData.name }));
    setErrors((prev) => ({ ...prev, billingCity: "" }));
  };

  const handleShippingStateChange = (stateData: StateCityOption) => {
    setForm((prev) => ({
      ...prev,
      shippingState: stateData.name,
      shippingCity: "",
    }));
    setErrors((prev) => ({
      ...prev,
      shippingState: "",
      shippingCity: "",
    }));
  };

  const handleShippingCityChange = (cityData: StateCityOption) => {
    setForm((prev) => ({ ...prev, shippingCity: cityData.name }));
    setErrors((prev) => ({ ...prev, shippingCity: "" }));
  };

  // ── Computed totals ───────────────────────────────────────────────────────────
  const subtotal = useMemo(
    () =>
      items.reduce((sum, i) => {
        const itemRawMaterial = (rawMaterials || []).find(
          (rm: any) =>
            String(rm.rawMaterialId) === String(i.productId) ||
            String(rm.id) === String(i.productId)
        );
        const mult = getUomMultiplier(i.uom, itemRawMaterial?.baseUom);
        return sum + i.qty * mult * i.unitPrice;
      }, 0),
    [items, rawMaterials]
  );

  const totalTax = useMemo(
    () =>
      items.reduce((sum, i) => {
        const itemRawMaterial = (rawMaterials || []).find(
          (rm: any) =>
            String(rm.rawMaterialId) === String(i.productId) ||
            String(rm.id) === String(i.productId)
        );
        const mult = getUomMultiplier(i.uom, itemRawMaterial?.baseUom);
        return sum + (i.qty * mult * i.unitPrice * i.tax) / 100;
      }, 0),
    [items, rawMaterials]
  );

  const totalCgst = useMemo(() => items.reduce((sum, i) => sum + i.cgstAmount, 0), [items]);
  const totalSgst = useMemo(() => items.reduce((sum, i) => sum + i.sgstAmount, 0), [items]);
  const totalIgst = useMemo(() => items.reduce((sum, i) => sum + i.igstAmount, 0), [items]);

  const gstRateBreakdown = useMemo(() => {
    const map = new Map<number, number>();
    (items || []).forEach((item) => {
      const qty = Number(item.qty) || 0;
      const price = Number(item.unitPrice) || 0;
      const itemRawMaterial = (rawMaterials || []).find(
        (rm: any) =>
          String(rm.rawMaterialId) === String(item.productId) ||
          String(rm.id) === String(item.productId)
      );
      const mult = getUomMultiplier(item.uom, itemRawMaterial?.baseUom);
      const taxable = qty * mult * price;
      const rate = Number(item.tax) || 0;
      map.set(rate, (map.get(rate) || 0) + taxable);
    });

    const sortedRates = Array.from(map.keys()).sort((a, b) => a - b);

    return sortedRates.map((rate) => {
      const taxableForRate = map.get(rate) || 0;
      const cgstRate = rate / 2;
      const sgstRate = rate / 2;
      const cgstAmount = taxableForRate * (cgstRate / 100);
      const sgstAmount = taxableForRate * (sgstRate / 100);
      const igstAmount = taxableForRate * (rate / 100);
      return {
        gstRate: rate,
        cgstRate,
        sgstRate,
        cgstAmount,
        sgstAmount,
        igstAmount,
      };
    });
  }, [items, rawMaterials]);
  const discountAmount = useMemo(() => {
    if (form.discountType === "percent") return (subtotal * form.discountValue) / 100;
    return Number(form.discountValue) || 0;
  }, [subtotal, form.discountType, form.discountValue]);

  const [roundingSign, setRoundingSign] = useState<"+" | "-">("+");

  const grandTotal = useMemo(() => {
    const rounding =
      roundingSign === "+" ? Number(form.roundingAdjust || 0) : -Number(form.roundingAdjust || 0);
    // Under reverse charge the supplier is paid without GST; the tax goes to the government.
    return subtotal - discountAmount + (form.reverseCharge ? 0 : totalTax) + rounding;
  }, [subtotal, discountAmount, totalTax, form.roundingAdjust, roundingSign, form.reverseCharge]);

  // ── Live TDS preview (P2-11) ────────────────────────────────────────────────
  useEffect(() => {
    if (!canViewTds || !form.deductTds || !form.tdsSectionCode || !form.supplierId) {
      if (!form.deductTds) setTdsPreview(null);
      return;
    }
    if (isEditMode) return; // already-saved deductions are shown from the invoice itself
    const base = Math.max(0, subtotal - discountAmount);
    if (base <= 0) {
      setTdsPreview(null);
      return;
    }
    let cancelled = false;
    setTdsPreviewLoading(true);
    tdsService
      .preview({
        sectionCode: form.tdsSectionCode,
        supplierId: Number(form.supplierId),
        deducteePan: selectedSupplier?.pan ?? null,
        deducteeType: selectedSupplier?.deducteeType ?? undefined,
        higherRate: selectedSupplier?.higherRate206AB ?? false,
        amount: base,
        on: form.grnDate || undefined,
      })
      .then((res) => {
        if (!cancelled) setTdsPreview(res);
      })
      .catch(() => {
        if (!cancelled) setTdsPreview(null);
      })
      .finally(() => {
        if (!cancelled) setTdsPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    canViewTds,
    form.deductTds,
    form.tdsSectionCode,
    form.supplierId,
    form.grnDate,
    selectedSupplier,
    subtotal,
    discountAmount,
    isEditMode,
  ]);

  const tdsAmount = useMemo(() => {
    if (!tdsPreview) return 0;
    return Math.round(((tdsPreview.base * tdsPreview.rate) / 100) * 100) / 100;
  }, [tdsPreview]);

  const foreignTotal = useMemo(() => {
    if (form.currencyCode === "INR" || !form.exchangeRate) return null;
    return Math.round((grandTotal / form.exchangeRate) * 100) / 100;
  }, [form.currencyCode, form.exchangeRate, grandTotal]);

  const netPayable = useMemo(() => Math.max(0, grandTotal - tdsAmount), [grandTotal, tdsAmount]);

  const totalPaid = useMemo(
    () => payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [payments]
  );
  const balanceDue = useMemo(() => Math.max(0, grandTotal - totalPaid), [grandTotal, totalPaid]);
  const isOverpaid = useMemo(() => totalPaid > grandTotal, [grandTotal, totalPaid]);
  const computedStatus = useMemo(() => {
    if (totalPaid === 0) return "Unpaid";
    if (totalPaid >= grandTotal) return "Paid";
    return "Partial";
  }, [totalPaid, grandTotal]);

  const isChequeInstrument = newPayment.instrumentType === "CHEQUE";
  const isPostDatedCheque = useMemo(() => {
    if (!isChequeInstrument || !newPayment.chequeDate || !newPayment.paymentDate) return false;
    return new Date(newPayment.chequeDate).getTime() > new Date(newPayment.paymentDate).getTime();
  }, [isChequeInstrument, newPayment.chequeDate, newPayment.paymentDate]);

  const handleAddPayment = () => {
    const errs: Record<string, string> = {};
    const amt = Number(newPayment.amount);
    if (isNaN(amt) || amt <= 0) errs.amount = "Amount must be greater than 0";
    if (isEditMode && amt > balanceDue) {
      errs.amount = `Cannot exceed the remaining balance due of ₹${balanceDue.toFixed(2)}`;
    }
    if (newPayment.paymentMethod.toLowerCase() !== "cash" && !newPayment.referenceNumber.trim()) {
      errs.referenceNumber = "Reference number is required for non-cash methods";
    }
    if (!newPayment.paymentDate || new Date(newPayment.paymentDate) > new Date()) {
      errs.paymentDate = "Payment date must be a valid date and not in the future";
    }
    if (isChequeInstrument) {
      if (!newPayment.chequeNo.trim()) errs.chequeNo = "Cheque number is required";
      else if (newPayment.chequeNo.length > 20) errs.chequeNo = "Max 20 characters";
      if (!newPayment.chequeDate) errs.chequeDate = "Cheque date is required";
      if (newPayment.chequeBank.length > 120) errs.chequeBank = "Max 120 characters";
      if (newPayment.chequeParty.length > 160) errs.chequeParty = "Max 160 characters";
    }
    if (Object.keys(errs).length > 0) {
      setPaymentErrors(errs);
      toast.error(Object.values(errs)[0]);
      return;
    }
    setPaymentErrors({});

    setPayments((prev) => [
      ...prev,
      {
        ...newPayment,
        amount: amt,
        id: Math.random().toString(36).substr(2, 9),
        ...(isChequeInstrument
          ? {}
          : {
              chequeNo: undefined,
              chequeDate: undefined,
              chequeBank: undefined,
              chequeParty: undefined,
            }),
      },
    ]);

    // Reset inputs
    setNewPayment({
      amount: "",
      paymentMethod: "Bank Transfer",
      referenceNumber: "",
      paymentDate: new Date().toISOString().split("T")[0],
      instrumentType: "BANK",
      chequeNo: "",
      chequeDate: "",
      chequeBank: "",
      chequeParty: "",
    });
  };

  const handleRemovePayment = (id: string) => {
    setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  // ── Options ───────────────────────────────────────────────────────────────────
  const poOptions = useMemo(
    () => [
      { value: "", label: t("grn.selectPo") },
      ...approvedPOs.map((po: any) => {
        const supplierName =
          po.supplier?.supplierName || po.supplier?.displayName || po.supplier?.legalName || "";
        const supplierPart = supplierName ? ` - ${supplierName}` : "";
        const statusPart = po.status === "PARTIALLY_RECEIVED" ? " (Partially Received)" : "";
        return {
          value: String(po.id || po.purchaseOrderId || ""),
          label: `${po.poNumber || ""}${supplierPart}${statusPart}`,
        };
      }),
    ],
    [approvedPOs]
  );

  const supplierOptions = useMemo(
    () => [
      { value: "", label: t("grn.select") },
      ...(suppliers || []).map((s: any) => ({
        value: String(s.id || ""),
        // Same name the PO and GRN lists show.
        label: s.displayName || s.legalName || s.supplierCode || "",
      })),
    ],
    [suppliers]
  );

  const storeOptions = useMemo(
    () => [
      { value: "", label: t("grn.select") },
      ...(stores || [])
        .filter((s: any) => s.isActive)
        .map((s: any) => ({
          value: String(s.storeId || ""),
          label: s.storeName,
        })),
    ],
    [stores]
  );

  // ── Item handlers ─────────────────────────────────────────────────────────────
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index));

  const updateItem = (index: number, field: keyof GRNItem, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      const item = updated[index];

      const itemRawMaterial = (rawMaterials || []).find(
        (rm: any) =>
          String(rm.rawMaterialId) === String(item.productId) ||
          String(rm.id) === String(item.productId)
      );
      if (!item.uom) {
        const fallbackUoms = (activeUOMs || []).map((u: any) => u.uomName).join(",");
        const baseUoms = itemRawMaterial?.baseUom || fallbackUoms;
        const primaryUom = baseUoms.split(",")[0].trim();
        updated[index].uom = primaryUom;
      }

      const mult = getUomMultiplier(updated[index].uom || item.uom, itemRawMaterial?.baseUom);
      const lineSubtotal = item.qty * mult * item.unitPrice;
      const taxableAmount = lineSubtotal;
      const totalGstAmount = (taxableAmount * item.tax) / 100;

      let cgstRate = 0,
        cgstAmount = 0,
        sgstRate = 0,
        sgstAmount = 0,
        igstRate = 0,
        igstAmount = 0;
      if (isInterState) {
        igstRate = item.tax;
        igstAmount = totalGstAmount;
      } else {
        cgstRate = item.tax / 2;
        sgstRate = item.tax / 2;
        cgstAmount = totalGstAmount / 2;
        sgstAmount = totalGstAmount / 2;
      }

      updated[index].taxableAmount = taxableAmount;
      updated[index].cgstRate = cgstRate;
      updated[index].cgstAmount = cgstAmount;
      updated[index].sgstRate = sgstRate;
      updated[index].sgstAmount = sgstAmount;
      updated[index].igstRate = igstRate;
      updated[index].igstAmount = igstAmount;
      updated[index].netAmount = taxableAmount + totalGstAmount;
      return updated;
    });

    setErrors((prev) => {
      const next = { ...prev };
      delete next[`items.${index}.${field}`];
      if (field === "productId") delete next[`items.${index}.description`];
      return next;
    });
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    const val = type === "checkbox" ? (e.target as HTMLInputElement).checked : value;
    setForm((prev) => ({ ...prev, [name]: val }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setForm((prev) => ({ ...prev, invoiceImage: e.target.files![0] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.invoiceNo) errs.invoiceNo = "Required";
    if (!form.grnDate) errs.grnDate = "Required";
    if (!form.supplierId) errs.supplierId = "Required";
    if (!form.storeId) errs.storeId = "Required";

    if (!form.billingAddressLine1) errs.billingAddressLine1 = "Required";
    if (!form.billingCity) errs.billingCity = "Required";
    if (!form.billingState) errs.billingState = "Required";
    if (!form.billingPincode) errs.billingPincode = "Required";

    if (!form.sameAsBilling) {
      if (!form.shippingAddressLine1) errs.shippingAddressLine1 = "Required";
      if (!form.shippingCity) errs.shippingCity = "Required";
      if (!form.shippingState) errs.shippingState = "Required";
      if (!form.shippingPincode) errs.shippingPincode = "Required";
    }

    if (!items || items.length === 0) {
      toast.error(t("grn.toast.addItem"));
      return;
    }

    if (form.deductTds && !form.tdsSectionCode) {
      errs.tdsSectionCode = "Pick a section to deduct TDS";
    }
    if (form.currencyCode !== "INR") {
      if (form.currencyCode.length !== 3) errs.currencyCode = "A currency code is 3 letters";
      if (!form.exchangeRate || Number(form.exchangeRate) <= 0) {
        errs.exchangeRate = "Exchange rate must be greater than 0";
      }
    }

    items.forEach((item, idx) => {
      if (!item.productId) {
        errs[`items.${idx}.productId`] = "Required";
      }
      if (item.qty === undefined || item.qty === null || Number(item.qty) <= 0) {
        errs[`items.${idx}.qty`] = "Required";
      }
      if (item.unitPrice === undefined || item.unitPrice === null || Number(item.unitPrice) <= 0) {
        errs[`items.${idx}.unitPrice`] = "Required";
      }
    });

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.error(t("grn.toast.fillRequired"));
      return;
    }
    setSaving(true);
    try {
      const payload = new FormData();
      if (form.poId) payload.append("poId", form.poId);
      payload.append("invoiceNo", form.invoiceNo);
      payload.append("grnDate", form.grnDate);
      payload.append("supplierId", String(form.supplierId));
      payload.append("storeId", form.storeId);
      payload.append("reverseCharge", form.reverseCharge ? "true" : "false");
      payload.append("currencyCode", form.currencyCode || "INR");
      if (form.currencyCode !== "INR") {
        payload.append("exchangeRate", String(form.exchangeRate));
      }
      if (!isEditMode) {
        // P2-05: the TDS toggle is only wired for creation; an already-saved GRN's deduction
        // is fixed and shown read-only (the update endpoint does not re-run it).
        payload.append("deductTds", form.deductTds ? "true" : "false");
        if (form.tdsSectionCode) payload.append("tdsSectionCode", form.tdsSectionCode);
      }
      payload.append("billingAddressLine1", form.billingAddressLine1);
      payload.append("billingCountry", form.billingCountry || "India");
      payload.append("billingCity", form.billingCity);
      payload.append("billingState", form.billingState);
      payload.append("billingPincode", form.billingPincode);
      payload.append(
        "shippingAddressLine1",
        form.sameAsBilling ? form.billingAddressLine1 : form.shippingAddressLine1
      );
      payload.append(
        "shippingCountry",
        form.sameAsBilling ? form.billingCountry || "India" : form.shippingCountry || "India"
      );
      payload.append("shippingCity", form.sameAsBilling ? form.billingCity : form.shippingCity);
      payload.append("shippingState", form.sameAsBilling ? form.billingState : form.shippingState);
      payload.append(
        "shippingPincode",
        form.sameAsBilling ? form.billingPincode : form.shippingPincode
      );
      payload.append("sameAsBilling", String(form.sameAsBilling));
      payload.append("updateStock", "true");

      if (form.receiveDate) payload.append("receiveDate", form.receiveDate);
      if (form.billDueDate) payload.append("billDueDate", form.billDueDate);
      if (form.challanNo) payload.append("challanNo", form.challanNo);
      if (form.transport) payload.append("transport", form.transport);
      if (form.eWayBill) payload.append("eWayBill", form.eWayBill);
      if (form.remarks) payload.append("remarks", form.remarks);

      payload.append("discountType", form.discountType.toUpperCase());
      payload.append("discountValue", String(form.discountValue));
      payload.append("roundingAdjust", String(form.roundingAdjust));
      payload.append("totalTax", String(totalTax));
      payload.append("totalCgst", String(totalCgst));
      payload.append("totalSgst", String(totalSgst));
      payload.append("totalIgst", String(totalIgst));

      payload.append("paymentStatus", computedStatus);
      const lastPayment = payments[payments.length - 1];
      if (lastPayment) {
        payload.append("paymentMethod", lastPayment.paymentMethod);
        if (lastPayment.referenceNumber)
          payload.append("referenceNumber", lastPayment.referenceNumber);
        if (lastPayment.paymentDate) payload.append("paymentDate", lastPayment.paymentDate);
      }
      payload.append("payments", JSON.stringify(payments));

      // Append items as JSON string
      payload.append(
        "items",
        JSON.stringify(
          items.map((item) => ({
            productId: item.productId,
            description: item.description,
            uom: item.uom,
            quantity: Number(item.qty),
            unitPrice: Number(item.unitPrice),
            tax: Number(item.tax || 0),
            hsnCode: item.hsnCode || undefined,
            taxableAmount: item.taxableAmount || 0,
            cgstRate: item.cgstRate || 0,
            cgstAmount: item.cgstAmount || 0,
            sgstRate: item.sgstRate || 0,
            sgstAmount: item.sgstAmount || 0,
            igstRate: item.igstRate || 0,
            igstAmount: item.igstAmount || 0,
          }))
        )
      );

      // Append file if selected
      if (form.invoiceImage) {
        payload.append("invoiceImage", form.invoiceImage);
      }

      if (isEditMode && id) {
        await grnInvoiceService.update(id, payload);
        toast.success(t("grn.toast.updated"));
      } else {
        await grnInvoiceService.create(payload);
        toast.success(t("grn.toast.created"));
      }
      navigate("/invoice");
    } catch (error: any) {
      const errorMsg = error.response?.data?.message || "Failed to create GRN / Invoice";
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const isPOSelected = !!form.poId && !!selectedPO;

  if (loadingPOs) {
    return <CommonLoader text="Loading..." fullScreen={false} />;
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <PageHeader
        title={isEditMode ? t("grn.editTitle") : t("grn.createTitle")}
        meta={
          form.grnNumber ? (
            <Chip size="sm" tone="muted" className="tabular-nums">
              {form.grnNumber}
            </Chip>
          ) : null
        }
        subtitle={t("grn.subtitle")}
        back={() => navigate(-1)}
        backLabel={t("grn.backToList")}
        breadcrumbs={[
          { label: t("grn.crumbList"), to: "/invoice" },
          { label: isEditMode ? t("nav.crumb.edit") : t("nav.crumb.create") },
        ]}
      />
      <div>
        <form onSubmit={handleSubmit} noValidate>
          <div className="space-y-4">
            {/* ── Section 1: GRN Details ── */}
            <div className="sl-tile p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="sl-h2 m-0">{t("grn.details")}</h2>
              </div>
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
                <SelectInput
                  label={t("grn.po")}
                  name="poId"
                  value={form.poId}
                  options={poOptions}
                  onChange={handleChange}
                  disabled={isEditMode}
                />
                <TextInput
                  label={t("grn.grnNumber")}
                  name="grnNumber"
                  value={form.grnNumber}
                  onChange={handleChange}
                  disabled
                />
                <TextInput
                  label={t("grn.invoiceNo")}
                  name="invoiceNo"
                  value={form.invoiceNo}
                  onChange={handleChange}
                  placeholder={t("grn.invoicePlaceholder")}
                  required
                  error={errors.invoiceNo}
                  disabled={isEditMode}
                />
                <DatePickerCalendar
                  label={t("grn.grnDate")}
                  name="grnDate"
                  value={form.grnDate}
                  onChange={(e) => setForm((p) => ({ ...p, grnDate: e.target.value }))}
                  required
                  error={errors.grnDate}
                  disabled={isEditMode}
                />
                <SelectInput
                  label={t("common.supplier")}
                  name="supplierId"
                  value={form.supplierId}
                  options={supplierOptions}
                  onChange={handleChange}
                  required
                  disabled={isEditMode || isPOSelected}
                  searchable
                  error={errors.supplierId}
                />
                <SelectInput
                  label={t("common.store")}
                  name="storeId"
                  value={form.storeId}
                  options={storeOptions}
                  onChange={handleChange}
                  required
                  disabled={isEditMode || isPOSelected}
                  searchable
                  error={errors.storeId}
                />
                <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={form.reverseCharge}
                    onChange={(e) => setForm((p) => ({ ...p, reverseCharge: e.target.checked }))}
                    disabled={isEditMode}
                  />
                  Reverse charge (GST payable by us)
                </label>
                <SelectInput
                  label="Currency"
                  name="currencyCode"
                  value={form.currencyCode}
                  options={[
                    { value: "INR", label: "INR — Indian Rupee" },
                    ...currencies
                      .filter((c) => c.code !== "INR")
                      .map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
                  ]}
                  onChange={(e) => {
                    setForm((p) => ({ ...p, currencyCode: e.target.value }));
                    setExchangeRateTouched(false);
                  }}
                  disabled={isEditMode}
                  error={errors.currencyCode}
                />
                {form.currencyCode !== "INR" && (
                  <>
                    <TextInput
                      label="Exchange Rate (₹ per unit)"
                      name="exchangeRate"
                      type="number"
                      step="0.0001"
                      preventNegative
                      value={String(form.exchangeRate)}
                      onChange={(e) => {
                        setExchangeRateTouched(true);
                        setForm((p) => ({ ...p, exchangeRate: Number(e.target.value) }));
                      }}
                      error={errors.exchangeRate}
                      disabled={isEditMode}
                    />
                    <div className="self-end pb-2 text-[11px] font-semibold text-ink-muted">
                      Foreign Total:{" "}
                      <span className="font-bold tabular-nums text-ink">
                        {form.currencyCode}{" "}
                        {foreignTotal !== null
                          ? foreignTotal.toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : "—"}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Section 2: Billing Address ── */}
            <div className="sl-tile p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="sl-h2 m-0">Billing Address</h2>
              </div>
              <AddressForm
                addressValue={form.billingAddressLine1}
                onAddressChange={(val) =>
                  setForm((prev) => ({ ...prev, billingAddressLine1: val }))
                }
                addressError={errors.billingAddressLine1}
                countryValue={form.billingCountry || "India"}
                onCountryChange={(val) =>
                  setForm((prev) => ({
                    ...prev,
                    billingCountry: val,
                    ...(prev.sameAsBilling && { shippingCountry: val }),
                  }))
                }
                countryError={errors.billingCountry}
                stateValue={form.billingState}
                onStateChange={(val) => handleBillingStateChange({ id: 0, name: val, isoCode: "" })}
                stateError={errors.billingState}
                cityValue={form.billingCity}
                onCityChange={(val) => handleBillingCityChange({ id: 0, name: val, isoCode: "" })}
                cityError={errors.billingCity}
                pincodeValue={form.billingPincode}
                onPincodeChange={(val) => setForm((prev) => ({ ...prev, billingPincode: val }))}
                pincodeError={errors.billingPincode}
                required
              />
            </div>

            {/* ── Section 3: Shipping Address ── */}
            <div className="sl-tile p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="sl-h2 m-0">Shipping Address</h2>
              </div>
              <AddressForm
                addressValue={form.shippingAddressLine1}
                onAddressChange={(val) =>
                  setForm((prev) => ({ ...prev, shippingAddressLine1: val }))
                }
                addressError={errors.shippingAddressLine1}
                countryValue={form.shippingCountry || "India"}
                onCountryChange={(val) => setForm((prev) => ({ ...prev, shippingCountry: val }))}
                countryError={errors.shippingCountry}
                stateValue={form.shippingState}
                onStateChange={(val) =>
                  handleShippingStateChange({ id: 0, name: val, isoCode: "" })
                }
                stateError={errors.shippingState}
                cityValue={form.shippingCity}
                onCityChange={(val) => handleShippingCityChange({ id: 0, name: val, isoCode: "" })}
                cityError={errors.shippingCity}
                pincodeValue={form.shippingPincode}
                onPincodeChange={(val) => setForm((prev) => ({ ...prev, shippingPincode: val }))}
                pincodeError={errors.shippingPincode}
                required={!form.sameAsBilling}
                disabled={form.sameAsBilling}
              />
            </div>

            {/* ── Section 4: Receipt Details ── */}
            <div className="sl-tile p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="sl-h2 m-0">{t("grn.receipt")}</h2>
              </div>
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
                <DatePickerCalendar
                  label={t("grn.receiveDate")}
                  name="receiveDate"
                  value={form.receiveDate}
                  onChange={(e) => setForm((p) => ({ ...p, receiveDate: e.target.value }))}
                  disabled={isEditMode}
                />
                <DatePickerCalendar
                  label={t("grn.billDueDate")}
                  name="billDueDate"
                  value={form.billDueDate}
                  onChange={(e) => setForm((p) => ({ ...p, billDueDate: e.target.value }))}
                  disabled={isEditMode}
                />
                <TextInput
                  label={t("grn.challanNo")}
                  name="challanNo"
                  value={form.challanNo}
                  onChange={handleChange}
                  placeholder={t("grn.optional")}
                  disabled={isEditMode}
                />
                <TextInput
                  label={t("grn.transporter")}
                  name="transport"
                  value={form.transport}
                  onChange={handleChange}
                  placeholder={t("grn.optional")}
                  disabled={isEditMode}
                />
                <TextInput
                  label={t("grn.ewayBill")}
                  name="eWayBill"
                  value={form.eWayBill}
                  onChange={handleChange}
                  placeholder={t("grn.optional")}
                  disabled={isEditMode}
                />
                {!isEditMode && (
                  <FileUpload
                    label={
                      form.invoiceImage
                        ? t("grn.invoiceFile", { name: form.invoiceImage.name })
                        : t("grn.uploadInvoice")
                    }
                    name="invoiceImage"
                    onChange={handleFileChange}
                  />
                )}
              </div>
            </div>

            {/* ── Section 5: Order Items ── */}
            <div className="sl-tile p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="sl-h2 m-0">{t("grn.items")}</h2>
                {!isEditMode && (
                  <ActionPill
                    size="sm"
                    variant="secondary"
                    icon={<Plus size={15} />}
                    onClick={addItem}
                  >
                    {t("grn.addItem")}
                  </ActionPill>
                )}
              </div>
              <div className="overflow-x-auto rounded-[14px] border border-line-soft [&_.mb-\[18px\]]:!mb-0 [&_.select-input-group]:!mb-0">
                <table className="min-w-full divide-y divide-line-soft">
                  <thead className="bg-card-2">
                    <tr>
                      <th className="sl-th px-2 py-2.5 text-center w-8">#</th>
                      <th className="sl-th px-2 py-2.5 text-left">{t("common.product")}</th>
                      <th className="sl-th px-2 py-2.5 text-left w-24">HSN</th>
                      <th className="sl-th px-2 py-2.5 text-left min-w-[160px]">
                        {t("grn.col.qtyUom")}
                      </th>
                      <th className="sl-th px-2 py-2.5 text-left">Unit Price (₹)</th>
                      <th className="sl-th px-2 py-2.5 text-left">Tax %</th>
                      <th className="sl-th px-2 py-2.5 text-right">Net (₹)</th>
                      <th className="px-2 py-1.5 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft bg-card">
                    {items.map((item, idx) => {
                      const itemRawMaterial = (rawMaterials || []).find(
                        (rm: any) =>
                          String(rm.rawMaterialId) === String(item.productId) ||
                          String(rm.id) === String(item.productId) ||
                          String(rm.materialCode) === String(item.productId)
                      );
                      const fallbackUoms = (activeUOMs || []).map((u: any) => u.uomName).join(",");
                      const baseUoms = itemRawMaterial?.baseUom || fallbackUoms;
                      const materialName =
                        itemRawMaterial?.materialName ||
                        itemRawMaterial?.productName ||
                        (item.description && item.description !== item.productId
                          ? item.description
                          : "") ||
                        item.productId ||
                        "—";
                      return (
                        <tr key={idx} className="align-top">
                          <td className="px-3 py-3 text-center text-[13px] tabular-nums text-ink-subtle">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2">
                            {isPOSelected || isEditMode ? (
                              <span className="inline-block py-2 text-sm font-semibold text-ink">
                                {materialName}
                              </span>
                            ) : (
                              <SelectInput
                                label=""
                                noMargin={true}
                                value={item.productId ? String(item.productId) : ""}
                                options={[
                                  { value: "", label: t("grn.selectMaterial") },
                                  ...(rawMaterials || []).map((rm: any) => ({
                                    value: String(rm.rawMaterialId),
                                    label:
                                      rm.materialName || rm.productName || String(rm.rawMaterialId),
                                  })),
                                ]}
                                error={errors[`items.${idx}.productId`]}
                                onChange={(e) => {
                                  const selId = e.target.value;
                                  const selectedRm = rawMaterials.find(
                                    (rm: any) => String(rm.rawMaterialId) === String(selId)
                                  );
                                  if (selectedRm) {
                                    const matName =
                                      selectedRm.materialName || selectedRm.productName || "";
                                    const uPrice = Number(selectedRm.unitPrice) || 0;
                                    const gRate =
                                      selectedRm.gstRate !== null &&
                                      selectedRm.gstRate !== undefined &&
                                      selectedRm.gstRate !== ""
                                        ? Number(selectedRm.gstRate)
                                        : Number(selectedRm.hsnCode?.gstRate ?? 0);
                                    const hsn = selectedRm.hsnCode?.code || "";
                                    const baseUomVal = selectedRm.baseUom
                                      ? selectedRm.baseUom.split(",")[0].trim()
                                      : "";
                                    setItems((prev) => {
                                      const updated = [...prev];
                                      updated[idx] = {
                                        ...updated[idx],
                                        productId: selId,
                                        description: matName,
                                        unitPrice: uPrice,
                                        tax: gRate,
                                        hsnCode: hsn,
                                        uom: baseUomVal || updated[idx].uom,
                                      };
                                      const lineSubtotal = updated[idx].qty * uPrice;
                                      const totalGstAmount = (lineSubtotal * gRate) / 100;
                                      updated[idx].taxableAmount = lineSubtotal;
                                      updated[idx].netAmount = lineSubtotal + totalGstAmount;
                                      return updated;
                                    });
                                  } else {
                                    setItems((prev) => {
                                      const updated = [...prev];
                                      updated[idx] = {
                                        ...updated[idx],
                                        productId: "",
                                        description: "",
                                      };
                                      return updated;
                                    });
                                  }
                                  setErrors((prev) => {
                                    const next = { ...prev };
                                    delete next[`items.${idx}.productId`];
                                    delete next[`items.${idx}.description`];
                                    if (selectedRm && Number(selectedRm.unitPrice) > 0) {
                                      delete next[`items.${idx}.unitPrice`];
                                    }
                                    return next;
                                  });
                                }}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <TextInput
                              label=""
                              name={`items[${idx}].hsnCode`}
                              value={item.hsnCode || ""}
                              placeholder="HSN"
                              onChange={(e) =>
                                updateItem(
                                  idx,
                                  "hsnCode",
                                  e.target.value.replace(/\D/g, "").slice(0, 8)
                                )
                              }
                              disabled={isEditMode}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <QuantityInput
                              label=""
                              name={`items[${idx}].qty`}
                              value={item.qty}
                              baseUoms={baseUoms}
                              uom={item.uom}
                              onUomChange={(newUom) => updateItem(idx, "uom", newUom)}
                              disabled={isEditMode}
                              error={errors[`items.${idx}.qty`]}
                              onChange={(e) => updateItem(idx, "qty", Number(e.target.value))}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <TextInput
                              label=""
                              name={`items[${idx}].unitPrice`}
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              preventNegative={true}
                              value={String(item.unitPrice)}
                              error={errors[`items.${idx}.unitPrice`]}
                              onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                              disabled={isEditMode}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <TextInput
                              name={`items[${idx}].tax`}
                              type="number"
                              value={String(item.tax || 0)}
                              onChange={(e) => updateItem(idx, "tax", Number(e.target.value))}
                              min={0}
                              max={100}
                              step={0.01}
                              placeholder="0"
                              disabled={isEditMode}
                            />
                          </td>
                          <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-ink">
                            {formatINR(item.netAmount)}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {!isEditMode && (
                              <button
                                type="button"
                                aria-label="Remove"
                                className="sl-icon-btn sl-icon-btn-hover-danger"
                                onClick={() => removeItem(idx)}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-sm text-ink-subtle">
                          No items added
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Section 5.5: TDS ── */}
            {canViewTds && (
              <div className="sl-tile p-4 sm:p-5">
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="sl-h2 m-0">TDS Deduction</h2>
                </div>
                <div>
                  <label className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      checked={form.deductTds}
                      onChange={(e) => setForm((p) => ({ ...p, deductTds: e.target.checked }))}
                      disabled={isEditMode && !form.deductTds}
                    />
                    Deduct TDS on this bill
                  </label>
                  {form.deductTds && (
                    <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2 xl:grid-cols-4 items-end">
                      <SelectInput
                        label="Section"
                        name="tdsSectionCode"
                        value={form.tdsSectionCode}
                        options={[
                          { value: "", label: "Select section" },
                          ...tdsSections.map((s) => ({
                            value: s.code,
                            label: `${s.code} — ${s.name}`,
                          })),
                        ]}
                        onChange={(e) => {
                          setTdsSectionTouched(true);
                          setForm((p) => ({ ...p, tdsSectionCode: e.target.value }));
                        }}
                        disabled={isEditMode}
                        error={errors.tdsSectionCode}
                      />
                      <div className="text-[13px] text-ink-muted md:col-span-1 xl:col-span-3">
                        {tdsPreviewLoading ? (
                          <span>Calculating…</span>
                        ) : tdsPreview ? (
                          tdsPreview.belowThreshold ? (
                            <span className="text-[color:var(--color-warning)]">
                              {tdsPreview.reason}
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-x-5 gap-y-1">
                              <span>
                                Rate:{" "}
                                <span className="font-bold tabular-nums text-ink">
                                  {tdsPreview.rate}%
                                </span>
                              </span>
                              <span>
                                TDS Amount:{" "}
                                <span className="font-bold tabular-nums text-ink">
                                  ₹
                                  {tdsAmount.toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              </span>
                              <span>
                                Net Payable:{" "}
                                <span className="font-bold tabular-nums text-ink">
                                  ₹
                                  {netPayable.toLocaleString("en-IN", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              </span>
                              <span className="text-ink-subtle italic">{tdsPreview.reason}</span>
                            </div>
                          )
                        ) : form.tdsSectionCode ? (
                          <span className="text-ink-subtle">Pick a supplier to see the rate.</span>
                        ) : (
                          <span className="text-ink-subtle">
                            Pick a section to preview the deduction.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Section 5.7: Payments ── */}
            <div className="sl-tile p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <h2 className="sl-h2 m-0">Payments</h2>
              </div>
              <div className="space-y-3">
                {payments.length > 0 && (
                  <table className="min-w-full divide-y divide-line-soft overflow-hidden rounded-[14px] border border-line-soft text-[13px]">
                    <thead>
                      <tr className="bg-card-2">
                        <th className="sl-th px-3 py-2 text-left">Date</th>
                        <th className="sl-th px-3 py-2 text-left">Instrument</th>
                        <th className="sl-th px-3 py-2 text-left">Details</th>
                        <th className="sl-th px-3 py-2 text-right">Amount (₹)</th>
                        <th className="sl-th w-10 px-3 py-2">
                          <span className="sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {payments.map((p) => {
                        const isCheque =
                          String(p.instrumentType ?? "").toUpperCase() === "CHEQUE" ||
                          String(p.paymentMethod ?? "")
                            .toLowerCase()
                            .includes("cheque");
                        const postDated =
                          isCheque &&
                          p.chequeDate &&
                          new Date(p.chequeDate).getTime() > new Date(p.paymentDate).getTime();
                        return (
                          <tr key={p.id}>
                            <td className="px-3 py-2">
                              {p.paymentDate
                                ? new Date(p.paymentDate).toLocaleDateString("en-IN")
                                : "—"}
                            </td>
                            <td className="px-3 py-2">
                              {p.paymentMethod}
                              {postDated && (
                                <Chip size="sm" tone="warning" className="ml-1.5">
                                  Post-dated
                                </Chip>
                              )}
                            </td>
                            <td className="px-3 py-2 text-ink-subtle">
                              {isCheque
                                ? [
                                    p.chequeNo ? `Cheque #${p.chequeNo}` : null,
                                    p.chequeBank || null,
                                    p.chequeDate
                                      ? new Date(p.chequeDate).toLocaleDateString("en-IN")
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")
                                : p.referenceNumber || "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">
                              {Number(p.amount).toLocaleString("en-IN", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {!p.isPersisted && (
                                <button
                                  type="button"
                                  aria-label="Remove"
                                  className="sl-icon-btn sl-icon-btn-hover-danger"
                                  onClick={() => handleRemovePayment(p.id)}
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {(!isEditMode || balanceDue > 0) && (
                  <div className="grid grid-cols-1 items-end gap-x-4 gap-y-4 border-t border-line-soft pt-4 md:grid-cols-3 xl:grid-cols-5">
                    <TextInput
                      label="Amount (₹)"
                      name="paymentAmount"
                      type="number"
                      step="0.01"
                      preventNegative
                      value={newPayment.amount}
                      onChange={(e) => setNewPayment((p) => ({ ...p, amount: e.target.value }))}
                      error={paymentErrors.amount}
                    />
                    <SelectInput
                      label="Instrument"
                      name="instrumentType"
                      value={newPayment.instrumentType}
                      options={[
                        { value: "CASH", label: "Cash" },
                        { value: "BANK", label: "Bank Transfer" },
                        { value: "CHEQUE", label: "Cheque" },
                      ]}
                      onChange={(e) => {
                        const val = e.target.value as "CASH" | "BANK" | "CHEQUE";
                        const label =
                          val === "CASH" ? "Cash" : val === "CHEQUE" ? "Cheque" : "Bank Transfer";
                        setNewPayment((p) => ({ ...p, instrumentType: val, paymentMethod: label }));
                      }}
                    />
                    {!isChequeInstrument && (
                      <TextInput
                        label="Reference No."
                        name="referenceNumber"
                        value={newPayment.referenceNumber}
                        onChange={(e) =>
                          setNewPayment((p) => ({ ...p, referenceNumber: e.target.value }))
                        }
                        error={paymentErrors.referenceNumber}
                      />
                    )}
                    <DatePickerCalendar
                      label="Payment Date"
                      name="paymentDate"
                      value={newPayment.paymentDate}
                      onChange={(e) =>
                        setNewPayment((p) => ({ ...p, paymentDate: e.target.value }))
                      }
                      error={paymentErrors.paymentDate}
                    />
                    {isChequeInstrument && (
                      <>
                        <TextInput
                          label="Cheque No."
                          name="chequeNo"
                          value={newPayment.chequeNo}
                          onChange={(e) =>
                            setNewPayment((p) => ({ ...p, chequeNo: e.target.value.slice(0, 20) }))
                          }
                          error={paymentErrors.chequeNo}
                        />
                        <DatePickerCalendar
                          label="Cheque Date"
                          name="chequeDate"
                          value={newPayment.chequeDate}
                          onChange={(e) =>
                            setNewPayment((p) => ({ ...p, chequeDate: e.target.value }))
                          }
                          error={paymentErrors.chequeDate}
                        />
                        <TextInput
                          label="Bank"
                          name="chequeBank"
                          value={newPayment.chequeBank}
                          onChange={(e) =>
                            setNewPayment((p) => ({
                              ...p,
                              chequeBank: e.target.value.slice(0, 120),
                            }))
                          }
                          error={paymentErrors.chequeBank}
                        />
                        <TextInput
                          label="Drawer"
                          name="chequeParty"
                          value={newPayment.chequeParty}
                          onChange={(e) =>
                            setNewPayment((p) => ({
                              ...p,
                              chequeParty: e.target.value.slice(0, 160),
                            }))
                          }
                          error={paymentErrors.chequeParty}
                        />
                        {isPostDatedCheque && (
                          <div className="md:col-span-3 xl:col-span-5 text-[10px] font-semibold text-[color:var(--color-warning)]">
                            Post-dated: this cheque will post only when it is marked cleared in the
                            cheque register.
                          </div>
                        )}
                      </>
                    )}
                    <div className={isChequeInstrument ? "md:col-span-3 xl:col-span-5" : ""}>
                      <ActionPill
                        variant="blue"
                        icon={<Plus size={16} />}
                        onClick={handleAddPayment}
                      >
                        Add Payment
                      </ActionPill>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Section 6: Remarks + Summary ── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="sl-tile p-4 sm:p-5">
                <TextArea
                  label="Remarks (Optional)"
                  name="remarks"
                  value={form.remarks}
                  placeholder="Additional notes..."
                  rows={3}
                  onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
                  disabled={isEditMode}
                />
              </div>
              <div className="sl-tile space-y-2 p-4 text-[13px] sm:p-5">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <span className="font-medium text-ink-subtle">Net amount</span>
                  <span className="text-[26px] font-bold leading-tight tracking-tight tabular-nums text-ink">
                    {formatINR(grandTotal)}
                  </span>
                </div>
                <div className="flex justify-between text-ink-muted">
                  <span>Subtotal</span>
                  <span className="tabular-nums text-ink">{formatINR(subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-ink-muted">
                  <span>Discount</span>
                  <div className="flex items-center gap-1">
                    <select
                      aria-label="Discount type"
                      className="sl-input h-9 w-16 px-2 text-[13px]"
                      value={form.discountType}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, discountType: e.target.value as any }))
                      }
                      disabled={isEditMode}
                    >
                      <option value="flat">flat</option>
                      <option value="percent">%</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.discountValue}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, discountValue: Number(e.target.value) }))
                      }
                      aria-label="Discount"
                      className="sl-input h-9 w-24 px-2 text-right text-[13px] tabular-nums"
                      disabled={isEditMode}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between text-ink-muted">
                  <span>Rounding</span>
                  <div className="flex items-center gap-1">
                    <div className="flex">
                      <button
                        type="button"
                        onClick={() => setRoundingSign("+")}
                        disabled={isEditMode}
                        aria-label="Round up"
                        aria-pressed={roundingSign === "+"}
                        className="sl-chip sl-chip-sm rounded-r-none"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => setRoundingSign("-")}
                        disabled={isEditMode}
                        aria-label="Round down"
                        aria-pressed={roundingSign === "-"}
                        className="sl-chip sl-chip-sm rounded-l-none"
                      >
                        -
                      </button>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={form.roundingAdjust}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, roundingAdjust: Math.abs(Number(e.target.value)) }))
                      }
                      aria-label="Rounding amount"
                      className="sl-input h-9 w-24 px-2 text-right text-[13px] tabular-nums"
                      placeholder="0.00"
                      disabled={isEditMode}
                    />
                  </div>
                </div>
                {isInterState ? (
                  gstRateBreakdown.length === 0 ? (
                    <div className="flex justify-between text-ink-muted">
                      <span>Total IGST:</span>
                      <span className="tabular-nums text-ink">{formatINR(totalIgst)}</span>
                    </div>
                  ) : (
                    gstRateBreakdown.map((group) => (
                      <div
                        key={`igst-${group.gstRate}`}
                        className="flex justify-between text-ink-muted"
                      >
                        <span>IGST {group.gstRate}%:</span>
                        <span className="tabular-nums text-ink">{formatINR(group.igstAmount)}</span>
                      </div>
                    ))
                  )
                ) : gstRateBreakdown.length === 0 ? (
                  <>
                    <div className="flex justify-between text-ink-muted">
                      <span>Total CGST:</span>
                      <span className="tabular-nums text-ink">{formatINR(totalCgst)}</span>
                    </div>
                    <div className="flex justify-between text-ink-muted">
                      <span>Total SGST:</span>
                      <span className="tabular-nums text-ink">{formatINR(totalSgst)}</span>
                    </div>
                  </>
                ) : (
                  gstRateBreakdown.map((group) => (
                    <React.Fragment key={`gst-${group.gstRate}`}>
                      <div className="flex justify-between text-ink-muted">
                        <span>CGST {group.cgstRate}%:</span>
                        <span className="tabular-nums text-ink">{formatINR(group.cgstAmount)}</span>
                      </div>
                      <div className="flex justify-between text-ink-muted">
                        <span>SGST {group.sgstRate}%:</span>
                        <span className="tabular-nums text-ink">{formatINR(group.sgstAmount)}</span>
                      </div>
                    </React.Fragment>
                  ))
                )}
                <hr className="my-2 border-line-soft" />
                {form.currencyCode !== "INR" && foreignTotal !== null && (
                  <div className="flex justify-between text-ink-muted">
                    <span>Foreign Total:</span>
                    <span className="font-bold tabular-nums text-ink">
                      {form.currencyCode} {foreignTotal.toFixed(2)}
                    </span>
                  </div>
                )}
                {form.deductTds && tdsPreview && !tdsPreview.belowThreshold && (
                  <>
                    <div className="flex justify-between text-ink-muted">
                      <span>Less: TDS ({form.tdsSectionCode}):</span>
                      <span className="tabular-nums text-ink">− {formatINR(tdsAmount)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-ink">
                      <span>Net Payable:</span>
                      <span className="tabular-nums">{formatINR(netPayable)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <FormFooter start={<KeyHint keys={["F2"]}>{t("grn.f2Saves")}</KeyHint>}>
            <ActionPill variant="secondary" onClick={() => navigate("/invoice")}>
              {t("common.cancel")}
            </ActionPill>
            <ActionPill
              type="submit"
              icon={<PackageCheck size={17} />}
              loading={saving}
              loadingText={t("common.saving")}
            >
              {isEditMode ? t("grn.update") : t("grn.createAndStock")}
            </ActionPill>
          </FormFooter>
        </form>
      </div>
    </div>
  );
};

export default InvoiceDetailPage;
