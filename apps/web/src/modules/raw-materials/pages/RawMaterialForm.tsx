import React, { useState, useEffect, useCallback } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import QuantityInput from "../../../components/form/QuantityInput/QuantityInput";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  createRawMaterial,
  updateRawMaterial,
} from "../../../features/raw-materials/rawMaterialSlice";
import { fetchStores } from "../../../features/stores/storeSlice";
import { rawMaterialService } from "../../../services/rawMaterialService";
import { gstService, type GstSlab, type HsnCode } from "../../../services/gstService";
import UOMSelect from "../../../components/form/SelectInput/UOMSelect";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { z } from "zod";
import { categoryService } from "../../../services/categoryService";
import { convertToPrimaryUom } from "../../../utils/uomConversion";
import { Eraser, Save } from "lucide-react";
import { ActionPill, PageHeader, SkeletonTile, Tile } from "../../../components/ui/v2";
import FormFooter from "../../stock/lib/FormFooter";

const initialFormState = {
  rawMaterialId: "",
  materialName: "",
  categoryId: "" as string | number,
  minimumStock: "",
  storeId: "",
  baseUom: "",
  reorderLevel: "",
  rate: "",
  hsnCodeId: "",
  gstRate: "",
  batchNo: "",
  onHandQty: "",
  reservedQty: "",
  narration: "",
  lastMovementAt: "",
  status: "Active",
};

const rawMaterialSchema = z
  .object({
    materialName: z
      .string()
      .trim()
      .min(1, "Material Name is required")
      .max(100, "Material Name cannot exceed 100 characters")
      .regex(
        /^(?=.*[A-Za-z])[A-Za-z0-9\s&().,-]+$/,
        "Material Name must contain at least one letter and only valid characters"
      ),

    storeId: z.string().trim().min(1, "Store is required"),

    baseUom: z.string().trim().min(1, "Base UOM is required"),

    minimumStock: z
      .string()
      .trim()
      .min(1, "Minimum Stock is required")
      .refine((value) => !isNaN(Number(value)) && Number(value) >= 0, {
        message: "Minimum Stock must be greater than or equal to 0",
      }),

    reorderLevel: z
      .string()
      .trim()
      .min(1, "Reorder Level is required")
      .refine((value) => !isNaN(Number(value)) && Number(value) >= 0, {
        message: "Reorder Level must be greater than or equal to 0",
      }),

    rate: z
      .string()
      .trim()
      .min(1, "Rate is required")
      .refine((value) => !isNaN(Number(value)) && Number(value) >= 0, {
        message: "Rate must be greater than or equal to 0",
      }),

    batchNo: z.string().trim().max(40, "Batch Number cannot exceed 40 characters").optional(),

    onHandQty: z
      .string()
      .trim()
      .min(1, "Opening Stock is required")
      .refine((value) => !isNaN(Number(value)) && Number(value) >= 0, {
        message: "Opening Stock must be greater than or equal to 0",
      }),

    narration: z.string().trim().max(255, "Narration cannot exceed 255 characters").optional(),

    status: z.enum(["Active", "Inactive"], {
      error: "Status is required",
    }),
  })
  .refine((data) => Number(data.reorderLevel) >= Number(data.minimumStock), {
    path: ["reorderLevel"],
    message: "Reorder Level must be greater than or equal to Minimum Stock",
  });

const RawMaterialForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  const [formData, setFormData] = useState(initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [openingStockUom, setOpeningStockUom] = useState("");
  const [minimumStockUom, setMinimumStockUom] = useState("");
  const [reorderLevelUom, setReorderLevelUom] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<
    { label: string; value: string | number }[]
  >([]);
  const [hsnCodes, setHsnCodes] = useState<HsnCode[]>([]);
  const [gstSlabs, setGstSlabs] = useState<GstSlab[]>([]);

  useFormShortcuts({});

  const { data: stores } = useAppSelector((state) => state.stores);
  const fetchStoresData = useCallback(() => {
    dispatch(fetchStores({ storeCategory: "RAW_MATERIAL" }));
  }, [dispatch]);

  useSocketSync("store", undefined, fetchStoresData);

  const fetchCategoriesData = useCallback(() => {
    categoryService
      .fetchAll({ type: "RAW_MATERIAL", isActive: true })
      .then((res) => {
        const list = res?.categories ?? res ?? [];
        setCategoryOptions(
          Array.isArray(list) ? list.map((c: any) => ({ label: c.name, value: c.id })) : []
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCategoriesData();
  }, [fetchCategoriesData]);

  // H08: tax defaults for purchase lines come from the HSN code or the GST rate set here.
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

  // Keep category dropdown fresh when categories change in another tab
  useSocketSync("category", undefined, fetchCategoriesData);

  useEffect(() => {
    setOpeningStockUom("");
    setMinimumStockUom("");
    setReorderLevelUom("");
  }, [formData.baseUom]);

  const populateFormData = useCallback((data: any) => {
    setFormData({
      rawMaterialId: data.rawMaterialId || "",
      materialName: data.materialName || "",
      categoryId: data.categoryId ?? "",
      minimumStock:
        data.minimumStock !== null && data.minimumStock !== undefined
          ? String(data.minimumStock)
          : "",
      storeId: data.storeId || data.store?.storeId || "",
      baseUom: data.baseUom || "",
      reorderLevel:
        data.reorderLevel !== null && data.reorderLevel !== undefined
          ? String(data.reorderLevel)
          : "",
      rate:
        data.rate !== null && data.rate !== undefined
          ? String(data.rate)
          : data.unitPrice !== null && data.unitPrice !== undefined
            ? String(data.unitPrice)
            : "",
      hsnCodeId: data.hsnCodeId ?? data.hsnCode?.id ?? "",
      gstRate: data.gstRate !== null && data.gstRate !== undefined ? String(Number(data.gstRate)) : "",
      batchNo: data.batchNo || "",
      onHandQty:
        data.onHandQty !== null && data.onHandQty !== undefined ? String(data.onHandQty) : "",
      reservedQty:
        data.reservedQty !== null && data.reservedQty !== undefined ? String(data.reservedQty) : "",
      narration: data.narration || data.remarks || "",
      lastMovementAt: data.lastMovementAt || "",
      status: data.status || (data.isActive ? "Active" : "Inactive"),
    });
  }, []);

  useEffect(() => {
    fetchStoresData();

    if (isEditMode && id) {
      const stateData = location.state as any;
      if (stateData && stateData.rawMaterialId === id) {
        populateFormData(stateData);
      } else {
        setIsLoadingData(true);
        rawMaterialService
          .fetchById(id)
          .then((data) => {
            populateFormData(data);
          })
          .catch((err) => {
            toast.error(err?.message || "Failed to load raw material data");
            navigate("/raw-materials");
          })
          .finally(() => {
            setIsLoadingData(false);
          });
      }
    } else {
      rawMaterialService
        .fetchNextId()
        .then((nextId) => {
          setFormData((prev) => ({ ...prev, rawMaterialId: nextId }));
        })
        .catch(() => {});
    }
  }, [isEditMode, id, location.state, fetchStoresData, populateFormData, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: "",
      }));
    }
  };

  const handleClear = () => {
    setFormData((prev) => ({ ...initialFormState, rawMaterialId: prev.rawMaterialId }));
    setErrors({});
    setOpeningStockUom("");
    setMinimumStockUom("");
    setReorderLevelUom("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    try {
      rawMaterialSchema.parse(formData);
      setErrors({});
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
        const formattedErrors: Record<string, string> = {};
        Object.keys(fieldErrors).forEach((key) => {
          const message = fieldErrors[key]?.[0];
          if (message) {
            formattedErrors[key] = message;
          }
        });
        setErrors(formattedErrors);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const primaryUom = formData.baseUom.split(",")[0]?.trim() || "";
      const convertedOnHandQty = convertToPrimaryUom(
        formData.onHandQty ? Number(formData.onHandQty) : 0,
        openingStockUom || primaryUom,
        formData.baseUom
      );
      const convertedMinStock = convertToPrimaryUom(
        formData.minimumStock ? Number(formData.minimumStock) : 0,
        minimumStockUom || primaryUom,
        formData.baseUom
      );
      const convertedReorderLevel = convertToPrimaryUom(
        formData.reorderLevel ? Number(formData.reorderLevel) : 0,
        reorderLevelUom || primaryUom,
        formData.baseUom
      );

      const payload: any = {
        rawMaterialId: formData.rawMaterialId,
        materialName: formData.materialName,
        categoryId: formData.categoryId ? Number(formData.categoryId) : null,
        storeId: formData.storeId || null,
        baseUom: formData.baseUom,
        minimumStock: convertedMinStock,
        reorderLevel: convertedReorderLevel,
        rate: formData.rate ? Number(formData.rate) : null,
        hsnCodeId: formData.hsnCodeId || null,
        gstRate: formData.gstRate ? Number(formData.gstRate) : null,
        // Opening stock is set on create only. Edits never send stock: the API refuses it, and
        // stock moves only through stock transactions and adjustments.
        ...(isEditMode
          ? {}
          : {
              onHandQty: convertedOnHandQty,
              reservedQty: formData.reservedQty ? Number(formData.reservedQty) : 0,
            }),
        batchNo: formData.batchNo || null,
        narration: formData.narration || null,
        status: formData.status,
        isActive: formData.status === "Active",
        itemType: "RAW_MATERIAL",
      };

      if (isEditMode && id) {
        await dispatch(updateRawMaterial({ id, data: payload })).unwrap();
        toast.success("Raw material updated successfully!");
      } else {
        await dispatch(createRawMaterial(payload)).unwrap();
        toast.success("Raw material created successfully!");
      }
      navigate("/raw-materials");
    } catch (err: any) {
      toast.error(
        typeof err === "string"
          ? err
          : err?.message ||
              (isEditMode ? "Failed to update raw material" : "Failed to create raw material")
      );
      setIsSubmitting(false);
    }
  };

  const header = (
    <PageHeader
      title={isEditMode ? "Edit raw material" : "New raw material"}
      subtitle="A material you buy and consume in production, with its stock levels"
      back="/raw-materials"
      backLabel="Back to raw materials"
      breadcrumbs={[
        { label: "Inventory" },
        { label: "Raw materials", to: "/raw-materials" },
        { label: isEditMode ? "Edit" : "New" },
      ]}
    />
  );

  const hsnOptions = hsnCodes.map((h) => ({
    value: h.id,
    label: `${h.code} · ${h.description} (${Number(h.gstRate)}%)`,
  }));
  const gstOptions = gstSlabs.map((g) => ({
    value: String(Number(g.rate)),
    label: `${Number(g.rate)}%`,
  }));
  const hasTaxDefault = Boolean(formData.hsnCodeId || formData.gstRate);

  if (isLoadingData) {
    return (
      <div className="w-full min-w-0">
        {header}
        <div className="flex flex-col gap-4">
          <SkeletonTile lines={4} />
          <SkeletonTile lines={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="sl-page sl-page-form">
      {header}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Tile title="Material" subtitle="Identity, where it is stored and how it is measured">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
            <TextInput
              label="Raw Material ID"
              name="rawMaterialId"
              value={formData.rawMaterialId}
              disabled={true}
              required
              error={errors.rawMaterialId}
              onChange={handleChange}
            />
            <div className="md:col-span-2">
              <TextInput
                label="Material Name"
                name="materialName"
                value={formData.materialName}
                required
                error={errors.materialName}
                onChange={handleChange}
              />
            </div>

            <SelectInput
              label="Category"
              name="categoryId"
              value={formData.categoryId}
              options={categoryOptions}
              onChange={handleChange}
              searchable
            />
            <div className="md:col-span-2">
              <SelectInput
                label="Store"
                name="storeId"
                value={formData.storeId}
                options={[
                  { label: "Select Store", value: "" },
                  ...(stores || []).map((store: any) => ({
                    label: store.storeName,
                    value: store.storeId,
                  })),
                ]}
                required
                error={errors.storeId}
                onChange={handleChange}
              />
            </div>

            <div className="md:col-span-3">
              <UOMSelect
                name="baseUom"
                label="Base UOM"
                value={formData.baseUom}
                required
                isMulti
                category={["length", "mass", "each", "volume"]}
                allowedCodes={["kg", "g", "mt", "l", "ml", "m", "cm", "mm", "dz", "ea"]}
                onChange={(value) => {
                  setFormData((prev) => ({ ...prev, baseUom: value }));
                  if (errors.baseUom) {
                    setErrors((prev) => ({ ...prev, baseUom: "" }));
                  }
                }}
                error={errors.baseUom}
              />
            </div>
          </div>
        </Tile>

        <Tile
          title="Stock levels"
          subtitle="Opening balance, the floor you never go below, and when to reorder"
        >
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
            <QuantityInput
              label="Opening Stock"
              name="onHandQty"
              value={formData.onHandQty}
              baseUoms={formData.baseUom}
              uom={openingStockUom || undefined}
              onUomChange={setOpeningStockUom}
              required
              error={errors.onHandQty}
              onChange={handleChange}
              disabled={isEditMode}
            />
            <QuantityInput
              label="Minimum Stock"
              name="minimumStock"
              value={formData.minimumStock}
              baseUoms={formData.baseUom}
              uom={minimumStockUom || undefined}
              onUomChange={setMinimumStockUom}
              required
              error={errors.minimumStock}
              onChange={handleChange}
            />
            <QuantityInput
              label="Reorder Level"
              name="reorderLevel"
              value={formData.reorderLevel}
              baseUoms={formData.baseUom}
              uom={reorderLevelUom || undefined}
              onUomChange={setReorderLevelUom}
              required
              error={errors.reorderLevel}
              onChange={handleChange}
            />
          </div>
        </Tile>

        <Tile title="Pricing & status">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-3">
            <TextInput
              type="number"
              label="Rate"
              name="rate"
              inputMode="decimal"
              value={formData.rate}
              required
              error={errors.rate}
              onChange={handleChange}
            />
            <SelectInput
              label="HSN Code"
              name="hsnCodeId"
              value={formData.hsnCodeId}
              options={hsnOptions}
              defaultOptionLabel="-- Select HSN --"
              onChange={handleChange}
              searchable
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
            {!hasTaxDefault && (
              <p className="text-xs text-amber-700 md:col-span-3">
                No HSN code or GST rate is set. Purchase lines for this material will default to 0% tax.
              </p>
            )}
            <SelectInput
              label="Status"
              name="status"
              value={formData.status}
              options={[
                { label: "Active", value: "Active" },
                { label: "Inactive", value: "Inactive" },
              ]}
              required
              error={errors.status}
              onChange={handleChange}
            />
            <div>
              <TextInput
                label="Narration"
                name="narration"
                value={formData.narration}
                error={errors.narration}
                onChange={handleChange}
              />
              {/* R2P-B12: the API accepts 255 characters; say so before the save is refused. */}
              <p className="sl-muted m-0 mt-1 text-right text-xs">{formData.narration.length}/255</p>
            </div>
          </div>
        </Tile>

        <FormFooter hint="F2 saves">
          <ActionPill variant="secondary" onClick={() => navigate("/raw-materials")}>
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
            loadingText={isEditMode ? "Updating..." : "Saving..."}
          >
            {isEditMode ? "Update Material" : "Save Material"}
          </ActionPill>
        </FormFooter>
      </form>
    </div>
  );
};

export default RawMaterialForm;
