import React, { useState, useEffect } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { z } from "zod";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import { useDispatch } from "react-redux";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { createCategory, updateCategory } from "../../../features/categories/categorySlice";
import { categoryService } from "../../../services/categoryService";
import type { AppDispatch } from "../../../app/store";
import type { CategoryType } from "../../../features/categories/types";
import { Eraser, Save } from "lucide-react";
import { ActionPill, PageHeader, SkeletonTile, Tile } from "../../../components/ui/v2";
import FormFooter from "../../stock/lib/FormFooter";

const categorySchema = z.object({
  type: z.enum(["PRODUCT", "RAW_MATERIAL", "WASTAGE"], {
    message: "Category type is required",
  }),
  name: z
    .string()
    .min(1, "Category name is required")
    .max(100, "Name cannot exceed 100 characters"),
  description: z.string().max(255, "Description cannot exceed 255 characters").optional(),
});

type CategorySchema = z.infer<typeof categorySchema>;

const TYPE_OPTIONS = [
  { label: "Product Category", value: "PRODUCT" },
  { label: "Raw Material Category", value: "RAW_MATERIAL" },
  { label: "Wastage Category", value: "WASTAGE" },
];

const STATUS_OPTIONS = [
  { label: "Active", value: "true" },
  { label: "Inactive", value: "false" },
];

interface FormData {
  code: string;
  name: string;
  description: string;
  type: CategoryType | "";
  isActive: boolean;
}

type FormErrors = Partial<Record<keyof CategorySchema, string>>;

const initialFormState: FormData = {
  code: "",
  name: "",
  description: "",
  type: "",
  isActive: true,
};

const CategoryForm: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: idParam } = useParams<{ id: string }>();
  const dispatch = useDispatch<AppDispatch>();

  const isEditMode = Boolean(idParam);

  const [formData, setFormData] = useState<FormData>(initialFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingCode, setIsFetchingCode] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);

  useFormShortcuts({});

  // ── Load existing data in edit mode ────────────────────────────────────────
  useEffect(() => {
    if (!isEditMode) return;

    const stateData = location.state as any;

    if (stateData && stateData.id) {
      setFormData({
        code: stateData.code ?? "",
        name: stateData.name ?? "",
        description: stateData.description ?? "",
        type: stateData.type ?? "",
        isActive: stateData.isActive ?? true,
      });
    } else {
      setIsFetchingData(true);
      categoryService
        .fetchById(Number(idParam))
        .then((data) => {
          setFormData({
            code: data.code ?? "",
            name: data.name ?? "",
            description: data.description ?? "",
            type: data.type ?? "",
            isActive: data.isActive ?? true,
          });
        })
        .catch(() => {
          toast.error("Failed to load category data");
          navigate("/categories");
        })
        .finally(() => setIsFetchingData(false));
    }
  }, [isEditMode, idParam, location.state, navigate]);

  // ── Auto-generate code in create mode when type changes ───────────────────
  useEffect(() => {
    if (isEditMode || !formData.type) return;

    setIsFetchingCode(true);
    categoryService
      .fetchNextCode(formData.type)
      .then((nextCode) => {
        if (nextCode) setFormData((prev) => ({ ...prev, code: nextCode }));
      })

      .catch(() => {})
      .finally(() => setIsFetchingCode(false));
  }, [formData.type, isEditMode]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === "isActive") {
      setFormData((prev) => ({ ...prev, isActive: value === "true" }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
      if (errors[name as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [name]: undefined }));
      }
    }
  };

  const handleClear = () => {
    setFormData({ ...initialFormState, code: formData.code, type: formData.type });
    setErrors({});
  };

  const validate = (): boolean => {
    const result = categorySchema.safeParse({
      type: formData.type || undefined,
      name: formData.name,
      description: formData.description || undefined,
    });

    if (!result.success) {
      const newErrors: FormErrors = {};
      result.error.issues.forEach((err) => {
        const field = err.path[0] as keyof CategorySchema;
        if (!newErrors[field]) newErrors[field] = err.message;
      });
      setErrors(newErrors);
      return false;
    }

    setErrors({});
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      if (isEditMode) {
        await dispatch(
          updateCategory({
            id: Number(idParam),
            data: {
              name: formData.name.trim(),
              description: formData.description.trim() || null,
              type: formData.type as CategoryType,
              isActive: formData.isActive,
            },
          })
        ).unwrap();
        toast.success("Category updated successfully!");
      } else {
        await dispatch(
          createCategory({
            code: formData.code,
            name: formData.name.trim(),
            description: formData.description.trim() || null,
            type: formData.type as CategoryType,
            isActive: formData.isActive,
          })
        ).unwrap();
        toast.success("Category created successfully!");
      }
      navigate("/categories");
    } catch (err: any) {
      toast.error(err || "Failed to save category");
    } finally {
      setIsSubmitting(false);
    }
  };

  const header = (
    <PageHeader
      title={isEditMode ? "Edit category" : "New category"}
      subtitle="Categories group products, raw materials and wastage items"
      back="/categories"
      backLabel="Back to categories"
      breadcrumbs={[
        { label: "Inventory" },
        { label: "Categories", to: "/categories" },
        { label: isEditMode ? "Edit" : "New" },
      ]}
    />
  );

  if (isFetchingData) {
    return (
      <div className="w-full min-w-0">
        {header}
        <SkeletonTile lines={4} />
      </div>
    );
  }

  return (
    <div className="sl-page sl-page-form">
      {header}

      <form onSubmit={handleSubmit} noValidate>
        <Tile title="Category" subtitle="Pick the type first; the code is generated from it">
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-2">
            {/* Type — pick first so code auto-generates */}
            <SelectInput
              label="Category Type"
              name="type"
              value={formData.type}
              defaultOptionLabel="Select Category Type"
              options={TYPE_OPTIONS}
              required
              onChange={handleSelectChange}
              error={errors.type}
              disabled={isEditMode}
            />

            {/* Code — auto-generated, read-only */}
            <TextInput
              label="Category Code"
              name="code"
              value={isFetchingCode ? "Generating..." : formData.code}
              placeholder="Auto-generated"
              required
              onChange={() => {}}
              disabled
            />

            <TextInput
              label="Category Name"
              name="name"
              value={formData.name}
              placeholder="e.g. Plastics, Containers..."
              required
              onChange={handleChange}
              error={errors.name}
            />

            <SelectInput
              label="Active Status"
              name="isActive"
              value={formData.isActive ? "true" : "false"}
              defaultOptionLabel="Select Status"
              options={STATUS_OPTIONS}
              onChange={handleSelectChange}
            />

            <div className="md:col-span-2">
              <TextInput
                label="Description"
                name="description"
                value={formData.description}
                placeholder="Short description of this category (optional)"
                onChange={handleChange}
                error={errors.description}
                as="textarea"
                rows={3}
              />
            </div>
          </div>
        </Tile>

        <FormFooter hint="F2 saves">
          <ActionPill variant="secondary" onClick={() => navigate("/categories")}>
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
            {isEditMode ? "Update Category" : "Save Category"}
          </ActionPill>
        </FormFooter>
      </form>
    </div>
  );
};

export default CategoryForm;
