import React, { useState, useEffect } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { Save } from "lucide-react";
import { ActionPill, PageHeader, Tile } from "../../../components/ui/v2";
import FormFooter from "../../stock/lib/FormFooter";

const CATEGORY_OPTIONS = [
  { label: "T-Shirt", value: "T-Shirt" },
  { label: "Shirt", value: "Shirt" },
  { label: "Trouser", value: "Trouser" },
  { label: "Jacket", value: "Jacket" },
  { label: "Shorts", value: "Shorts" },
  { label: "Accessories", value: "Accessories" },
];

const SIZE_OPTIONS = [
  { label: "XS", value: "XS" },
  { label: "S", value: "S" },
  { label: "M", value: "M" },
  { label: "L", value: "L" },
  { label: "XL", value: "XL" },
  { label: "XXL", value: "XXL" },
  { label: "Free Size", value: "Free Size" },
];

const initialFormState = {
  id: 0,
  productCode: "",
  productName: "",
  category: "",
  size: "",
  color: "",
  quantity: "",
  batchNo: "",
  storeName: "",
  manufactureDate: "",
  unitPrice: "",
};

const FinishedStockEdit: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [formData, setFormData] = useState(initialFormState);

  useFormShortcuts({});

  useEffect(() => {
    if (location.state) {
      setFormData(location.state);
    } else {
      toast.error("No finished stock data provided.");
      navigate("/finished-stock");
    }
  }, [location.state, navigate]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Finished stock updated successfully!");
    navigate("/finished-stock");
  };

  return (
    <div className="sl-page sl-page-form">
      <PageHeader
        title="Edit Finished Stock"
        back="/finished-stock"
        backLabel="Back to list"
        breadcrumbs={[
          { label: "Inventory" },
          { label: "Finished goods stock", to: "/finished-stock" },
          { label: "Edit" },
        ]}
      />

      <form onSubmit={handleSubmit} noValidate>
        <Tile title="Stock details">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <div>
              <TextInput
                label="Product Code"
                name="productCode"
                value={formData.productCode}
                placeholder="e.g. FP-001"
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Product Name"
                name="productName"
                value={formData.productName}
                placeholder="e.g. Men's Polo T-Shirt"
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <SelectInput
                label="Category"
                name="category"
                value={formData.category}
                options={CATEGORY_OPTIONS}
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <SelectInput
                label="Size"
                name="size"
                value={formData.size}
                options={SIZE_OPTIONS}
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Color"
                name="color"
                value={formData.color}
                placeholder="e.g. Navy Blue"
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Quantity"
                name="quantity"
                value={formData.quantity}
                type="number"
                placeholder="e.g. 250"
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Batch No"
                name="batchNo"
                value={formData.batchNo}
                placeholder="e.g. BATCH-2024-001"
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Store Location"
                name="storeName"
                value={formData.storeName}
                placeholder="e.g. Finished Goods Store"
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Manufacture Date"
                name="manufactureDate"
                value={formData.manufactureDate}
                type="date"
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Unit Price (₹)"
                name="unitPrice"
                value={formData.unitPrice}
                type="number"
                step="0.01"
                placeholder="e.g. 599.00"
                onChange={handleChange}
              />
            </div>
          </div>
        </Tile>

        <FormFooter hint="F2 saves">
          <ActionPill variant="secondary" onClick={() => navigate("/finished-stock")}>
            Cancel
          </ActionPill>
          <ActionPill type="submit" icon={<Save size={17} />}>
            Update Stock
          </ActionPill>
        </FormFooter>
      </form>
    </div>
  );
};

export default FinishedStockEdit;
