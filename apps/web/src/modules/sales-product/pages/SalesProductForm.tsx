import React, { useState, useEffect, useMemo, useCallback } from "react";
import { hasGreyedComponents } from "../componentPicker";
import { Link, useNavigate, useLocation, useParams } from "react-router-dom";
import { Boxes, Eraser, Package, Plus, Save } from "lucide-react";
import { ActionPill, PageHeader, Tile } from "../../../components/ui/v2";
import { FormFooter } from "../../sales/shared/tradeUi";
import { toast } from "react-toastify";
import { useForm, useFieldArray, useWatch } from "react-hook-form";

import TextInput from "../../../components/form/TextInput/TextInput";
import OrderItemsTable from "../../../components/form/OrderItemsTable/OrderItemsTable";

import { salesProductService } from "../../../services/salesProductService";
import { productService } from "../../../services/productService";
import { usePermission } from "../../../hooks/usePermission";
import { useSocketSync } from "../../../hooks/useSocketSync";

type ComponentItem = { productCode: string; quantity: string };

const productLabel = (p: any) => {
  const typeLabel = p.productType === "SALES_PRODUCTION" ? "Sales Production" : "Production";
  return `${p.productName}`;
};

const initialFormState = {
  salesProductName: "",
};

const SalesProductForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = usePermission();

  const canSave = isEditMode ? can("sales_products.edit") : can("sales_products.create");

  const [formData, setFormData] = useState(initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [products, setProducts] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const {
    control,
    getValues,
    setValue,
    setError,
    clearErrors,
    formState: { errors: itemErrors },
  } = useForm<{ items: ComponentItem[] }>({ defaultValues: { items: [] } });
  const { fields, append, remove, replace } = useFieldArray({ control, name: "items" });
  const currentItems = useWatch({ control, name: "items" }) || [];

  const loadProducts = useCallback(() => {
    productService
      .fetchAll()
      .then(setProducts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Keep products dropdown fresh when a product is added/updated in another tab
  useSocketSync("product", undefined, loadProducts);

  const populateForm = useCallback(
    (sp: any) => {
      setFormData({
        salesProductName: sp.salesProductName || "",
      });
      replace(
        (sp.components || []).map((it: any) => ({
          productCode: String(it.componentProductId),
          quantity: it.quantity != null ? String(it.quantity) : "",
        }))
      );
    },
    [replace]
  );

  useEffect(() => {
    if (isEditMode && id) {
      const stateData = location.state as any;
      if (stateData && String(stateData.id) === String(id)) {
        populateForm(stateData);
      } else {
        setIsLoadingData(true);
        salesProductService
          .fetchById(id)
          .then(populateForm)
          .catch(() => {
            toast.error("Failed to load Sales Product");
            navigate("/sales-products");
          })
          .finally(() => setIsLoadingData(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleAddItem = () => append({ productCode: "", quantity: "" });

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    clearErrors();

    if (!formData.salesProductName.trim())
      newErrors.salesProductName = "Sales Product Name is required.";
    const items = getValues("items");
    if (items.length === 0) {
      newErrors.items = "At least one component product is required.";
    } else {
      const ids = items.map((it) => it.productCode).filter(Boolean);
      if (new Set(ids).size !== ids.length) {
        newErrors.items = "Duplicate component products are not allowed.";
      }
      items.forEach((it, index) => {
        if (!it.productCode)
          setError(`items.${index}.productCode`, { type: "manual", message: "Required" });
        if (!it.quantity || Number(it.quantity) <= 0)
          setError(`items.${index}.quantity`, { type: "manual", message: "Must be > 0" });
      });
    }

    setErrors(newErrors);
    if (
      Object.keys(newErrors).length > 0 ||
      items.some((it) => !it.productCode || !it.quantity || Number(it.quantity) <= 0)
    ) {
      toast.error(
        newErrors.items || newErrors.salesProductName || "Please fix the highlighted fields."
      );
      return false;
    }
    return true;
  };

  const handleClear = () => {
    setFormData(initialFormState);
    replace([]);
    setErrors({});
    clearErrors();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!canSave) {
      toast.error("You do not have permission to perform this action.");
      return;
    }
    if (!validate()) return;

    const payload: any = {
      salesProductName: formData.salesProductName,
      components: getValues("items").map((it) => ({
        componentProductId: Number(it.productCode),
        quantity: Number(it.quantity),
      })),
    };

    setIsSubmitting(true);
    try {
      if (isEditMode && id) {
        await salesProductService.update(id, payload);
        toast.success("Sales Product updated successfully!");
      } else {
        await salesProductService.create(payload);
        toast.success("Sales Product created successfully!");
      }
      navigate("/sales-products");
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message ||
          (isEditMode ? "Failed to update Sales Product" : "Failed to create Sales Product")
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Every active product is listed; production-only items are disabled with the reason instead
  // of vanishing, so the picker never looks empty for no visible cause (QA F1).
  const componentProductOptions = useMemo(() => {
    return products
      .filter((p: any) => p.isActive !== false)
      .map((p: any) => {
        const sellable = p.productType === "SALES_PRODUCTION";
        return {
          value: String(p.id),
          label: sellable
            ? productLabel(p)
            : `${productLabel(p)} (Production only: set Product Type to Sales Production to use it)`,
          disabled:
            !sellable || currentItems.some((it: any) => String(it.productCode) === String(p.id)),
        };
      });
  }, [products, currentItems]);

  const noEligibleComponents =
    products.length > 0 && !products.some((p: any) => p.productType === "SALES_PRODUCTION");
  // H40: production items are listed but greyed out; say why at the picker, not only in a label.
  const showGreyedNote = hasGreyedComponents(products);

  if (isLoadingData) {
    return (
      <div className="flex justify-center items-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="sl-page sl-page-form">
      <PageHeader
        title={isEditMode ? "Edit sales product" : "New sales product"}
        subtitle="A sellable kit and the production items it is assembled from."
        back="/sales-products"
        backLabel="Back to List"
        breadcrumbs={[
          { label: "Sales products", to: "/sales-products" },
          { label: isEditMode ? "Edit" : "New" },
        ]}
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Tile title="Basic Information" icon={<Package size={18} />}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextInput
              label="Sales Product Name"
              name="salesProductName"
              value={formData.salesProductName}
              placeholder="e.g. 3L Container"
              required
              onChange={handleChange}
              error={errors.salesProductName}
              disabled={!canSave}
            />
          </div>
        </Tile>

        <Tile
          title="Component Products"
          subtitle="Required. Quantities are per one unit of the sales product."
          icon={<Boxes size={18} />}
          actions={
            canSave ? (
              <ActionPill
                size="sm"
                variant="secondary"
                icon={<Plus size={15} />}
                onClick={handleAddItem}
              >
                Add Component
              </ActionPill>
            ) : null
          }
        >
          {noEligibleComponents && (
            <p role="status" className="m-0 mb-3 text-sm text-ink-subtle">
              No product has the type Sales Production yet, so there is nothing to pick.{" "}
              <Link to="/products" className="font-semibold text-accent hover:underline">
                Open products
              </Link>{" "}
              and change the type of the item you sell.
            </p>
          )}
          {showGreyedNote && !noEligibleComponents && (
            <p className="m-0 mb-3 text-sm text-ink-subtle">
              Greyed-out items are Production products. A kit can only use items whose Product Type
              is Sales Production, so change that type on the product to add it here.
            </p>
          )}
          {fields.length > 0 ? (
            <OrderItemsTable
              control={control}
              fields={fields}
              errors={itemErrors}
              productOptions={componentProductOptions}
              remove={remove}
              editable={canSave}
            />
          ) : (
            <div
              className={`rounded-[14px] border border-dashed p-5 text-center text-sm ${errors.items ? "border-[color:var(--color-danger)] font-medium text-[color:var(--color-danger)]" : "border-line text-ink-subtle"}`}
            >
              No components added. Click "Add Component" to specify what this sales product is
              assembled from.
            </div>
          )}
          {errors.items && fields.length > 0 && (
            <p className="sl-field-error m-0 mt-2">{errors.items}</p>
          )}
        </Tile>

        <FormFooter>
          <ActionPill variant="secondary" onClick={() => navigate("/sales-products")}>
            Cancel
          </ActionPill>
          {!isEditMode && canSave && (
            <ActionPill
              variant="secondary"
              icon={<Eraser size={16} />}
              onClick={handleClear}
              disabled={isSubmitting}
            >
              Clear
            </ActionPill>
          )}
          {canSave && (
            <ActionPill
              type="submit"
              icon={<Save size={17} />}
              loading={isSubmitting}
              loadingText="Saving..."
            >
              {isEditMode ? "Save Changes" : "Save Sales Product"}
            </ActionPill>
          )}
        </FormFooter>
      </form>
    </div>
  );
};

export default SalesProductForm;
