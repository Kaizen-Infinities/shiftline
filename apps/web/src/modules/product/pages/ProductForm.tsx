import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { getServerErrorMessage, getServerFieldErrors } from "../../../utils/serverErrors";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useNavigate, useParams } from "react-router-dom";
import { Eraser, Gauge, Image as ImageIcon, ImagePlus, Plus, Save, X } from "lucide-react";
import { toast } from "react-toastify";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import QuantityInput from "../../../components/form/QuantityInput/QuantityInput";
import MultiSelect from "../../../components/form/multiSelect/MultiSelect";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import { useProducts } from "../../../hooks/useProducts";
import { productService } from "../../../services/productService";
import { storeService } from "../../../services/storeService";
import { gstService, type GstSlab, type HsnCode } from "../../../services/gstService";
import { rawMaterialService } from "../../../services/rawMaterialService";
import { getImageUrl } from "../../../utils/ImageUrls";
import { useSocketSync } from "../../../hooks/useSocketSync";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonTile,
  Tile,
} from "../../../components/ui/v2";
import FormFooter from "../../stock/lib/FormFooter";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { employeeService } from "../../../services/employeeService";
import { roleService } from "../../../services/roleService";
import { shiftService } from "../../../services/shiftService";
import { machineService } from "../../../services/machineService";
import { customerGradeService, type CustomerGrade } from "../../../services/customerGradeService";
import { categoryService } from "../../../services/categoryService";

const MAX_IMAGES = 3;

interface ExistingProductImage {
  id: string | number;
  imageUrl: string;
  isPrimary?: boolean;
}

const initialFormState = {
  productCode: "",
  productName: "",
  categoryId: "",
  weightPerPiece: "",
  weightUom: "g",
  productType: "SALES_PRODUCTION",
  description: "",
  isActive: "true",
  isScrap: "false",
  rate: "",
  minimumQty: "",
  openingStockQty: "",
  openingStockStoreId: "",
  hsnCodeId: "",
  gstRate: "",
};

type RawMaterialRow = { rawMaterialId: string; percentage: string; requiredQuantity: string };
type InitialCapacityRow = {
  capDate: string;
  capShiftId: string;
  capRoleId: string;
  capOperatorIds: string[];
  capQty: string;
  capMachine: string;
};

const ProductForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();

  const { addProduct, editProduct } = useProducts();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [existingImages, setExistingImages] = useState<ExistingProductImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<(string | number)[]>([]);
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stores, setStores] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [formData, setFormData] = useState(initialFormState);

  const [rawMaterials, setRawMaterials] = useState<RawMaterialRow[]>([]);
  const [hsnCodes, setHsnCodes] = useState<HsnCode[]>([]);
  const [gstSlabs, setGstSlabs] = useState<GstSlab[]>([]);
  const [allRawMaterials, setAllRawMaterials] = useState<any[]>([]);
  const [initialCapacities, setInitialCapacities] = useState<InitialCapacityRow[]>([]);

  const [employees, setEmployees] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [customerGrades, setCustomerGrades] = useState<CustomerGrade[]>([]);
  // Grade-based dynamic pricing: { "<gradeName>": "<rate>" }
  const [gradeRates, setGradeRates] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<any[]>([]);

  useFormShortcuts({});

  const fetchStoresData = useCallback(() => {
    storeService
      .fetchAll({ storeCategory: "FINISHED_GOODS" })
      .then((res) => {
        const data = Array.isArray(res?.stores)
          ? res.stores
          : Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res)
              ? res
              : [];
        setStores(data);
      })
      .catch(() => {});
  }, []);
  const fetchRawMaterialsData = useCallback(() => {
    rawMaterialService
      .fetchAll({})
      .then((res: any) => {
        const data = Array.isArray(res?.rawMaterials)
          ? res.rawMaterials
          : Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res)
              ? res
              : [];
        const rmOnly = data.filter((item: any) => item.itemType !== "WASTAGE");
        setAllRawMaterials(rmOnly);
      })
      .catch(() => {});
  }, []);
  const fetchEmployeesData = useCallback(() => {
    employeeService
      .fetchAll({ limit: 500 })
      .then((res: any) => {
        const data = Array.isArray(res)
          ? res
          : Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res?.employees)
              ? res.employees
              : [];
        setEmployees(data);
      })
      .catch(() => {});
  }, []);
  const fetchRolesData = useCallback(() => {
    roleService
      .fetchAll({ limit: 100 })
      .then((res: any) => {
        const roleList = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        setRoles(roleList);
      })
      .catch(() => {});
  }, []);
  const fetchShiftsData = useCallback(() => {
    shiftService
      .fetchAll()
      .then((res: any) => {
        const data = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        setShifts(data);
      })
      .catch(() => {});
  }, []);
  const fetchMachinesData = useCallback(() => {
    machineService
      .getAll()
      .then((res: any) => {
        const data = Array.isArray(res)
          ? res
          : Array.isArray(res?.machines)
            ? res.machines
            : Array.isArray(res?.data)
              ? res.data
              : [];
        setMachines(data);
      })
      .catch(() => {});
  }, []);
  const fetchCustomerGradesData = useCallback(() => {
    customerGradeService
      .getAll()
      .then((res: any) => {
        const data = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        setCustomerGrades(data);
      })
      .catch(() => {});
  }, []);
  const fetchCategoriesData = useCallback(() => {
    categoryService
      .fetchAll({ type: "PRODUCT", isActive: true })
      .then((res: any) => {
        const list = res?.categories ?? res ?? [];
        if (Array.isArray(list) && list.length > 0) {
          setCategories(list);
        } else {
          categoryService.fetchAll({ isActive: true }).then((allRes: any) => {
            const allList = allRes?.categories ?? allRes ?? [];
            setCategories(Array.isArray(allList) ? allList : []);
          });
        }
      })
      .catch(() => {});
  }, []);

  useSocketSync("store", undefined, fetchStoresData);
  useSocketSync("rawMaterial", undefined, fetchRawMaterialsData);
  useSocketSync("employee", undefined, fetchEmployeesData);
  useSocketSync("role", undefined, fetchRolesData);
  useSocketSync("shift", undefined, fetchShiftsData);
  useSocketSync("machine", undefined, fetchMachinesData);
  useSocketSync("customerGrade", undefined, fetchCustomerGradesData);
  useSocketSync("category", undefined, fetchCategoriesData);

  const populateFormData = useCallback((productData: any) => {
    let latestStock: any = null;
    if (productData.finishedGoodsStocks && productData.finishedGoodsStocks.length > 0) {
      latestStock = [...productData.finishedGoodsStocks].sort(
        (a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0];
    }

    setFormData({
      productCode: productData.productCode || "",
      productName: productData.productName || "",
      categoryId: productData.categoryId
        ? String(productData.categoryId)
        : productData.category?.id
          ? String(productData.category.id)
          : "",
      weightPerPiece: productData.weightPerPiece != null ? String(productData.weightPerPiece) : "",
      weightUom: productData.weightUom || "g",
      productType: productData.productType || "SALES_PRODUCTION",
      description: productData.description || "",
      isActive: productData.isActive ? "true" : "false",
      isScrap: productData.isScrap ? "true" : "false",
      rate: productData.rate != null ? String(productData.rate) : "",
      minimumQty: productData.minimumQty != null ? String(productData.minimumQty) : "",
      openingStockQty: latestStock ? String(latestStock.onHandQty) : "",
      openingStockStoreId: latestStock ? String(latestStock.storeId) : "",
      hsnCodeId: productData.hsnCodeId ?? productData.hsnCode?.id ?? "",
      gstRate: productData.gstRate != null ? String(Number(productData.gstRate)) : "",
    });

    if (productData.billOfMaterials) {
      setRawMaterials(
        productData.billOfMaterials.map((bom: any) => ({
          rawMaterialId: bom.rawMaterialId,
          percentage: bom.percentage != null ? String(Number(bom.percentage)) : "",
          requiredQuantity:
            bom.requiredQuantity != null ? String(Number(bom.requiredQuantity)) : "",
        }))
      );
    } else {
      setRawMaterials([]);
    }

    // Load grade-based rates from product data
    if (productData.gradeRates && typeof productData.gradeRates === "object") {
      const loaded: Record<string, string> = {};
      for (const [key, val] of Object.entries(productData.gradeRates)) {
        loaded[key] = String(val);
      }
      setGradeRates(loaded);
    } else {
      setGradeRates({});
    }

    const images: ExistingProductImage[] = (productData.images || []).slice();
    images.sort((a: any, b: any) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    setExistingImages(images);
    setRemovedImageIds([]);
  }, []);

  useEffect(() => {
    gstService
      .listHsn({ type: "HSN", limit: 500 })
      .then(setHsnCodes)
      .catch(() => {});
    gstService
      .listRates()
      .then(setGstSlabs)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCategoriesData();
    fetchStoresData();
    fetchRawMaterialsData();
    fetchEmployeesData();
    fetchRolesData();
    fetchShiftsData();
    fetchMachinesData();
    fetchCustomerGradesData();

    if (isEditMode && id) {
      setIsLoadingData(true);
      productService
        .fetchById(id)
        .then((data) => populateFormData(data))
        .catch((err) => {
          console.error("Failed to fetch product:", err);
          toast.error("Failed to load product data");
          navigate("/products");
        })
        .finally(() => setIsLoadingData(false));
    } else {
      productService
        .fetchNextId()
        .then((nextCode) => setFormData((prev) => ({ ...prev, productCode: nextCode })))
        .catch((err) => console.error("Failed to fetch next product code", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, id]);

  useEffect(() => {
    return () => {
      newImagePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [newImagePreviews]);

  // ─── Validation ──────────────────────────────────────────────────────
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.productName.trim()) newErrors.productName = "Product Name is required.";

    if (!formData.categoryId) newErrors.categoryId = "Category is required.";

    if (!formData.weightPerPiece.toString().trim()) {
      newErrors.weightPerPiece = "Required";
    } else {
      const weight = Number(formData.weightPerPiece);
      if (isNaN(weight) || weight <= 0) newErrors.weightPerPiece = "Must be > 0";
    }

    if (!formData.openingStockQty.toString().trim()) {
      newErrors.openingStockQty = "Opening Stock Qty is required.";
    } else {
      const qty = Number(formData.openingStockQty);
      if (isNaN(qty) || qty < 0) newErrors.openingStockQty = "Must be 0 or greater.";
    }

    if (!formData.openingStockStoreId.toString().trim()) {
      newErrors.openingStockStoreId = "Opening Stock Store is required.";
    }

    const minQty = formData.minimumQty ? Number(formData.minimumQty) : NaN;
    if (!formData.minimumQty.toString().trim()) {
      newErrors.minimumQty = "Minimum Stock Qty is required.";
    } else if (isNaN(minQty) || minQty < 0) {
      newErrors.minimumQty = "Minimum Stock Qty must be 0 or greater.";
    }

    // Validate grade rates only when grades are configured
    if (customerGrades.length > 0) {
      const filledGradeRates = Object.entries(gradeRates).filter(
        ([, v]) => v.toString().trim() !== ""
      );
      if (filledGradeRates.length === 0) {
        newErrors.gradeRates = "At least one grade rate is required.";
      } else {
        for (const [gradeName, val] of filledGradeRates) {
          const n = Number(val);
          if (isNaN(n) || n <= 0) {
            newErrors[`gradeRate_${gradeName}`] = "Must be > 0";
          }
        }
      }
    }

    if (rawMaterials.length === 0) {
      newErrors.rawMaterials = "At least one raw material is required for BOM composition.";
      toast.error("At least one raw material is required for BOM composition.");
    } else {
      const totalPercent = rawMaterials.reduce((acc, rm) => acc + Number(rm.percentage || 0), 0);
      // Recipes entered as quantity per piece carry no percentages; only a percentage recipe
      // has to add up to 100.
      if (totalPercent > 0 && Math.abs(totalPercent - 100) > 0.01) {
        newErrors.rawMaterials = "Total percentage must be exactly 100%";
        toast.error("Total Raw Material percentage must be exactly 100%");
      }

      const selectedRmIds = rawMaterials.map((rm) => rm.rawMaterialId).filter(Boolean);
      const uniqueRmIds = new Set(selectedRmIds);
      if (uniqueRmIds.size !== selectedRmIds.length) {
        newErrors.rawMaterials = "Duplicate raw materials selected in BOM.";
        toast.error("Duplicate raw materials selected in BOM");
      }

      rawMaterials.forEach((rm, index) => {
        if (!rm.rawMaterialId) newErrors[`rawMaterials.${index}.rawMaterialId`] = "Required";
        if (Number(rm.percentage || 0) <= 0 && Number(rm.requiredQuantity || 0) <= 0)
          newErrors[`rawMaterials.${index}.percentage`] = "Enter % or qty";
      });
    }

    // Validate Initial Capacity Setup fields — all fields mandatory when a setup is added
    if (initialCapacities.length > 0) {
      initialCapacities.forEach((cap, idx) => {
        if (!cap.capDate) newErrors[`cap_${idx}_date`] = "Date is required";
        if (!cap.capShiftId) newErrors[`cap_${idx}_shift`] = "Shift is required";
        if (!cap.capMachine) newErrors[`cap_${idx}_machine`] = "Machine is required";
        if (!cap.capRoleId) newErrors[`cap_${idx}_role`] = "Role is required";
        if (cap.capOperatorIds.length === 0)
          newErrors[`cap_${idx}_operators`] = "At least one operator is required";
        if (!cap.capQty || Number(cap.capQty) <= 0)
          newErrors[`cap_${idx}_qty`] = "Qty / Shift must be > 0";
      });
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ─── Handlers ─────────────────────────────────────────────────────────
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleAddRawMaterial = () => {
    setRawMaterials((prev) => [
      ...prev,
      { rawMaterialId: "", percentage: "", requiredQuantity: "" },
    ]);
  };

  const handleRemoveRawMaterial = (index: number) => {
    setRawMaterials((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRawMaterialChange = (index: number, field: keyof RawMaterialRow, value: string) => {
    setRawMaterials((prev) => {
      const newRm = [...prev];
      newRm[index] = { ...newRm[index], [field]: value };
      return newRm;
    });
    if (errors[`rawMaterials.${index}.${field}`] || errors.rawMaterials) {
      setErrors((prev) => ({ ...prev, [`rawMaterials.${index}.${field}`]: "", rawMaterials: "" }));
    }
  };

  const handleAddInitialCapacity = () => {
    setInitialCapacities((prev) => [
      ...prev,
      {
        capDate: new Date().toISOString().split("T")[0],
        capShiftId: "",
        capRoleId: "",
        capOperatorIds: [],
        capQty: "",
        capMachine: "",
      },
    ]);
  };

  const handleRemoveInitialCapacity = (index: number) => {
    setInitialCapacities((prev) => prev.filter((_, i) => i !== index));
  };

  const handleInitialCapacityChange = (
    index: number,
    field: keyof InitialCapacityRow,
    value: any
  ) => {
    setInitialCapacities((prev) => {
      const newCap = [...prev];
      newCap[index] = { ...newCap[index], [field]: value };
      if (field === "capRoleId") {
        newCap[index].capOperatorIds = [];
      }
      return newCap;
    });
  };

  const remainingSlots = MAX_IMAGES - existingImages.length - newImageFiles.length;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (files.length > remainingSlots) {
      toast.error(
        remainingSlots > 0
          ? `You can only add ${remainingSlots} more image(s) (max ${MAX_IMAGES} total).`
          : `Maximum ${MAX_IMAGES} images allowed.`
      );
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        toast.error("Only JPG, PNG, WEBP allowed");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Each image must be under 5MB");
        return;
      }
    }

    const previews = files.map((file) => URL.createObjectURL(file));
    setNewImageFiles((prev) => [...prev, ...files]);
    setNewImagePreviews((prev) => [...prev, ...previews]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveExistingImage = (imageId: string | number) => {
    setExistingImages((prev) => prev.filter((img) => img.id !== imageId));
    setRemovedImageIds((prev) => [...prev, imageId]);
  };

  const handleRemoveNewImage = (index: number) => {
    URL.revokeObjectURL(newImagePreviews[index]);
    setNewImageFiles((prev) => prev.filter((_, i) => i !== index));
    setNewImagePreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClear = () => {
    setFormData((prev) => ({ ...initialFormState, productCode: prev.productCode }));
    setRawMaterials([]);
    setInitialCapacities([]);
    setGradeRates({});
    setErrors({});
    setNewImageFiles([]);
    setNewImagePreviews([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!validateForm()) return;

    try {
      setIsSubmitting(true);
      const payload = new FormData();
      payload.append("productCode", formData.productCode);
      payload.append("productName", formData.productName);
      payload.append("categoryId", formData.categoryId);

      const totalCapQty = initialCapacities.reduce((acc, cap) => acc + Number(cap.capQty || 0), 0);
      if (totalCapQty > 0) payload.append("capacityLitres", String(totalCapQty));

      if (formData.weightPerPiece) payload.append("weightPerPiece", formData.weightPerPiece);
      if (formData.weightUom) payload.append("weightUom", formData.weightUom);

      payload.append("productType", formData.productType);
      // Always sent so clearing the HSN or the rate override persists.
      payload.append("hsnCodeId", formData.hsnCodeId);
      payload.append("gstRate", formData.gstRate);
      if (formData.description) payload.append("description", formData.description);
      payload.append("isActive", String(formData.isActive === "true"));
      payload.append("isScrap", String(formData.isScrap === "true"));

      if (formData.rate) payload.append("rate", formData.rate);

      // Build grade rates object (only filled-in grades)
      const builtGradeRates: Record<string, number> = {};
      for (const [gradeName, val] of Object.entries(gradeRates)) {
        const n = Number(val);
        if (val.toString().trim() !== "" && !isNaN(n) && n > 0) {
          builtGradeRates[gradeName] = n;
        }
      }
      if (Object.keys(builtGradeRates).length > 0) {
        payload.append("gradeRates", JSON.stringify(builtGradeRates));
      }

      payload.append("minimumQty", formData.minimumQty || "0");

      if (formData.openingStockQty) payload.append("openingStockQty", formData.openingStockQty);
      if (formData.openingStockStoreId)
        payload.append("openingStockStoreId", formData.openingStockStoreId);

      const combinedBOM = rawMaterials.map((rm) => ({
        rawMaterialId: rm.rawMaterialId,
        percentage: rm.percentage,
        requiredQuantity: Number(rm.requiredQuantity) || 0,
      }));
      payload.append("rawMaterials", JSON.stringify(combinedBOM));

      if (initialCapacities.length > 0) {
        const capacityHistory = initialCapacities
          .filter((cap) => cap.capQty && Number(cap.capQty) > 0)
          .map((cap) => ({
            recordedAt: cap.capDate,
            shiftId: cap.capShiftId,
            machineId: cap.capMachine,
            operatorName: cap.capOperatorIds
              .map((id) => employees.find((e) => String(e.id) === id)?.fullName || id)
              .join(", "),
            newCapacity: Number(cap.capQty),
          }));
        if (capacityHistory.length > 0) {
          payload.append("capacityHistory", JSON.stringify(capacityHistory));
        }
      }

      newImageFiles.forEach((file) => payload.append("images", file));
      removedImageIds.forEach((imgId) => payload.append("removedImageIds", String(imgId)));
      if (existingImages.length > 0) {
        payload.append("primaryImageId", String(existingImages[0].id));
      }

      if (isEditMode && id) {
        await editProduct(id, payload as any);
        toast.success("Product updated successfully!");
      } else {
        await addProduct(payload as any);
        toast.success("Product created successfully!");
      }
      navigate("/products");
    } catch (err: any) {
      const fieldErrors: Record<string, string> = {};
      getServerFieldErrors(err).forEach(({ path, message }) => {
        fieldErrors[path] = message;
      });
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      toast.error(
        getServerErrorMessage(
          err,
          isEditMode ? "Failed to update product" : "Failed to create product"
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Options for dropdowns ───────────────────────────────────────────
  const categoryOptions = useMemo(
    () => (categories || []).map((c) => ({ value: String(c.id), label: c.name })),
    [categories]
  );

  const storeOptions = useMemo(
    () => [
      { value: "", label: "-- Select Store --" },
      ...stores.map((s) => ({
        value: String(s.storeId),
        label: s.storeCode ? `${s.storeName} (${s.storeCode})` : s.storeName,
      })),
    ],
    [stores]
  );

  const bomOptions = useMemo(() => {
    return allRawMaterials.map((rm) => ({
      value: String(rm.rawMaterialId),
      label: rm.materialName,
      disabled: rawMaterials.some((r) => String(r.rawMaterialId) === String(rm.rawMaterialId)),
    }));
  }, [allRawMaterials, rawMaterials]);

  const hasAnyImage = existingImages.length > 0 || newImagePreviews.length > 0;

  const bomTotal = rawMaterials.reduce((sum, rm) => sum + (Number(rm.percentage) || 0), 0);
  const hsnOptions = useMemo(
    () =>
      hsnCodes.map((h) => ({
        value: h.id,
        label: `${h.code} · ${h.description} (${Number(h.gstRate)}%)`,
      })),
    [hsnCodes]
  );
  const gstOptions = useMemo(
    () => gstSlabs.map((g) => ({ value: String(Number(g.rate)), label: `${Number(g.rate)}%` })),
    [gstSlabs]
  );

  const gridClass = "grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4";

  if (isLoadingData) {
    return (
      <div className="w-full min-w-0">
        <PageHeader
          title={isEditMode ? "Edit production product" : "New production product"}
          back="/products"
          backLabel="Back to products"
        />
        <div className="flex flex-col gap-4">
          <SkeletonTile lines={4} />
          <SkeletonTile lines={3} />
          <SkeletonTile lines={2} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={isEditMode ? "Edit production product" : "New production product"}
        subtitle={
          isEditMode
            ? `${formData.productCode} · ${formData.productName || "Production product"}`
            : "A finished good you manufacture, its recipe (BOM) and machine capacity"
        }
        back="/products"
        backLabel="Back to products"
        breadcrumbs={[
          { label: "Inventory" },
          { label: "Production products", to: "/products" },
          { label: isEditMode ? "Edit" : "New" },
        ]}
        meta={isEditMode ? <Chip size="sm">{formData.productCode}</Chip> : undefined}
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {/* ── Product ── */}
        <Tile title="Product details" subtitle="What it is and how it is classified">
          <div className={gridClass}>
            <TextInput
              label="Product Code"
              name="productCode"
              value={formData.productCode}
              placeholder="e.g. PRD-001"
              required
              onChange={handleChange}
              disabled
            />
            <TextInput
              label="Product Name"
              name="productName"
              value={formData.productName}
              placeholder="e.g. Plastic Bucket 20L"
              required
              onChange={handleChange}
              error={errors.productName}
            />
            <SelectInput
              label="Category"
              name="categoryId"
              value={formData.categoryId}
              options={categoryOptions}
              defaultOptionLabel="-- Select Category --"
              required
              onChange={handleChange}
              error={errors.categoryId}
              disabled={isEditMode}
            />
            <SelectInput
              label="Product Type"
              name="productType"
              value={formData.productType}
              options={[
                { value: "PRODUCTION", label: "Production" },
                { value: "SALES_PRODUCTION", label: "Sales Production" },
              ]}
              required
              onChange={handleChange}
              error={errors.productType}
            />
            <SelectInput
              label="HSN Code"
              name="hsnCodeId"
              value={formData.hsnCodeId}
              options={hsnOptions}
              defaultOptionLabel="-- Select HSN --"
              onChange={handleChange}
              error={errors.hsnCodeId}
            />
            <SelectInput
              label="GST Rate (overrides HSN)"
              name="gstRate"
              value={formData.gstRate}
              options={gstOptions}
              defaultOptionLabel="-- Use HSN rate --"
              onChange={handleChange}
            />
            <SelectInput
              label="Status"
              name="isActive"
              value={formData.isActive}
              options={[
                { value: "true", label: "Active" },
                { value: "false", label: "Inactive" },
              ]}
              onChange={handleChange}
            />
            <SelectInput
              label="Scrap / Waste Item"
              name="isScrap"
              value={formData.isScrap}
              options={[
                { value: "false", label: "No" },
                { value: "true", label: "Yes" },
              ]}
              onChange={handleChange}
            />
            <div className="md:col-span-2">
              <TextInput
                label="Description"
                name="description"
                value={formData.description}
                placeholder="Enter catalogue description..."
                onChange={handleChange}
              />
            </div>
          </div>
        </Tile>

        {/* ── Weight, pricing and stock ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Tile title="Weight & pricing" subtitle="Per-piece weight and the default selling rate">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
              <QuantityInput
                label="Weight per Piece"
                name="weightPerPiece"
                required
                value={formData.weightPerPiece}
                baseUoms="g,kg"
                uom={formData.weightUom}
                onUomChange={(val) => setFormData((prev) => ({ ...prev, weightUom: val }))}
                onChange={handleChange}
                error={errors.weightPerPiece}
                disabled={isEditMode}
              />
              <TextInput
                label="Rate (₹)"
                name="rate"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={formData.rate}
                placeholder="0.00"
                onChange={handleChange}
                error={errors.rate}
              />
            </div>
          </Tile>

          <Tile title="Stock" subtitle="Opening balance and the reorder level">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
              <SelectInput
                label="Opening Stock Store"
                name="openingStockStoreId"
                required
                value={formData.openingStockStoreId}
                options={storeOptions}
                onChange={handleChange}
                error={errors.openingStockStoreId}
                disabled={isEditMode}
              />
              <TextInput
                label="Opening Stock Qty"
                name="openingStockQty"
                type="number"
                inputMode="decimal"
                placeholder="0"
                required
                value={formData.openingStockQty}
                onChange={handleChange}
                error={errors.openingStockQty}
                disabled={isEditMode}
              />
              <TextInput
                label="Minimum Stock Qty"
                name="minimumQty"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={String(formData.minimumQty)}
                onChange={handleChange}
                required
                error={errors.minimumQty}
              />
            </div>
          </Tile>
        </div>

        {/* ── Grade rates ── */}
        {customerGrades.length > 0 && (
          <Tile
            title={
              <>
                Grade rates (₹){" "}
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </>
            }
            subtitle="Price per customer grade; fill at least one"
          >
            <div className={gridClass}>
              {customerGrades.map((grade) => (
                <TextInput
                  key={grade.id}
                  label={`${grade.name} Rate (₹)`}
                  name={`gradeRate_${grade.name}`}
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={gradeRates[grade.name] ?? ""}
                  placeholder="0.00"
                  onChange={(e) => {
                    const val = e.target.value;
                    setGradeRates((prev) => ({ ...prev, [grade.name]: val }));
                    if (errors[`gradeRate_${grade.name}`] || errors.gradeRates) {
                      setErrors((prev) => ({
                        ...prev,
                        [`gradeRate_${grade.name}`]: "",
                        gradeRates: "",
                      }));
                    }
                  }}
                  error={errors[`gradeRate_${grade.name}`]}
                />
              ))}
            </div>
            {errors.gradeRates && (
              <p role="alert" className="sl-field-error m-0 mt-2">
                {errors.gradeRates}
              </p>
            )}
          </Tile>
        )}

        {/* ── Images ── */}
        <Tile
          title="Product images"
          subtitle={`Up to ${MAX_IMAGES}; the first is the primary image`}
          actions={
            <Chip size="sm" tone={remainingSlots > 0 ? "muted" : "warning"}>
              {remainingSlots > 0 ? `${remainingSlots} left` : "Limit reached"}
            </Chip>
          }
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
            <label
              className={`flex min-h-[112px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-card-2 px-4 py-4 text-center md:w-64 ${remainingSlots > 0 ? "cursor-pointer hover:bg-nav-active" : "opacity-60"}`}
            >
              <ImagePlus size={22} className="text-accent" aria-hidden="true" />
              <span className="text-sm font-semibold text-ink">Add images</span>
              <span className="text-xs text-ink-subtle">PNG, JPEG or WebP</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={handleImageChange}
                disabled={remainingSlots <= 0}
              />
            </label>

            <div className="flex min-h-[112px] flex-1 flex-wrap items-center gap-3 rounded-[14px] border border-line-soft bg-card-2 p-3">
              {existingImages.map((img, index) => (
                <div
                  key={`existing-${img.id}`}
                  className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-line-soft bg-card"
                >
                  <img
                    src={getImageUrl(img.imageUrl)}
                    alt={`Product image ${index + 1}`}
                    className="max-h-full max-w-full object-contain"
                  />
                  {index === 0 && (
                    <span className="sl-chip sl-chip-sm sl-chip-success absolute left-1 top-1">
                      Primary
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="Remove image"
                    className="sl-icon-btn sl-icon-btn-hover-danger absolute right-1 top-1 !h-7 !w-7"
                    onClick={() => handleRemoveExistingImage(img.id)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}

              {newImagePreviews.map((preview, index) => (
                <div
                  key={`new-${index}`}
                  className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-line-soft bg-card"
                >
                  <img
                    src={preview}
                    alt={`New image ${index + 1}`}
                    className="max-h-full max-w-full object-contain"
                  />
                  {existingImages.length === 0 && index === 0 ? (
                    <span className="sl-chip sl-chip-sm sl-chip-success absolute left-1 top-1">
                      Primary
                    </span>
                  ) : (
                    <span className="sl-chip sl-chip-sm absolute bottom-1 left-1">New</span>
                  )}
                  <button
                    type="button"
                    aria-label="Remove image"
                    className="sl-icon-btn sl-icon-btn-hover-danger absolute right-1 top-1 !h-7 !w-7"
                    onClick={() => handleRemoveNewImage(index)}
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}

              {!hasAnyImage && (
                <div className="flex w-full flex-col items-center justify-center text-ink-subtle">
                  <ImageIcon size={22} aria-hidden="true" />
                  <span className="mt-1 text-xs">No images yet</span>
                </div>
              )}
            </div>
          </div>
          {errors.images && (
            <p role="alert" className="sl-field-error m-0 mt-2">
              {errors.images}
            </p>
          )}
        </Tile>

        {/* ── Raw Materials BOM ── */}
        <Tile
          title={
            <>
              Raw materials (BOM){" "}
              <span className="sl-required" aria-hidden="true">
                *
              </span>
            </>
          }
          subtitle="The recipe: share of each raw material in one piece"
          actions={
            <>
              {bomTotal > 0 && (
                <Chip
                  size="sm"
                  tone={Math.abs(bomTotal - 100) < 0.001 ? "success" : "warning"}
                  className="tabular-nums"
                >
                  Total {Number(bomTotal.toFixed(2))}%
                </Chip>
              )}
              <ActionPill
                variant="secondary"
                size="sm"
                icon={<Plus size={15} />}
                onClick={handleAddRawMaterial}
              >
                Add Raw Material
              </ActionPill>
            </>
          }
        >
          <DataTable
            columns={
              [
                {
                  header: "Raw material",
                  render: (_, idx) => (
                    <SelectInput
                      hideLabel
                      noMargin
                      name={`rm-${idx}`}
                      value={rawMaterials[idx]?.rawMaterialId ?? ""}
                      options={[{ value: "", label: "-- Select --" }, ...bomOptions]}
                      onChange={(e) =>
                        handleRawMaterialChange(idx, "rawMaterialId", e.target.value)
                      }
                      error={errors[`rawMaterials.${idx}.rawMaterialId`]}
                    />
                  ),
                },
                {
                  header: "Qty per piece (kg)",
                  width: "180px",
                  render: (_, idx) => (
                    <TextInput
                      label=""
                      bottom
                      name={`qty-${idx}`}
                      type="number"
                      step="0.001"
                      inputMode="decimal"
                      value={rawMaterials[idx]?.requiredQuantity ?? ""}
                      placeholder="0.000"
                      onChange={(e) =>
                        handleRawMaterialChange(idx, "requiredQuantity", e.target.value)
                      }
                    />
                  ),
                },
                {
                  header: "Percentage (%)",
                  width: "200px",
                  render: (_, idx) => (
                    <TextInput
                      label=""
                      bottom
                      name={`percent-${idx}`}
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={rawMaterials[idx]?.percentage ?? ""}
                      placeholder="0.00"
                      onChange={(e) => handleRawMaterialChange(idx, "percentage", e.target.value)}
                      error={errors[`rawMaterials.${idx}.percentage`]}
                    />
                  ),
                },
                {
                  header: "",
                  width: "56px",
                  align: "center",
                  render: (_, idx) => <DeleteButton onClick={() => handleRemoveRawMaterial(idx)} />,
                },
              ] as DataTableColumn<any>[]
            }
            data={rawMaterials}
            rowKey={(rm) => rm.rawMaterialId || rawMaterials.indexOf(rm)}
            minHeightClassName="min-h-0"
            density="compact"
            ariaLabel="Bill of materials"
            emptyMessage={
              <span
                className={
                  errors.rawMaterials ? "text-[color:var(--color-danger)]" : "text-ink-subtle"
                }
              >
                No raw materials added. Click "Add Raw Material" to specify the composition.
              </span>
            }
          />
          {errors.rawMaterials && (
            <p role="alert" className="sl-field-error m-0 mt-2">
              {errors.rawMaterials}
            </p>
          )}
        </Tile>

        {/* ── Initial Capacity Setup — create mode only ── */}
        {!isEditMode && (
          <Tile
            title="Initial capacity setup"
            subtitle="Pieces per shift on each machine, and who runs it"
            actions={
              <ActionPill
                variant="secondary"
                size="sm"
                icon={<Plus size={15} />}
                onClick={handleAddInitialCapacity}
              >
                Add Capacity Setup
              </ActionPill>
            }
          >
            {initialCapacities.length > 0 ? (
              <div className="flex flex-col gap-3">
                {initialCapacities.map((cap, idx) => (
                  <div
                    key={`cap-${idx}`}
                    className="rounded-[14px] border border-line-soft bg-card-2 p-3 sm:p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="sl-section-label">Setup #{idx + 1}</span>
                      <DeleteButton onClick={() => handleRemoveInitialCapacity(idx)} />
                    </div>
                    <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
                      <DatePickerCalendar
                        label="Date"
                        name={`capDate-${idx}`}
                        value={cap.capDate}
                        onChange={(e) =>
                          handleInitialCapacityChange(idx, "capDate", e.target.value)
                        }
                        required
                        error={errors[`cap_${idx}_date`]}
                      />
                      <SelectInput
                        label="Shift"
                        name={`capShiftId-${idx}`}
                        value={cap.capShiftId}
                        options={[
                          { value: "", label: "-- Shift --" },
                          ...shifts.map((s) => ({
                            value: s.shiftName || s.shiftCode,
                            label: s.shiftName || s.shiftCode,
                          })),
                        ]}
                        onChange={(e) =>
                          handleInitialCapacityChange(idx, "capShiftId", e.target.value)
                        }
                        required
                        error={errors[`cap_${idx}_shift`]}
                      />
                      <SelectInput
                        label="Machine"
                        name={`capMachine-${idx}`}
                        value={cap.capMachine}
                        options={[
                          { value: "", label: "-- Machine --" },
                          ...machines
                            .filter(
                              (m) =>
                                String(m.machineId) === String(cap.capMachine) ||
                                !initialCapacities.some(
                                  (c, i) =>
                                    i !== idx && String(c.capMachine) === String(m.machineId)
                                )
                            )
                            .map((m) => ({ value: String(m.machineId), label: m.machineName })),
                        ]}
                        onChange={(e) =>
                          handleInitialCapacityChange(idx, "capMachine", e.target.value)
                        }
                        required
                        error={errors[`cap_${idx}_machine`]}
                      />
                      <SelectInput
                        label="Role"
                        name={`capRoleId-${idx}`}
                        value={cap.capRoleId}
                        options={[
                          { value: "", label: "-- Role --" },
                          ...roles.map((role) => ({ value: String(role.id), label: role.name })),
                        ]}
                        onChange={(e) =>
                          handleInitialCapacityChange(idx, "capRoleId", e.target.value)
                        }
                        required
                        error={errors[`cap_${idx}_role`]}
                      />
                      <TextInput
                        label="Qty / Shift"
                        name={`capQty-${idx}`}
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={cap.capQty}
                        onChange={(e) => handleInitialCapacityChange(idx, "capQty", e.target.value)}
                        placeholder="0"
                        required
                        error={errors[`cap_${idx}_qty`]}
                      />
                      <div className="col-span-full">
                        <MultiSelect
                          label="Operators"
                          name={`capOperatorIds-${idx}`}
                          options={employees
                            .filter((emp) => {
                              if (!cap.capRoleId) return false;
                              const empRoleId =
                                emp.roleId ??
                                emp.role?.id ??
                                emp.user?.roleId ??
                                emp.user?.role?.id;
                              return String(empRoleId) === String(cap.capRoleId);
                            })
                            .map((emp) => ({ value: String(emp.id), label: emp.fullName }))}
                          value={cap.capOperatorIds}
                          onChange={(_, vals) =>
                            handleInitialCapacityChange(idx, "capOperatorIds", vals)
                          }
                          placeholder={cap.capRoleId ? "Select operators" : "Select role first"}
                          required
                          error={errors[`cap_${idx}_operators`]}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                icon={<Gauge size={22} strokeWidth={1.75} />}
                title="No capacity added"
                description='Click "Add Capacity Setup" to configure machines and operators.'
              />
            )}
          </Tile>
        )}

        {/* ── Footer ── */}
        <FormFooter hint="F2 saves">
          <ActionPill variant="secondary" onClick={() => navigate("/products")}>
            Cancel
          </ActionPill>
          {!isEditMode && (
            <ActionPill
              variant="secondary"
              icon={<Eraser size={16} />}
              onClick={handleClear}
              disabled={isSubmitting}
            >
              Clear
            </ActionPill>
          )}
          <ActionPill
            type="submit"
            icon={<Save size={17} />}
            loading={isSubmitting}
            loadingText="Saving…"
          >
            {isEditMode ? "Save Changes" : "Save Product"}
          </ActionPill>
        </FormFooter>
      </form>
    </div>
  );
};

export default ProductForm;
