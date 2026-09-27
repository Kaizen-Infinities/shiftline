import React, { useState, useEffect } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { Save } from "lucide-react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  createProductionWastage,
  updateProductionWastage,
} from "../../../features/production-wastage/productionWastageSlice";
import { fetchProductionOrders } from "../../../features/production-orders/productionOrderSlice";
import { fetchMachines } from "../../../features/machines/machineSlice";
import { fetchProducts } from "../../../features/product/productSlice";
import { fetchShifts } from "../../../features/shifts/shiftSlice";
import { fetchRawMaterials } from "../../../features/raw-materials/rawMaterialSlice";
import { fetchActiveUOMs } from "../../../features/uoms/uomSlice";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { z } from "zod";
import { ActionPill, PageHeader, Tile, cx } from "../../../components/ui/v2";
import { PageBody, QtyStepper, StickyFormFooter } from "../../production/ui";
import { categoryService } from "../../../services/categoryService";

const wastageSchema = z.object({
  wastageDate: z.string().min(1, "Wastage date is required"),
  productionOrderId: z.string().min(1, "Production Order reference is required"),
  wastageType: z.string().min(1, "Wastage Type is required"),
  machineId: z.string().min(1, "Machine reference is required"),
  shiftId: z.string().min(1, "Shift reference is required"),
  productId: z.string().min(1, "Product reference is required"),
  rawMaterialId: z.string().optional(),
  quantity: z
    .string()
    .min(1, "Wastage quantity is required")
    .refine((val) => !isNaN(Number(val)) && Number(val) > 0, {
      message: "Wastage quantity must be greater than 0",
    }),
  uom: z.string().min(1, "UOM is required"),
  estimatedValue: z.string().optional(),
  reason: z.string().optional(),
  correctiveAction: z.string().optional(),
  remarks: z.string().optional(),
});

const WASTAGE_TYPES = [
  { label: "Startup Waste", value: "STARTUP" },
  { label: "Machine Setup Waste", value: "MACHINE_SETUP" },
  { label: "Quality Rejection", value: "QUALITY_REJECTION" },
  { label: "Raw Material Waste", value: "RAW_MATERIAL_WASTE" },
  { label: "Scrap Material", value: "SCRAP" },
  { label: "Rework Waste", value: "REWORK" },
  { label: "Machine Breakdown Stoppage", value: "MACHINE_BREAKDOWN" },
  { label: "Power Failure Stoppage", value: "POWER_FAILURE" },
  { label: "Mould Change Waste", value: "MOULD_CHANGE" },
  { label: "Color Change Waste", value: "COLOR_CHANGE" },
  { label: "Other Waste", value: "OTHER" },
];

const WastageForm: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const dispatch = useAppDispatch();
  const isEdit = Boolean(id);

  // Redux state
  const { data: productionOrders } = useAppSelector((state) => state.productionOrders);
  const { data: machines } = useAppSelector((state) => state.machines);
  const { products } = useAppSelector((state: any) => state.products || { products: [] });
  const { data: shifts } = useAppSelector((state) => state.shifts);
  const { data: rawMaterials } = useAppSelector((state) => state.rawMaterials);
  const { activeData: activeUOMs = [] } = useAppSelector((state: any) => state.uoms || {});

  // Form local state
  const [formData, setFormData] = useState({
    wastageDate: new Date().toISOString().split("T")[0],
    productionOrderId: "",
    hourlyProductionId: null as number | null,
    machineId: "",
    shiftId: "",
    productId: "",
    rawMaterialId: "",
    targetWastageProductId: "",
    wastageType: "SCRAP",
    quantity: "",
    uom: "KG",
    estimatedValue: "",
    reason: "",
    correctiveAction: "",
    remarks: "",
    isRecyclable: false,
    sentForRework: false,
    categoryId: "" as string | number,
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categoryOptions, setCategoryOptions] = useState<
    { label: string; value: string | number }[]
  >([]);

  useFormShortcuts({});

  useEffect(() => {
    dispatch(fetchProductionOrders());
    dispatch(fetchMachines());
    dispatch(fetchProducts(undefined));
    dispatch(fetchShifts());
    dispatch(fetchRawMaterials(undefined));
    dispatch(fetchActiveUOMs());
    categoryService
      .fetchAll({ type: "WASTAGE", isActive: true })
      .then((res) => {
        const list = res?.categories ?? res ?? [];
        setCategoryOptions([
          { label: "Select Category", value: "" },
          ...list.map((c: any) => ({ label: c.name, value: c.id })),
        ]);
      })
      .catch(() => {});
  }, [dispatch]);

  // Load existing log details if in edit mode
  useEffect(() => {
    if (isEdit && location.state) {
      const state = location.state;
      setFormData({
        wastageDate: new Date(state.wastageDate).toISOString().split("T")[0],
        productionOrderId: state.productionOrderId || "",
        hourlyProductionId: state.hourlyProductionId ? Number(state.hourlyProductionId) : null,
        machineId: state.machineId || "",
        shiftId: state.shiftId || "",
        productId: String(state.productId || ""),
        rawMaterialId: state.rawMaterialId || "",
        targetWastageProductId: state.targetWastageProductId || "",
        wastageType: state.wastageType || "SCRAP",
        quantity: String(state.quantity || ""),
        uom: state.uom || "PCS",
        estimatedValue: state.estimatedValue ? String(state.estimatedValue) : "",
        reason: state.reason || "",
        correctiveAction: state.correctiveAction || "",
        remarks: state.remarks || "",
        isRecyclable: Boolean(state.isRecyclable),
        sentForRework: Boolean(state.sentForRework),
        categoryId: state.categoryId ?? "",
      });
    }
  }, [isEdit, location.state]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  // Auto-populate shift, machine, and product when production order is selected
  useEffect(() => {
    if (formData.productionOrderId && !isEdit) {
      const selectedPO: any = productionOrders.find(
        (po: any) => po.productionOrderId === formData.productionOrderId
      );
      if (selectedPO) {
        setFormData((prev) => ({
          ...prev,
          productId: String(selectedPO.productItemId),
          uom: "KG",
          machineId: selectedPO.machineMachineId || selectedPO.machineId || prev.machineId,
          shiftId: selectedPO.shiftId ? String(selectedPO.shiftId) : prev.shiftId,
        }));
      }
    }
  }, [formData.productionOrderId, productionOrders, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (loading) return;

    const result = wastageSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) {
          fieldErrors[issue.path[0] as string] = issue.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    const payload = {
      ...formData,
      productId: Number(formData.productId),
      quantity: Number(formData.quantity),
      estimatedValue: formData.estimatedValue ? Number(formData.estimatedValue) : null,
      rawMaterialId: formData.rawMaterialId || null,
      reason: formData.reason || null,
      correctiveAction: formData.correctiveAction || null,
      remarks: formData.remarks || null,
      categoryId: formData.categoryId ? Number(formData.categoryId) : null,
      status: "APPROVED",
    };

    setLoading(true);
    try {
      if (isEdit) {
        await dispatch(updateProductionWastage({ id: id!, data: payload })).unwrap();
        toast.success("Production wastage log updated successfully");
      } else {
        await dispatch(createProductionWastage(payload)).unwrap();
        toast.success("Production wastage log logged successfully");
      }
      navigate("/production-wastages");
    } catch (err: any) {
      toast.error(err || "Failed to save wastage record");
    } finally {
      setLoading(false);
    }
  };

  const title = isEdit ? "Edit Wastage Audit Log" : "Log Production Wastage";

  return (
    <PageBody className="max-w-[1100px]">
      <PageHeader
        title={title}
        subtitle={
          isEdit
            ? "Update details for the selected wastage record"
            : "Record new production wastage"
        }
        back="/production-wastages"
        backLabel="Back to List"
        breadcrumbs={[
          { label: "Production Wastage", to: "/production-wastages" },
          { label: isEdit ? "Edit" : "New" },
        ]}
      />

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <Tile
          title="Where it happened"
          subtitle="Pick the production order; machine, shift and product fill in."
        >
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <TextInput
              label="Wastage Logging Date"
              name="wastageDate"
              type="date"
              value={formData.wastageDate}
              onChange={handleChange}
              required
              error={errors.wastageDate}
            />
            <SelectInput
              label="Production Order Reference"
              name="productionOrderId"
              value={formData.productionOrderId}
              options={[
                { label: "Select Production Order", value: "" },
                ...productionOrders.map((po) => ({
                  label: `${po.productionOrderId} - ${po.productItem?.productName || "Product"}`,
                  value: po.productionOrderId ? String(po.productionOrderId) : "",
                })),
              ]}
              onChange={handleChange}
              required
              searchable
              disabled={isEdit}
              error={errors.productionOrderId}
            />
            <SelectInput
              label="Machine Location"
              name="machineId"
              value={formData.machineId}
              options={[
                { label: "Select Machine", value: "" },
                ...machines.map((m) => ({
                  label: m.machineName,
                  value: m.machineId,
                })),
              ]}
              onChange={handleChange}
              required
              error={errors.machineId}
            />
            <SelectInput
              label="Shift Classification"
              name="shiftId"
              value={formData.shiftId}
              options={[
                { label: "Select Shift", value: "" },
                ...shifts.map((s) => ({
                  label: s.shiftName,
                  value: s.shiftCode,
                })),
              ]}
              onChange={handleChange}
              required
              error={errors.shiftId}
            />
            <SelectInput
              label="Product Item"
              name="productId"
              value={formData.productId}
              options={[
                { label: "Select Product", value: "" },
                ...products.map((p: any) => ({
                  label: p.productName,
                  value: String(p.id),
                })),
              ]}
              onChange={handleChange}
              required
              searchable
              disabled={isEdit}
              error={errors.productId}
            />
            <SelectInput
              label="Wastage Category"
              name="categoryId"
              value={formData.categoryId}
              options={categoryOptions}
              onChange={handleChange}
              searchable
            />
          </div>
        </Tile>

        <Tile title="What was wasted" subtitle="Tap the type, then enter how much.">
          <div role="radiogroup" aria-label="Wastage Type Classification" className="mb-5">
            <span className="sl-label">
              Wastage Type Classification
              <span className="sl-required" aria-hidden="true">
                *
              </span>
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {WASTAGE_TYPES.map((t) => {
                const selected = formData.wastageType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setFormData((prev) => ({ ...prev, wastageType: t.value }))}
                    className={cx(
                      "min-h-[52px] rounded-[14px] border px-3 py-2 text-left text-[14px] font-semibold transition-colors",
                      selected
                        ? "border-accent bg-nav-active text-nav-active-fg"
                        : "border-line bg-card text-ink hover:bg-card-2"
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {errors.wastageType && (
              <p role="alert" className="sl-field-error m-0">
                {errors.wastageType}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <div>
              <label htmlFor="wastage-quantity" className="sl-label">
                Wastage Quantity
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <QtyStepper
                id="wastage-quantity"
                name="quantity"
                label="Wastage Quantity"
                inputMode="decimal"
                value={formData.quantity}
                onChange={(v) => setFormData((prev) => ({ ...prev, quantity: v }))}
              />
              {errors.quantity && (
                <p role="alert" className="sl-field-error m-0">
                  {errors.quantity}
                </p>
              )}
            </div>
            <SelectInput
              label="UOM"
              name="uom"
              value={formData.uom}
              options={[
                { label: "Select UOM", value: "" },
                ...activeUOMs.map((uom: any) => ({
                  label: uom.uomCode,
                  value: uom.uomCode,
                })),
              ]}
              onChange={handleChange}
              required
              error={errors.uom}
            />
            <SelectInput
              label="Raw Material Component (Optional)"
              name="rawMaterialId"
              value={formData.rawMaterialId}
              options={[
                { label: "Select Raw Material if wasted", value: "" },
                ...rawMaterials
                  .filter((rm) => rm.itemType !== "WASTAGE")
                  .map((rm) => ({
                    label: rm.materialName,
                    value: rm.rawMaterialId,
                  })),
              ]}
              onChange={handleChange}
              error={errors.rawMaterialId}
            />
            <SelectInput
              label="Target Wastage Product (Optional)"
              name="targetWastageProductId"
              value={formData.targetWastageProductId}
              options={[
                { label: "Select Wastage Product to credit", value: "" },
                ...rawMaterials
                  .filter((rm) => rm.itemType === "WASTAGE")
                  .map((rm) => ({
                    label: rm.materialName,
                    value: rm.rawMaterialId,
                  })),
              ]}
              onChange={handleChange}
              error={errors.targetWastageProductId}
            />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { name: "isRecyclable", label: "This scrap is recyclable" },
              { name: "sentForRework", label: "This scrap has been sent for rework" },
            ].map((opt) => (
              <label
                key={opt.name}
                className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[14px] bg-card-2 px-4 py-3"
              >
                <input
                  type="checkbox"
                  name={opt.name}
                  checked={Boolean(formData[opt.name as "isRecyclable" | "sentForRework"])}
                  onChange={handleCheckboxChange}
                  className="sl-check h-5 w-5"
                />
                <span className="font-semibold text-ink">{opt.label}</span>
              </label>
            ))}
          </div>
        </Tile>

        <Tile title="Explanation & audit notes">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
            <TextInput
              as="textarea"
              rows={3}
              label="Reason for Wastage"
              name="reason"
              value={formData.reason}
              onChange={handleChange}
              placeholder="Breakdown, raw material defect, setup scrap…"
              error={errors.reason}
            />
            <TextInput
              as="textarea"
              rows={3}
              label="Corrective Action Taken"
              name="correctiveAction"
              value={formData.correctiveAction}
              onChange={handleChange}
              placeholder="What was done to stop it happening again…"
              error={errors.correctiveAction}
            />
            <TextInput
              as="textarea"
              rows={3}
              label="Remarks / General Audit Notes"
              name="remarks"
              value={formData.remarks}
              onChange={handleChange}
              placeholder="General auditing notes..."
              error={errors.remarks}
            />
          </div>
        </Tile>

        <StickyFormFooter hint="F2 saves">
          <ActionPill
            variant="secondary"
            onClick={() => navigate("/production-wastages")}
            disabled={loading}
          >
            Cancel
          </ActionPill>
          <ActionPill
            type="submit"
            size="lg"
            icon={<Save size={18} />}
            loading={loading}
            loadingText="Saving..."
          >
            {isEdit ? "Update Log" : "Submit Log"}
          </ActionPill>
        </StickyFormFooter>
      </form>
    </PageBody>
  );
};

export default WastageForm;
