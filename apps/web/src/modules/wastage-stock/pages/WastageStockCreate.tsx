import React, { useState } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import UOMSelect from "../../../components/form/SelectInput/UOMSelect";
import { Eraser, Save } from "lucide-react";
import { ActionPill, PageHeader, Tile } from "../../../components/ui/v2";
import FormFooter from "../../stock/lib/FormFooter";

const CATEGORY_OPTIONS = [
  { label: "Fabric Scraps", value: "Fabric Scraps" },
  { label: "Yarn Waste", value: "Yarn Waste" },
  { label: "Rejected Garments", value: "Rejected Garments" },
  { label: "Chemical Waste", value: "Chemical Waste" },
  { label: "Packaging Scrap", value: "Packaging Scrap" },
];

const DEPT_OPTIONS = [
  { label: "Cutting Department", value: "Cutting Department" },
  { label: "Stitching Department", value: "Stitching Department" },
  { label: "Dye House", value: "Dye House" },
  { label: "Knitting Department", value: "Knitting Department" },
  { label: "Finishing & Packing", value: "Finishing & Packing" },
];

const STATUS_OPTIONS = [
  { label: "Stored", value: "Stored" },
  { label: "Disposed", value: "Disposed" },
  { label: "Recycled", value: "Recycled" },
  { label: "Sold", value: "Sold" },
];

const initialFormState = {
  wastageCode: "",
  logDate: "",
  category: "",
  quantity: "",
  uom: "",
  department: "",
  cause: "",
  scrapUnitPrice: "",
  status: "Stored",
};

const WastageStockCreate: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(initialFormState);

  useFormShortcuts({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleClear = () => {
    setFormData(initialFormState);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Wastage Stock record created successfully!");
    navigate("/wastage-stock");
  };

  return (
    <div className="sl-page sl-page-form">
      <PageHeader
        title="Log Wastage Stock Entry"
        back="/wastage-stock"
        backLabel="Back to list"
        breadcrumbs={[
          { label: "Inventory" },
          { label: "Wastage stock", to: "/wastage-stock" },
          { label: "New" },
        ]}
      />

      <form onSubmit={handleSubmit} noValidate>
        <Tile title="Wastage entry">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <div>
              <TextInput
                label="Wastage Code / Log No"
                name="wastageCode"
                value={formData.wastageCode}
                placeholder="e.g. WST-2024-001"
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Log Date"
                name="logDate"
                value={formData.logDate}
                type="date"
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <SelectInput
                label="Material Type"
                name="category"
                value={formData.category}
                options={CATEGORY_OPTIONS}
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <UOMSelect
                label="UOM"
                name="uom"
                value={formData.uom}
                required
                onChange={(val) => handleChange({ target: { name: "uom", value: val } } as any)}
                category={["length", "mass", "each"]}
                allowedCodes={["kg", "g", "mt", "l", "ml", "m", "cm", "mm", "ea", "dz"]}
              />
            </div>
            <div>
              <TextInput
                label="Wastage Quantity"
                name="quantity"
                value={formData.quantity}
                type="number"
                step="0.01"
                placeholder="e.g. 25.5"
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <SelectInput
                label="Source Department"
                name="department"
                value={formData.department}
                options={DEPT_OPTIONS}
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Cause of Wastage"
                name="cause"
                value={formData.cause}
                placeholder="e.g. End-bit fabric scrap"
                required
                onChange={handleChange}
              />
            </div>
            <div>
              <TextInput
                label="Scrap Price per Unit (₹)"
                name="scrapUnitPrice"
                value={formData.scrapUnitPrice}
                type="number"
                step="0.01"
                placeholder="e.g. 15.00"
                onChange={handleChange}
              />
            </div>
            <div>
              <SelectInput
                label="Wastage Disposal Status"
                name="status"
                value={formData.status}
                options={STATUS_OPTIONS}
                required
                onChange={handleChange}
              />
            </div>
          </div>
        </Tile>

        <FormFooter hint="F2 saves">
          <ActionPill variant="secondary" onClick={() => navigate("/wastage-stock")}>
            Cancel
          </ActionPill>
          <ActionPill variant="secondary" icon={<Eraser size={16} />} onClick={handleClear}>
            Clear
          </ActionPill>
          <ActionPill type="submit" icon={<Save size={17} />}>
            Save Wastage Log
          </ActionPill>
        </FormFooter>
      </form>
    </div>
  );
};

export default WastageStockCreate;
