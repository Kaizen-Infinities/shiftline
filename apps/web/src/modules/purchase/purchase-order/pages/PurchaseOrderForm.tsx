import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useFormShortcuts } from "../../../../hooks/useFormShortcuts";
import {
  AlertTriangle,
  FileQuestion,
  FileText,
  Lock,
  Package,
  Plus,
  Save,
  Send,
} from "lucide-react";
import { ActionPill, Chip, EmptyState, PageHeader, Tile } from "../../../../components/ui/v2";
import StatusBadge from "../../../../components/ui/StatusBadge/Badge";
import { FormFooter, KeyHint, formatINR } from "../../../sales/shared/tradeUi";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";
import CommonLoader from "../../../../components/ui/Loader/CommonLoader";

import TextInput from "../../../../components/form/TextInput/TextInput";
import SelectInput from "../../../../components/form/SelectInput/SelectInput";
import DatePickerCalendar from "../../../../components/ui/DatePickerCalendar/DatePickerCalendar";

import QuantityInput from "../../../../components/form/QuantityInput/QuantityInput";
import CityStateSelect from "../../../../components/ui/CityStateSelect/CityStateSelect";
import type { StateCityOption } from "../../../../components/ui/CityStateSelect/CityStateSelect";

import { validatePurchaseOrder } from "../validations/purchaseOrderValidation";
import type {
  PurchaseOrderFormData,
  PurchaseOrderItem,
} from "../../../../features/purchaseOrder/types";
import { useSuppliers } from "../../../../hooks/useSuppliers";
import { useUOMs } from "../../../../hooks/useUOMs";
import { rawMaterialService } from "../../../../services/rawMaterialService";
import type { RawMaterial } from "../../../../features/raw-materials/types";
import { usePurchaseOrders } from "../../../../hooks/usePurchaseOrder";
import { purchaseOrderService } from "../../../../services/purchaseOrderService";
import BackButton from "../../../../components/ui/BackButton/BackButton";
import DeleteButton from "../../../../components/ui/DeleteButton/DeleteButton";
import AddressForm from "../../../../components/form/AddressFrom/AddressFrom";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { fetchStores } from "../../../../features/stores/storeSlice";
import { useSocketSync } from "../../../../hooks/useSocketSync";

const initialFormData: PurchaseOrderFormData = {
  poNumber: "",
  poDate: new Date().toISOString().split("T")[0],
  expectedDeliveryDate: new Date().toISOString().split("T")[0],
  supplierId: "",
  storeId: "",
  status: "DRAFT",
  createdByOn: "",

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

  remarks: "",

  items: [],

  subtotal: 0,
  discountType: "PERCENT",
  discountValue: 0,
  totalDiscount: 0,
  totalTax: 0,
  totalCgst: 0,
  totalSgst: 0,
  totalIgst: 0,
  netAmount: 0,
};

export const getUomMultiplier = (uom: string = "", baseUom: string = ""): number => {
  const u = (uom || "").trim().toLowerCase();
  const b = (baseUom || "").trim().toLowerCase();
  if (!u || u === b) return 1;
  if (u === "g" || u === "gram" || u === "grams") {
    if (b.includes("kg") || b === "kilogram" || b === "kilograms" || !b) return 0.001;
  }
  if (u === "kg" || u === "kilogram" || u === "kilograms") {
    if (b === "g" || b === "gram" || b === "grams") return 1000;
  }
  if (u === "mg") {
    if (b.includes("kg")) return 0.000001;
    if (b.includes("g")) return 0.001;
  }
  if (u === "ton" || u === "tonne" || u === "tonnes" || u === "tons") {
    if (b.includes("kg") || !b) return 1000;
  }
  if (u === "ml" && (b.includes("l") || !b)) return 0.001;
  if (u === "mm" && (b.includes("m") || !b)) return 0.001;
  if (u === "cm" && (b.includes("m") || !b)) return 0.01;
  return 1;
};

const mapPOToFormData = (po: any): PurchaseOrderFormData => {
  if (!po) return initialFormData;

  return {
    poNumber: po.poNumber ?? "",
    poDate: po.poDate ? po.poDate.split("T")[0] : "",
    expectedDeliveryDate: po.expectedDeliveryDate ? po.expectedDeliveryDate.split("T")[0] : "",
    supplierId: po.supplierId ? String(po.supplierId) : "",
    status: po.status ?? "DRAFT",
    createdByOn: po.createdBy ? String(po.createdBy) : "",

    billingAddressLine1: po.billingAddressLine1 ?? "",
    billingCountry: po.billingCountry ?? "India",
    billingCity: po.billingCity ?? "",
    billingState: po.billingState ?? "",
    billingPincode: po.billingPincode ?? "",
    sameAsBilling: po.sameAsBilling ?? false,
    storeId: po.storeId ? String(po.storeId) : "",

    shippingAddressLine1: po.shippingAddressLine1 ?? "",
    shippingCountry: po.shippingCountry ?? "India",
    shippingCity: po.shippingCity ?? "",
    shippingState: po.shippingState ?? "",
    shippingPincode: po.shippingPincode ?? "",
    remarks: po.remarks ?? "",

    items:
      po.items?.map((i: any) => ({
        id: i.id,
        productId: i.productId ? String(i.productId) : "",
        product: i.product,
        uom: i.uom ?? "",
        quantity: Number(i.quantity ?? 0),
        unitPrice: Number(i.unitPrice ?? 0),
        tax: Number(i.tax ?? 0),
        taxableAmount: Number(i.taxableAmount ?? 0),
        cgstRate: Number(i.cgstRate ?? 0),
        cgstAmount: Number(i.cgstAmount ?? 0),
        sgstRate: Number(i.sgstRate ?? 0),
        sgstAmount: Number(i.sgstAmount ?? 0),
        igstRate: Number(i.igstRate ?? 0),
        igstAmount: Number(i.igstAmount ?? 0),
        lineTotal: Number(i.lineTotal ?? 0),
      })) ?? [],

    subtotal: Number(po.subtotal ?? 0),
    discountType: po.discountType ?? "PERCENT",
    discountValue: Number(po.discountValue ?? 0),
    totalDiscount: Number(po.totalDiscount ?? 0),
    totalTax: Number(po.totalTax ?? 0),
    totalCgst: Number(po.totalCgst ?? 0),
    totalSgst: Number(po.totalSgst ?? 0),
    totalIgst: Number(po.totalIgst ?? 0),
    netAmount: Number(po.netAmount ?? 0),
  };
};

const PurchaseOrderForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  const { addPurchaseOrder, editPurchaseOrder } = usePurchaseOrders();
  const user = useSelector((state: any) => state?.auth?.user);
  const { suppliers, loadSuppliers } = useSuppliers();

  const [formData, setFormData] = useState<PurchaseOrderFormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const { data: company } = useSelector((state: any) => state.company);
  const { data: stores } = useAppSelector((state) => state.stores);
  const { activeUOMs, loadActiveUOMs } = useUOMs();
  const companyState = company?.state;
  const [loading, setLoading] = useState(isEdit);
  const [shippingResetKey, setShippingResetKey] = useState(0);
  const [poNotFound, setPoNotFound] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingForApproval, setIsSubmittingForApproval] = useState(false);

  useFormShortcuts({});

  const selectedSupplier = useMemo(
    () => (suppliers || []).find((s) => String(s?.id) === String(formData.supplierId)),
    [suppliers, formData.supplierId]
  );

  const isLocked = useMemo(() => {
    if (!isEdit) return false;
    return formData.status !== "DRAFT";
  }, [isEdit, formData.status]);

  const isInterState = useMemo(() => {
    if (!companyState || !formData.billingState) return false;
    return companyState.toLowerCase().trim() !== formData.billingState.toLowerCase().trim();
  }, [companyState, formData.billingState]);

  // Re-run GST split (CGST/SGST ↔ IGST) whenever inter-state flag changes
  useEffect(() => {
    setFormData((prev) => {
      const updatedItems = (prev.items || []).map((item) => {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || 0;
        const rawMaterial = (rawMaterials || []).find(
          (rm: any) => String(rm.rawMaterialId) === String(item.productId)
        );
        const mult = getUomMultiplier(item.uom, rawMaterial?.baseUom);
        const lineSubtotal = qty * mult * price;
        const taxableAmount = lineSubtotal;
        const totalGstRate = Number(item.tax) || 0;
        const totalGstAmount = (taxableAmount * totalGstRate) / 100;

        let cgstRate = 0,
          cgstAmount = 0,
          sgstRate = 0,
          sgstAmount = 0,
          igstRate = 0,
          igstAmount = 0;
        if (isInterState) {
          igstRate = totalGstRate;
          igstAmount = totalGstAmount;
        } else {
          cgstRate = totalGstRate / 2;
          sgstRate = totalGstRate / 2;
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
          lineTotal: taxableAmount + totalGstAmount,
          discount: 0,
        };
      });

      return {
        ...prev,
        items: updatedItems,
        ...recalculateTotals(updatedItems, isInterState),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInterState]);

  const gstRateBreakdown = useMemo(() => {
    const map = new Map<number, number>();
    (formData.items || []).forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const rawMaterial = (rawMaterials || []).find(
        (rm: any) => String(rm.rawMaterialId) === String(item.productId)
      );
      const mult = getUomMultiplier(item.uom, rawMaterial?.baseUom);
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
  }, [formData.items, rawMaterials]);

  const refreshSuppliers = useCallback(() => {
    loadSuppliers({ limit: 1000 });
  }, [loadSuppliers]);

  const refreshRawMaterials = useCallback(async () => {
    try {
      const res = await rawMaterialService.fetchAll();
      const materials = Array.isArray(res) ? res : (res?.rawMaterials ?? []);
      setRawMaterials(materials);
    } catch {
      toast.error("Failed to load raw materials");
    }
  }, []);

  const refreshStores = useCallback(() => {
    dispatch(fetchStores({ storeCategory: "RAW_MATERIAL" }));
  }, [dispatch]);

  const fetchNextCode = useCallback(async () => {
    try {
      const nextCode = await purchaseOrderService.fetchNextCode();
      if (nextCode) {
        setFormData((prev) => ({ ...prev, poNumber: nextCode }));
      }
    } catch {
      // Silently fail - PO number will be generated server-side
    }
  }, []);

  // Real-time socket listeners
  useSocketSync("supplier", undefined, refreshSuppliers);
  useSocketSync("rawMaterial", undefined, refreshRawMaterials);
  useSocketSync("store", undefined, refreshStores);
  useSocketSync("purchaseOrder", undefined, fetchNextCode);

  useEffect(() => {
    refreshSuppliers();
    refreshStores();
    loadActiveUOMs();
    refreshRawMaterials();
    if (!isEdit) {
      fetchNextCode();
    }
  }, [
    refreshSuppliers,
    dispatch,
    refreshStores,
    loadActiveUOMs,
    refreshRawMaterials,
    fetchNextCode,
    isEdit,
  ]);

  useEffect(() => {
    if (!isEdit && user) {
      setFormData((prev) => ({
        ...prev,
        createdByOn: user?.username || "",
      }));
    }
  }, [user, isEdit]);

  // Auto-populate billing address from company profile (always company address)
  useEffect(() => {
    if (company && !isEdit) {
      setFormData((prev) => ({
        ...prev,
        billingAddressLine1: company.addressLine1 || "",
        billingCity: company.city || "",
        billingState: company.state || "",
        billingPincode: company.zipcode || "",
        billingCountry: company.country || "India",
      }));
    }
  }, [company, isEdit]);

  // Load PO data for Edit Mode
  useEffect(() => {
    if (!isEdit || !id) return;

    let mounted = true;
    const fetchData = async () => {
      setFetchError(false);
      setPoNotFound(false);
      setLoading(true);
      try {
        const po = await purchaseOrderService.fetchById(id);
        if (mounted) {
          if (!po) {
            setPoNotFound(true);
            return;
          }
          const poData = mapPOToFormData(po);
          setFormData(poData);
        }
      } catch {
        if (mounted) {
          setFetchError(true);
          toast.error("Failed to load purchase order");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    return () => {
      mounted = false;
    };
  }, [id, isEdit]);

  const recalculateTotals = (items: PurchaseOrderItem[], interState: boolean = isInterState) => {
    let subtotal = 0;
    let totalTax = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    items.forEach((item) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const rawMaterial = (rawMaterials || []).find(
        (rm: any) => String(rm.rawMaterialId) === String(item.productId)
      );
      const mult = getUomMultiplier(item.uom, rawMaterial?.baseUom);
      const lineSubtotal = qty * mult * price;

      const taxableAmount = lineSubtotal;
      const totalGstRate = Number(item.tax) || 0;
      const totalGstAmount = (taxableAmount * totalGstRate) / 100;

      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;

      if (interState) {
        igstAmount = totalGstAmount;
      } else {
        cgstAmount = totalGstAmount / 2;
        sgstAmount = totalGstAmount / 2;
      }

      subtotal += lineSubtotal;
      totalTax += totalGstAmount;
      totalCgst += cgstAmount;
      totalSgst += sgstAmount;
      totalIgst += igstAmount;
    });

    return {
      subtotal,
      totalDiscount: 0,
      totalTax,
      totalCgst,
      totalSgst,
      totalIgst,
      netAmount: subtotal + totalTax,
    };
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    if (name === "supplierId") {
      const selectedSup = suppliers.find((s) => String(s.id) === String(value));
      setFormData((prev) => ({
        ...prev,
        supplierId: value,
        billingAddressLine1: company?.addressLine1 || "",
        billingCity: company?.city || "",
        billingState: company?.state || "",
        billingPincode: company?.zipcode || "",
        billingCountry: company?.country || "India",
        items: [],
        subtotal: 0,
        totalDiscount: 0,
        totalTax: 0,
        totalCgst: 0,
        totalSgst: 0,
        totalIgst: 0,
        netAmount: 0,
      }));
      if (errors.supplierId) {
        setErrors((prev) => ({ ...prev, supplierId: "" }));
      }
      return;
    }

    if (name === "storeId") {
      const selectedStore = stores.find((s: any) => s.storeId === value);
      // Store address is saved as JSON in locationDesc
      let addr: any = null;
      if (selectedStore?.locationDesc) {
        try {
          addr = JSON.parse(selectedStore.locationDesc);
        } catch {
          /* not JSON */
        }
      }
      setFormData((prev) => ({
        ...prev,
        storeId: value,
        shippingAddressLine1: addr?.addressLine || company?.addressLine1 || "",
        shippingCity: addr?.city || company?.city || "",
        shippingState: addr?.state || company?.state || "",
        shippingCountry: addr?.country || company?.country || "India",
        shippingPincode: addr?.zipcode || company?.zipcode || "",
      }));
      setShippingResetKey((k) => k + 1);
      if (errors.storeId) {
        setErrors((prev) => ({ ...prev, storeId: "" }));
      }
      return;
    }

    if (name === "poDate") {
      setFormData((prev) => {
        const selectedSupObj = suppliers.find((s) => String(s.id) === String(prev.supplierId));
        const supplierPrices = selectedSupObj?.materialPrices || [];
        const dateToCheck = value || new Date().toISOString().split("T")[0];

        const updatedItems = prev.items.map((item) => {
          const rawMaterial = rawMaterials.find(
            (rm) => String(rm.rawMaterialId) === String(item.productId)
          );
          const mult = getUomMultiplier(item.uom, rawMaterial?.baseUom);

          const activePriceObj = supplierPrices.find((p: any) => {
            const validFromDate = p.validFrom ? p.validFrom.split("T")[0] : "";
            const validToDate = p.validTo ? p.validTo.split("T")[0] : "";
            return (
              String(p.rawMaterialId) === String(item.productId) &&
              validFromDate <= dateToCheck &&
              (!validToDate || validToDate >= dateToCheck)
            );
          });

          const parsedUnitPrice = activePriceObj
            ? typeof activePriceObj.price === "string"
              ? parseFloat(activePriceObj.price)
              : Number(activePriceObj.price)
            : rawMaterial?.rate
              ? typeof rawMaterial.rate === "string"
                ? parseFloat(rawMaterial.rate)
                : Number(rawMaterial.rate)
              : 0;

          const qty = Number(item.quantity) || 0;
          const lineSubtotal = qty * mult * parsedUnitPrice;

          const taxableAmount = lineSubtotal;
          const totalGstRate = Number(item.tax) || 0;
          const totalGstAmount = (taxableAmount * totalGstRate) / 100;

          let cgstRate = 0;
          let cgstAmount = 0;
          let sgstRate = 0;
          let sgstAmount = 0;
          let igstRate = 0;
          let igstAmount = 0;

          if (isInterState) {
            igstRate = totalGstRate;
            igstAmount = totalGstAmount;
          } else {
            cgstRate = totalGstRate / 2;
            sgstRate = totalGstRate / 2;
            cgstAmount = totalGstAmount / 2;
            sgstAmount = totalGstAmount / 2;
          }

          return {
            ...item,
            unitPrice: parsedUnitPrice,
            taxableAmount,
            cgstRate,
            cgstAmount,
            sgstRate,
            sgstAmount,
            igstRate,
            igstAmount,
            lineTotal: taxableAmount + totalGstAmount,
            product: item.product
              ? {
                  ...item.product,
                  unitPrice: parsedUnitPrice,
                }
              : undefined,
          };
        });

        return {
          ...prev,
          poDate: value,
          expectedDeliveryDate: value,
          items: updatedItems,
          ...recalculateTotals(updatedItems, isInterState),
        };
      });
      if (errors.poDate) {
        setErrors((prev) => ({ ...prev, poDate: "" }));
      }
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleBillingStateChange = (stateName: string) => {
    setFormData((prev) => ({
      ...prev,
      billingState: stateName,
      billingCity: "",
    }));
    setErrors((prev) => ({
      ...prev,
      billingState: "",
      billingCity: "",
    }));
  };

  const handleBillingCityChange = (cityName: string) => {
    setFormData((prev) => ({ ...prev, billingCity: cityName }));
    setErrors((prev) => ({ ...prev, billingCity: "" }));
  };

  const handleShippingStateChange = (stateName: string) => {
    setFormData((prev) => ({
      ...prev,
      shippingState: stateName,
      shippingCity: "",
    }));
    setErrors((prev) => ({
      ...prev,
      shippingState: "",
      shippingCity: "",
    }));
  };

  const handleShippingCityChange = (cityName: string) => {
    setFormData((prev) => ({ ...prev, shippingCity: cityName }));
    setErrors((prev) => ({ ...prev, shippingCity: "" }));
  };

  const handleItemChange = (
    index: number,
    field: keyof PurchaseOrderItem | "uom",
    value: any,
    selectedUom?: string
  ) => {
    setFormData((prev) => {
      const items = [...prev.items];
      const updatedUom =
        selectedUom !== undefined ? selectedUom : field === "uom" ? value : items[index].uom;
      items[index] = { ...items[index], [field]: value, uom: updatedUom };

      const item = items[index];
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const rawMaterial = (rawMaterials || []).find(
        (rm: any) => String(rm.rawMaterialId) === String(item.productId)
      );
      const mult = getUomMultiplier(item.uom, rawMaterial?.baseUom);
      const lineSubtotal = qty * mult * price;

      const taxableAmount = lineSubtotal;
      const totalGstRate = Number(item.tax) || 0;
      const totalGstAmount = (taxableAmount * totalGstRate) / 100;

      let cgstRate = 0;
      let cgstAmount = 0;
      let sgstRate = 0;
      let sgstAmount = 0;
      let igstRate = 0;
      let igstAmount = 0;

      if (isInterState) {
        igstRate = totalGstRate;
        igstAmount = totalGstAmount;
      } else {
        cgstRate = totalGstRate / 2;
        sgstRate = totalGstRate / 2;
        cgstAmount = totalGstAmount / 2;
        sgstAmount = totalGstAmount / 2;
      }

      items[index] = {
        ...item,
        taxableAmount,
        cgstRate,
        cgstAmount,
        sgstRate,
        sgstAmount,
        igstRate,
        igstAmount,
        lineTotal: taxableAmount + totalGstAmount,
      };

      return {
        ...prev,
        items,
        ...recalculateTotals(items, isInterState),
      };
    });

    setErrors((prev) => {
      const next = { ...prev };
      delete next[`items.${index}.${field}`];
      return next;
    });
  };

  const handleItemProductChange = (index: number, productId: string) => {
    const rawMaterial = rawMaterials.find((rm) => String(rm.rawMaterialId) === String(productId));

    let parsedUnitPrice = 0;
    setFormData((prev) => {
      const selectedSupObj = suppliers.find((s) => String(s.id) === String(prev.supplierId));
      const supplierPrices = selectedSupObj?.materialPrices || [];
      const dateToCheck = prev.poDate || new Date().toISOString().split("T")[0];
      const activePriceObj = supplierPrices.find((p: any) => {
        const validFromDate = p.validFrom ? p.validFrom.split("T")[0] : "";
        const validToDate = p.validTo ? p.validTo.split("T")[0] : "";
        return (
          String(p.rawMaterialId) === String(productId) &&
          validFromDate <= dateToCheck &&
          (!validToDate || validToDate >= dateToCheck)
        );
      });

      parsedUnitPrice = activePriceObj
        ? typeof activePriceObj.price === "string"
          ? parseFloat(activePriceObj.price)
          : Number(activePriceObj.price)
        : rawMaterial?.rate
          ? typeof rawMaterial.rate === "string"
            ? parseFloat(rawMaterial.rate)
            : Number(rawMaterial.rate)
          : 0;

      const defaultTaxRate = 0;

      const defaultUom = rawMaterial?.baseUom ? rawMaterial.baseUom.split(",")[0].trim() : "";
      const mult = getUomMultiplier(defaultUom, rawMaterial?.baseUom);

      const items = [...prev.items];
      const item = items[index];
      const qty = Number(item.quantity) || 0;
      const lineSubtotal = qty * mult * parsedUnitPrice;

      const taxableAmount = lineSubtotal;
      const totalGstRate = defaultTaxRate;
      const totalGstAmount = (taxableAmount * totalGstRate) / 100;

      let cgstRate = 0;
      let cgstAmount = 0;
      let sgstRate = 0;
      let sgstAmount = 0;
      let igstRate = 0;
      let igstAmount = 0;

      if (isInterState) {
        igstRate = totalGstRate;
        igstAmount = totalGstAmount;
      } else {
        cgstRate = totalGstRate / 2;
        sgstRate = totalGstRate / 2;
        cgstAmount = totalGstAmount / 2;
        sgstAmount = totalGstAmount / 2;
      }

      items[index] = {
        ...item,
        productId,
        product: rawMaterial
          ? {
              id: rawMaterial.rawMaterialId,
              productCode: rawMaterial.rawMaterialId,
              productName: rawMaterial.materialName,
              unit: rawMaterial.baseUom,
              unitPrice: parsedUnitPrice,
            }
          : undefined,
        unitPrice: parsedUnitPrice,
        uom: rawMaterial?.baseUom ? rawMaterial.baseUom.split(",")[0].trim() : "",
        tax: totalGstRate,
        taxableAmount,
        cgstRate,
        cgstAmount,
        sgstRate,
        sgstAmount,
        igstRate,
        igstAmount,
        lineTotal: taxableAmount + totalGstAmount,
      };

      return {
        ...prev,
        items,
        ...recalculateTotals(items, isInterState),
      };
    });

    setErrors((prev) => {
      const next = { ...prev };
      delete next[`items.${index}.productId`];
      if (parsedUnitPrice > 0) {
        delete next[`items.${index}.unitPrice`];
      }
      return next;
    });
  };

  const addItem = () => {
    setFormData((prev) => {
      const items = [
        ...prev.items,
        {
          productId: "",
          uom: "",
          quantity: 1,
          unitPrice: 0,
          tax: 0,
          taxableAmount: 0,
          cgstRate: 0,
          cgstAmount: 0,
          sgstRate: 0,
          sgstAmount: 0,
          igstRate: 0,
          igstAmount: 0,
          lineTotal: 0,
        },
      ];
      return {
        ...prev,
        items,
        ...recalculateTotals(items, isInterState),
      };
    });
  };

  const removeItem = (index: number) => {
    setFormData((prev) => {
      const items = prev.items.filter((_, i) => i !== index);
      return {
        ...prev,
        items,
        ...recalculateTotals(items, isInterState),
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent, submitStatus: "DRAFT" | "APPROVED") => {
    e.preventDefault();

    if (isLocked) {
      toast.error("This Purchase Order is in a read-only state and cannot be updated.");
      return;
    }

    const validationErrors = validatePurchaseOrder(formData);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      toast.error("Please fill all required fields correctly.");
      return;
    }

    if (submitStatus === "DRAFT") setIsSubmitting(true);
    else setIsSubmittingForApproval(true);

    const payload = {
      poDate: formData.poDate,
      expectedDeliveryDate: formData.expectedDeliveryDate,
      supplierId: formData.supplierId,

      billingAddressLine1: formData.billingAddressLine1,
      billingCountry: formData.billingCountry || "India",
      billingCity: formData.billingCity,
      billingState: formData.billingState,
      billingPincode: formData.billingPincode,
      shippingAddressLine1: formData.shippingAddressLine1,
      shippingCountry: formData.shippingCountry || "India",
      shippingCity: formData.shippingCity,
      shippingState: formData.shippingState,
      shippingPincode: formData.shippingPincode,
      remarks: formData.remarks,
      storeId: formData.storeId,
      discountType: formData.discountType,
      discountValue: formData.discountValue,

      items: formData.items.map((item) => ({
        productId: item.productId,
        uom: item.uom,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice) || 0,
        tax: Number(item.tax) || 0,
        taxableAmount: item.taxableAmount || 0,
        cgstRate: item.cgstRate || 0,
        cgstAmount: item.cgstAmount || 0,
        sgstRate: item.sgstRate || 0,
        sgstAmount: item.sgstAmount || 0,
        igstRate: item.igstRate || 0,
        igstAmount: item.igstAmount || 0,
      })),

      totalDiscount: formData.totalDiscount,
      totalTax: formData.totalTax,
      totalCgst: formData.totalCgst,
      totalSgst: formData.totalSgst,
      totalIgst: formData.totalIgst,
      roundingAdjust: 0,
      netAmount: formData.netAmount,

      status: submitStatus,
    };

    try {
      if (isEdit) {
        await editPurchaseOrder(id!, payload);
        toast.success("Purchase Order updated successfully!");
      } else {
        await addPurchaseOrder(payload);
        toast.success(
          submitStatus === "DRAFT"
            ? "Purchase Order saved as draft!"
            : "Purchase Order approved successfully!"
        );
      }
      navigate("/purchase-orders");
    } catch (error: any) {
      toast.error(error?.message || `Failed to ${isEdit ? "update" : "create"} purchase order`);
    } finally {
      setIsSubmitting(false);
      setIsSubmittingForApproval(false);
    }
  };

  if (loading) {
    return <CommonLoader text="Loading Purchase Order..." fullScreen={false} />;
  }

  if (poNotFound) {
    return (
      <Tile className="mx-auto my-8 max-w-lg">
        <EmptyState
          icon={<FileQuestion size={28} />}
          title="Purchase Order Not Found"
          description="The purchase order you are trying to edit does not exist or has been deleted."
          action={<BackButton text="Back to Purchase Orders" to="/purchase-orders" />}
        />
      </Tile>
    );
  }

  if (fetchError) {
    return (
      <Tile className="mx-auto my-8 max-w-lg">
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="Failed to Load Purchase Order"
          description="Something went wrong while retrieving the purchase order data."
          action={
            <>
              <BackButton text="Back" />
              <ActionPill variant="blue" onClick={() => window.location.reload()}>
                Retry
              </ActionPill>
            </>
          }
        />
      </Tile>
    );
  }

  const supplierOptions = (suppliers || []).map((s) => ({
    value: s?.id ? String(s.id) : "",
    label: s?.displayName || s?.legalName || "",
  }));

  const uomOptions = [
    { value: "", label: "-- Select UOM --" },
    ...(activeUOMs || []).map((uom: any) => ({
      value: uom.uomName,
      label: uom.uomName,
    })),
  ];

  const supplierMaterialIds = selectedSupplier?.materialPrices
    ? selectedSupplier.materialPrices.map((mp: any) => String(mp.rawMaterialId))
    : [];

  const safeRawMaterials = Array.isArray(rawMaterials) ? rawMaterials : [];
  const filteredRawMaterials =
    supplierMaterialIds.length > 0
      ? safeRawMaterials.filter(
          (rm) =>
            supplierMaterialIds.includes(String(rm.rawMaterialId)) ||
            formData.items.some((item) => item.productId === rm.rawMaterialId)
        )
      : safeRawMaterials;

  const productOptions = filteredRawMaterials.map((rm) => ({
    value: String(rm.rawMaterialId || ""),
    label: `${rm.rawMaterialId || ""} - ${rm.materialName || ""}`,
  }));

  const title = isEdit
    ? isLocked
      ? "View purchase order"
      : "Edit purchase order"
    : "New purchase order";

  return (
    <div className="sl-page sl-page-doc">
      <PageHeader
        title={title}
        meta={
          <>
            {formData.poNumber && (
              <Chip size="sm" tone="muted" className="tabular-nums">
                {formData.poNumber}
              </Chip>
            )}
            {isEdit && formData.status && <StatusBadge status={formData.status} />}
          </>
        }
        subtitle="Raw material ordered from a supplier into a store. Approved orders are received on a GRN invoice."
        back={() => navigate(-1)}
        backLabel="Back to List"
        breadcrumbs={[
          { label: "Purchase orders", to: "/purchase-orders" },
          { label: isEdit ? formData.poNumber || "Edit" : "New" },
        ]}
      />

      {isLocked && (
        <div
          role="status"
          className="sl-tile mb-4 flex items-start gap-3 border-l-4 !border-l-[color:var(--color-warning)] px-4 py-3 text-sm text-ink"
        >
          <Lock
            size={16}
            className="mt-0.5 shrink-0 text-[color:var(--color-warning)]"
            aria-hidden="true"
          />
          <span>
            <span className="font-semibold">View only.</span> This PO is in '{formData.status}'
            status. Only Draft orders can be modified.
          </span>
        </div>
      )}

      <form noValidate className="space-y-4">
        <Tile title="PO Details" icon={<FileText size={18} />}>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
            <TextInput
              label="PO Number"
              name="poNumber"
              value={formData.poNumber}
              onChange={handleChange}
              disabled
            />
            <DatePickerCalendar
              label="PO Date"
              name="poDate"
              value={formData.poDate}
              onChange={(e) => handleChange(e as any)}
              required
              error={errors.poDate}
              disabled={isLocked || isEdit}
            />
            <SelectInput
              label="Supplier"
              name="supplierId"
              value={formData.supplierId}
              options={[{ value: "", label: "-- Select Supplier --" }, ...supplierOptions]}
              onChange={handleChange}
              required
              searchable
              error={errors.supplierId}
              disabled={isLocked || isEdit}
            />
            <SelectInput
              label="Store"
              name="storeId"
              value={formData.storeId || ""}
              options={[
                { label: "-- Select Store --", value: "" },
                ...(stores || [])
                  .filter((s: any) => s.isActive)
                  .map((s: any) => ({ label: s.storeName, value: s.storeId })),
              ]}
              required
              onChange={handleChange}
              searchable
              error={errors.storeId}
              disabled={isLocked}
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-[14px] bg-card-2 p-3">
              <div className="sl-section-label">Billing address · company</div>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink">
                {[
                  formData.billingAddressLine1,
                  formData.billingCity,
                  formData.billingState,
                  formData.billingCountry,
                  formData.billingPincode,
                ]
                  .filter(Boolean)
                  .join(", ") || <span className="text-ink-subtle">No address configured</span>}
              </p>
            </div>
            <div className="rounded-[14px] bg-card-2 p-3">
              <div className="sl-section-label">Shipping address · store</div>
              <p className="m-0 mt-1 text-[13px] leading-relaxed text-ink">
                {[
                  formData.shippingAddressLine1,
                  formData.shippingCity,
                  formData.shippingState,
                  formData.shippingCountry,
                  formData.shippingPincode,
                ]
                  .filter(Boolean)
                  .join(", ") || (
                  <span className="text-ink-subtle">Select a store to see address</span>
                )}
              </p>
            </div>
          </div>
        </Tile>

        <Tile
          title="Order Items"
          subtitle="Materials are limited to the ones priced for this supplier, when it has a price list."
          icon={<Package size={18} />}
          actions={
            <ActionPill
              size="sm"
              variant="secondary"
              icon={<Plus size={15} />}
              onClick={addItem}
              disabled={isLocked}
            >
              Add Item
            </ActionPill>
          }
        >
          <div className="overflow-x-auto rounded-[14px] border border-line-soft [&_.mb-\[18px\]]:!mb-0 [&_.select-input-group]:!mb-0">
            <table className="min-w-full">
              <caption className="sr-only">Purchase order lines</caption>
              <thead className="bg-card-2">
                <tr className="border-b border-line-soft">
                  <th scope="col" className="sl-th px-2 py-2.5 w-10 text-center">
                    #
                  </th>
                  <th scope="col" className="sl-th px-2 py-2.5 min-w-[220px] text-left">
                    Raw Material
                  </th>
                  <th scope="col" className="sl-th px-2 py-2.5 min-w-[180px] text-left">
                    Qty & UOM
                  </th>
                  <th scope="col" className="sl-th px-2 py-2.5 min-w-[120px] text-left">
                    Unit Price (₹)
                  </th>
                  <th scope="col" className="sl-th px-2 py-2.5 w-24 text-left">
                    Tax %
                  </th>
                  <th scope="col" className="sl-th px-2 py-2.5 text-right">
                    Total
                  </th>
                  <th scope="col" className="sl-th px-2 py-2.5 w-12">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {formData.items.map((item, index) => {
                  const qty = Number(item.quantity) || 0;
                  const price = Number(item.unitPrice) || 0;
                  const taxPercent = Number(item.tax) || 0;
                  const rawMaterial = rawMaterials.find(
                    (rm) => String(rm.rawMaterialId) === String(item.productId)
                  );
                  const mult = getUomMultiplier(item.uom, rawMaterial?.baseUom);
                  const taxableAmount = qty * mult * price;
                  const gstAmount = taxableAmount * (taxPercent / 100);
                  const lineTotal = taxableAmount + gstAmount;
                  return (
                    <tr key={index} className="align-top">
                      <td className="px-3 py-3 text-center text-[13px] tabular-nums text-ink-subtle">
                        {index + 1}
                      </td>
                      <td className="px-2 py-1.5">
                        <SelectInput
                          noMargin={true}
                          name={`items[${index}].productId`}
                          value={item.productId ? String(item.productId) : ""}
                          options={[
                            { value: "", label: "-- Select Material --" },
                            ...productOptions,
                          ]}
                          onChange={(e) => handleItemProductChange(index, e.target.value)}
                          error={errors[`items.${index}.productId`]}
                          hideLabel
                          disabled={isLocked}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <QuantityInput
                          name={`items[${index}].quantity`}
                          value={item.quantity}
                          baseUoms={rawMaterial?.baseUom || item.uom || "KG"}
                          uom={item.uom}
                          onUomChange={(newUom) => handleItemChange(index, "uom", newUom)}
                          onChange={(e) =>
                            handleItemChange(
                              index,
                              "quantity",
                              Number(e.target.value),
                              e.target.uom
                            )
                          }
                          error={errors[`items.${index}.quantity`]}
                          step="0.01"
                          hideLabel
                          disabled={isLocked}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <TextInput
                          label=""
                          name={`items[${index}].unitPrice`}
                          type="number"
                          value={String(item.unitPrice)}
                          onChange={(e) =>
                            handleItemChange(index, "unitPrice", Number(e.target.value))
                          }
                          error={errors[`items.${index}.unitPrice`]}
                          min={0}
                          step={0.01}
                          placeholder="0.00"
                          disabled={isLocked}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <TextInput
                          name={`items[${index}].tax`}
                          type="number"
                          value={String(item.tax || 0)}
                          onChange={(e) => handleItemChange(index, "tax", Number(e.target.value))}
                          min={0}
                          max={100}
                          step={0.01}
                          placeholder="0"
                          disabled={isLocked}
                        />
                      </td>
                      <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-ink">
                        {formatINR(lineTotal)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <DeleteButton onClick={() => removeItem(index)} disabled={isLocked} />
                      </td>
                    </tr>
                  );
                })}
                {formData.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-ink-subtle">
                      No items added — click "Add Item" to begin
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Tile>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Tile>
            <TextInput
              label="Remarks"
              name="remarks"
              value={formData.remarks}
              onChange={handleChange}
              disabled={isLocked}
            />
          </Tile>
          <Tile>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium text-ink-subtle">Net amount</span>
              <span className="text-[26px] font-bold leading-tight tracking-tight tabular-nums text-ink">
                {formatINR(formData.netAmount)}
              </span>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-[13px] text-ink-muted">
                <span>Subtotal</span>
                <span className="tabular-nums text-ink">{formatINR(formData.subtotal)}</span>
              </div>
              {isInterState ? (
                gstRateBreakdown.length === 0 ? (
                  <div className="flex justify-between text-[13px] text-ink-muted">
                    <span>Total IGST:</span>
                    <span className="tabular-nums text-ink">
                      {formatINR(formData.totalIgst ?? 0)}
                    </span>
                  </div>
                ) : (
                  gstRateBreakdown.map((group) => (
                    <div
                      key={`igst-${group.gstRate}`}
                      className="flex justify-between text-[13px] text-ink-muted"
                    >
                      <span>IGST {group.gstRate}%:</span>
                      <span className="tabular-nums text-ink">{formatINR(group.igstAmount)}</span>
                    </div>
                  ))
                )
              ) : gstRateBreakdown.length === 0 ? (
                <>
                  <div className="flex justify-between text-[13px] text-ink-muted">
                    <span>Total CGST:</span>
                    <span className="tabular-nums text-ink">
                      {formatINR(formData.totalCgst ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[13px] text-ink-muted">
                    <span>Total SGST:</span>
                    <span className="tabular-nums text-ink">
                      {formatINR(formData.totalSgst ?? 0)}
                    </span>
                  </div>
                </>
              ) : (
                gstRateBreakdown.map((group) => (
                  <React.Fragment key={`gst-${group.gstRate}`}>
                    <div className="flex justify-between text-[13px] text-ink-muted">
                      <span>CGST {group.cgstRate}%:</span>
                      <span className="tabular-nums text-ink">{formatINR(group.cgstAmount)}</span>
                    </div>
                    <div className="flex justify-between text-[13px] text-ink-muted">
                      <span>SGST {group.sgstRate}%:</span>
                      <span className="tabular-nums text-ink">{formatINR(group.sgstAmount)}</span>
                    </div>
                  </React.Fragment>
                ))
              )}
            </div>
            <p className="m-0 mt-3 text-[12px] text-ink-subtle">
              {isInterState ? "Inter-state: IGST applies." : "Intra-state: CGST + SGST apply."}
            </p>
          </Tile>
        </div>

        {!isLocked && (
          <FormFooter start={<KeyHint keys={["F2"]}>saves a draft</KeyHint>}>
            <ActionPill variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </ActionPill>
            <ActionPill
              data-submit-btn
              variant="secondary"
              icon={<Save size={16} />}
              loading={isSubmitting}
              loadingText="Saving..."
              disabled={isSubmittingForApproval}
              onClick={(e: any) => handleSubmit(e, "DRAFT")}
            >
              Save as Draft
            </ActionPill>
            <ActionPill
              icon={<Send size={16} />}
              loading={isSubmittingForApproval}
              loadingText="Approving..."
              disabled={isSubmitting}
              onClick={(e: any) => handleSubmit(e, "APPROVED")}
            >
              Approve Order
            </ActionPill>
          </FormFooter>
        )}
      </form>
    </div>
  );
};

export default PurchaseOrderForm;
