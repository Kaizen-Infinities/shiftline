import React, { useState, useEffect } from "react";
import { useFormShortcuts } from "../../hooks/useFormShortcuts";
import { Eraser, Save } from "lucide-react";
import { ActionPill, PageHeader } from "../../components/ui/v2";
import { toast } from "react-toastify";
import TextInput from "../../components/form/TextInput/TextInput";
import SelectInput from "../../components/form/SelectInput/SelectInput";
import DateInput from "../../components/form/DateInput/DateInput";
import FileUpload from "../../components/form/FileUpload/FileUpload";
import TextArea from "../../components/form/TextArea/TextArea";
import apiClient from "../../api/apiClient";
import { useExpenses } from "../../hooks/useExpenses";
import { gstService, type GstSlab } from "../../services/gstService";

interface ExpenseFormData {
  expenseNumber: string;
  expenseCategory: string;
  date: string;
  expense: string;
  amount: string;
  description: string;
  supplier: string;
  paymentMethod: string;
  status: string;
  notes: string;
  receiptInvoice: string;
  vendorGstin: string;
  gstRate: string;
  reverseCharge: boolean;
  itcEligible: boolean;
}

interface TdsPreview {
  rate: number;
  reason: string;
  base: number;
  belowThreshold: boolean;
}

interface ExpensesCreateProps {
  onSaveComplete: () => void;
  onCancel: () => void;
  initialData?: any;
}

const ExpensesCreate: React.FC<ExpensesCreateProps> = ({
  onSaveComplete,
  onCancel,
  initialData,
}) => {
  const isEdit = !!initialData;
  const { addExpense, editExpense, fetchNextExpenseCode } = useExpenses();

  const defaultFormData: ExpenseFormData = {
    expenseNumber: "",
    expenseCategory: "",
    date: new Date().toISOString(),
    expense: "",
    amount: "",
    description: "",
    supplier: "",
    paymentMethod: "",
    status: "Draft",
    notes: "",
    receiptInvoice: "",
    vendorGstin: "",
    gstRate: "",
    reverseCharge: false,
    itcEligible: true,
  };

  const [formData, setFormData] = useState<ExpenseFormData>(defaultFormData);
  const [suppliers, setSuppliers] = useState<
    Array<{ label: string; value: string; id: number; gstin?: string | null }>
  >([]);
  const [gstSlabs, setGstSlabs] = useState<GstSlab[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // P2-12: TDS on the bill (P2-05 accepts these fields; the form did not offer them yet).
  const [deductTds, setDeductTds] = useState(false);
  const [tdsSection, setTdsSection] = useState("");
  const [tdsSections, setTdsSections] = useState<Array<{ code: string; name: string }>>([]);
  const [tdsPreview, setTdsPreview] = useState<TdsPreview | null>(null);
  const [tdsLoading, setTdsLoading] = useState(false);
  const [existingTdsAmount, setExistingTdsAmount] = useState<number | null>(null);

  useFormShortcuts({});

  // Fetch suppliers list on mount
  useEffect(() => {
    const fetchSuppliers = async () => {
      try {
        const response = await apiClient.get("/suppliers?limit=100");
        const rawData = response.data?.data;
        const list = Array.isArray(rawData)
          ? rawData
          : Array.isArray(rawData?.suppliers)
            ? rawData.suppliers
            : [];
        if (list.length > 0) {
          const formatted = list.map((sup: any) => ({
            label: `${sup.supplierCode ? sup.supplierCode + " - " : ""}${sup.legalName || "Supplier"}`,
            value: sup.legalName || sup.supplierCode,
            id: sup.id,
            gstin: sup.gstin ?? null,
          }));
          setSuppliers(formatted);
        }
      } catch (error) {
        console.error("Error fetching suppliers:", error);
      }
    };
    fetchSuppliers();
  }, []);

  // GST slabs for the GST block (GST-1: the bill is split by vendor and branch state).
  useEffect(() => {
    gstService
      .listRates()
      .then(setGstSlabs)
      .catch(() => {});
  }, []);

  // P2-12: TDS sections (deduction ones only; TCS sections belong on the sales side).
  useEffect(() => {
    const fetchTdsSections = async () => {
      try {
        const response = await apiClient.get("/tds/sections");
        const list = Array.isArray(response.data?.data) ? response.data.data : [];
        setTdsSections(
          list.filter((s: any) => !s.isTcs).map((s: any) => ({ code: s.code, name: s.name }))
        );
      } catch (error) {
        console.error("Error fetching TDS sections:", error);
      }
    };
    fetchTdsSections();
  }, []);

  // Fetch next expense code if not editing
  useEffect(() => {
    if (!isEdit) {
      const getNextCode = async () => {
        const nextCode = await fetchNextExpenseCode();
        if (nextCode) {
          setFormData((prev) => ({ ...prev, expenseNumber: nextCode }));
        }
      };
      getNextCode();
    }
  }, [isEdit, fetchNextExpenseCode]);

  // Populate initialData if editing
  useEffect(() => {
    if (initialData) {
      setFormData({
        expenseNumber: initialData.expenseNumber || "",
        expenseCategory: initialData.expenseCategory || "",
        date: initialData.date ? initialData.date.split("T")[0] : "",
        expense: initialData.expense || "",
        amount: initialData.amount ? String(initialData.amount) : "",
        description: initialData.description || "",
        supplier: initialData.supplier?.legalName || initialData.supplier || "",
        paymentMethod: initialData.paymentMethod || "",
        status: initialData.status || "Draft",
        notes: initialData.notes || "",
        receiptInvoice: initialData.receiptInvoice || "",
        vendorGstin: initialData.vendorGstin || "",
        gstRate:
          initialData.gstRate !== null && initialData.gstRate !== undefined
            ? String(Number(initialData.gstRate))
            : "",
        reverseCharge: Boolean(initialData.reverseCharge),
        itcEligible: initialData.itcEligible ?? true,
      });
      if (initialData.tdsSection) {
        setTdsSection(initialData.tdsSection);
        setDeductTds(Number(initialData.tdsAmount) > 0);
        setExistingTdsAmount(Number(initialData.tdsAmount) || 0);
      }
    }
  }, [initialData]);

  // P2-12: a live preview (rate, amount, net) whenever the section, amount or supplier changes.
  // Editing an already-deducted expense keeps its own figures instead of re-previewing them.
  useEffect(() => {
    if (isEdit && existingTdsAmount !== null) return;
    if (!tdsSection || !formData.amount || Number(formData.amount) <= 0) {
      setTdsPreview(null);
      return;
    }
    const matchedSupplier = suppliers.find((s) => s.value === formData.supplier);
    let cancelled = false;
    setTdsLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.post("/tds/preview", {
          sectionCode: tdsSection,
          supplierId: matchedSupplier?.id ?? null,
          amount: Number(formData.amount),
          on: formData.date || undefined,
        });
        if (!cancelled) setTdsPreview(res.data?.data ?? null);
      } catch (error) {
        if (!cancelled) setTdsPreview(null);
      } finally {
        if (!cancelled) setTdsLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    tdsSection,
    formData.amount,
    formData.supplier,
    formData.date,
    suppliers,
    isEdit,
    existingTdsAmount,
  ]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    // The vendor's GSTIN comes from the supplier record when one is picked.
    const pickedSupplierGstin =
      name === "supplier" ? suppliers.find((s) => s.value === value)?.gstin : undefined;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(pickedSupplierGstin ? { vendorGstin: pickedSupplierGstin } : {}),
    }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  // GST shown for the bill: forward charge carves it out of the amount, reverse charge bills none.
  const billAmount = Number(formData.amount) || 0;
  const gstPercent = Number(formData.gstRate) || 0;
  const taxableValue = formData.reverseCharge
    ? billAmount
    : gstPercent > 0
      ? Math.round((billAmount / (1 + gstPercent / 100)) * 100) / 100
      : billAmount;
  const gstValue = Math.round(((taxableValue * gstPercent) / 100) * 100) / 100;
  const gstRateOptions = gstSlabs.map((g) => ({
    label: `${Number(g.rate)}%`,
    value: String(Number(g.rate)),
  }));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setFormData((prev) => ({ ...prev, receiptInvoice: files[0].name }));
      if (errors.receiptInvoice) {
        setErrors((prev) => ({ ...prev, receiptInvoice: "" }));
      }
    }
  };

  const handleClear = () => {
    setFormData(defaultFormData);
    setErrors({});
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.expenseNumber.trim()) {
      newErrors.expenseNumber = "Expense Number is required";
    }
    if (!formData.expenseCategory.trim()) {
      newErrors.expenseCategory = "Expense Category is required";
    }
    if (!formData.date.trim()) {
      newErrors.date = "Date is required";
    }
    if (!formData.expense.trim()) {
      newErrors.expense = "Expense Name is required";
    }
    if (!formData.amount.trim() || Number(formData.amount) <= 0) {
      newErrors.amount = "Amount must be greater than 0";
    }
    if (!formData.paymentMethod.trim()) {
      newErrors.paymentMethod = "Payment Method is required";
    }
    if (deductTds && !tdsSection) {
      newErrors.tdsSection = "Pick a TDS section, or turn off Deduct TDS";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      toast.warn("Please fill in all required fields correctly.");
      return;
    }

    setSaving(true);
    try {
      // Find supplierId
      const matchedSupplier = suppliers.find((s) => s.value === formData.supplier);
      const supplierId = matchedSupplier ? matchedSupplier.id : null;

      const payload = {
        vendorGstin: formData.vendorGstin.trim().toUpperCase() || null,
        gstRate: Number(formData.gstRate) || 0,
        reverseCharge: formData.reverseCharge,
        itcEligible: formData.itcEligible,
        expenseNumber: formData.expenseNumber.trim(),
        expenseCategory: formData.expenseCategory.trim(),
        date: formData.date,
        expense: formData.expense.trim(),
        amount: parseFloat(formData.amount),
        description: formData.description?.trim() || null,
        paymentMethod: formData.paymentMethod.trim(),
        status: formData.status || "Approved",
        notes: formData.notes?.trim() || null,
        receiptInvoice: formData.receiptInvoice?.trim() || null,
        supplierId: supplierId,
        // P2-12: naming a section always sends a preview back; deductTds accepts it.
        tdsSection: tdsSection || null,
        deductTds: Boolean(tdsSection) && deductTds,
      };

      if (isEdit) {
        await editExpense(initialData.id, payload);
        toast.success("Expense updated successfully!");
      } else {
        await addExpense(payload);
        toast.success("Expense created successfully!");
      }
      onSaveComplete();
    } catch (error: any) {
      console.error("[Expense Save Error] Details:", error);
      toast.error(error.message || "Failed to save expense.");
    } finally {
      setSaving(false);
    }
  };

  const categories = [
    { label: "Office Supplies", value: "Office Supplies" },
    { label: "Travel & Lodging", value: "Travel & Lodging" },
    { label: "Software & Hosting", value: "Software & Hosting" },
    { label: "Utilities (Electricity, Water)", value: "Utilities" },
    { label: "Salaries & Benefits", value: "Salaries" },
    { label: "Rent & Facilities", value: "Rent" },
    { label: "Marketing & Advertising", value: "Marketing" },
    { label: "Others", value: "Others" },
  ];

  const paymentMethods = [
    { label: "Cash", value: "Cash" },
    { label: "GPay", value: "GPay" },
    { label: "PhonePe", value: "PhonePe" },
    { label: "Bank Transfer", value: "Bank Transfer" },
    { label: "Credit Card", value: "Credit Card" },
    { label: "Debit Card", value: "Debit Card" },
  ];

  const statuses = [
    { label: "Draft", value: "Draft" },
    { label: "Pending Approval", value: "Pending" },
    { label: "Approved", value: "Approved" },
    { label: "Rejected", value: "Rejected" },
  ];

  return (
    <div className="w-full">
      <PageHeader
        back={onCancel}
        backLabel="Back to list"
        breadcrumbs={[
          { label: "Expenses & claims", to: "/expenses" },
          { label: isEdit ? "Edit" : "New" },
        ]}
        title={isEdit ? `Edit expense: ${formData.expenseNumber}` : "New expense"}
        subtitle="Posted to the expense ledger; TDS is worked out from the section you pick"
      />
      <div className="w-full">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Expense Info */}
          <div className="sl-tile p-5 sm:p-6">
            <h2 className="sl-h2 m-0 mb-4">Expense Info</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <TextInput
                label="Expense Number"
                name="expenseNumber"
                value={formData.expenseNumber}
                placeholder="e.g. EXP-001"
                required
                disabled={isEdit || saving}
                onChange={handleChange}
                error={errors.expenseNumber}
              />

              <SelectInput
                label="Expense Category"
                name="expenseCategory"
                value={formData.expenseCategory}
                options={categories}
                defaultOptionLabel="Select Category"
                required
                disabled={saving}
                onChange={handleChange}
                error={errors.expenseCategory}
              />

              <div>
                <DateInput
                  label="Expense Date"
                  name="date"
                  value={formData.date}
                  required
                  disabled={saving}
                  onChange={handleChange}
                />
                {errors.date && (
                  <span className="text-[color:var(--color-danger)] text-sm mt-1 block">
                    {errors.date}
                  </span>
                )}
              </div>

              <TextInput
                label="Expense Name"
                name="expense"
                value={formData.expense}
                placeholder="e.g. Server hosting fees"
                required
                disabled={saving}
                onChange={handleChange}
                error={errors.expense}
              />

              <TextInput
                label="Amount (₹)"
                name="amount"
                type="number"
                value={formData.amount}
                placeholder="e.g. 5000"
                required
                disabled={saving}
                onChange={handleChange}
                error={errors.amount}
              />

              <SelectInput
                label="Supplier (Optional)"
                name="supplier"
                value={formData.supplier}
                options={
                  suppliers.length > 0 ? suppliers : [{ label: "No suppliers loaded", value: "" }]
                }
                defaultOptionLabel="Select Supplier"
                disabled={saving}
                onChange={handleChange}
                error={errors.supplier}
              />
            </div>
          </div>

          {/* Payment & Processing */}
          <div className="sl-tile p-5 sm:p-6">
            <h2 className="sl-h2 m-0 mb-4">Payment & Processing</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <SelectInput
                label="Payment Method"
                name="paymentMethod"
                value={formData.paymentMethod}
                options={paymentMethods}
                defaultOptionLabel="Select Payment Method"
                required
                disabled={saving}
                onChange={handleChange}
                error={errors.paymentMethod}
              />

              <FileUpload
                label={
                  formData.receiptInvoice
                    ? `Receipt: ${formData.receiptInvoice}`
                    : "Upload Receipt/Invoice"
                }
                name="receiptInvoice"
                onChange={handleFileChange}
              />
            </div>
          </div>

          {/* GST on the bill (GST-1): without it input credit was lost on every expense */}
          <div className="sl-tile p-5 sm:p-6">
            <h2 className="sl-h2 m-0 mb-4">GST</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
              <TextInput
                label="Vendor GSTIN"
                name="vendorGstin"
                value={formData.vendorGstin}
                placeholder="Filled from the supplier"
                disabled={saving}
                onChange={handleChange}
                error={errors.vendorGstin}
              />
              <SelectInput
                label="GST Rate"
                name="gstRate"
                value={formData.gstRate}
                options={gstRateOptions}
                defaultOptionLabel="No GST"
                disabled={saving}
                onChange={handleChange}
              />
              <div className="flex flex-col gap-2 pb-2">
                <label className="flex items-center gap-2 text-sm font-medium text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    name="reverseCharge"
                    checked={formData.reverseCharge}
                    disabled={saving}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, reverseCharge: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[color:var(--color-primary)]"
                  />
                  Reverse charge (vendor bills without GST)
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    name="itcEligible"
                    checked={formData.itcEligible}
                    disabled={saving || gstPercent === 0}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, itcEligible: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[color:var(--color-primary)]"
                  />
                  Claim input tax credit
                </label>
              </div>
            </div>
            {gstPercent > 0 || formData.reverseCharge ? (
              <p className="sl-muted text-sm mt-3 mb-0">
                Taxable value{" "}
                <span className="font-semibold text-ink">
                  {taxableValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
                {formData.reverseCharge ? (
                  <> · GST payable under reverse charge, not part of this bill</>
                ) : (
                  <>
                    {" "}
                    · GST{" "}
                    <span className="font-semibold text-ink">
                      {gstValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                    {formData.itcEligible ? " (input credit claimed)" : " (not claimed)"}
                  </>
                )}
              </p>
            ) : null}
          </div>

          {/* TDS (P2-05/P2-12) */}
          <div className="sl-tile p-5 sm:p-6">
            <h2 className="sl-h2 m-0 mb-4">Tax Deducted at Source</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
              <label className="flex items-center gap-2 text-sm font-medium text-ink pb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deductTds}
                  disabled={saving || (isEdit && existingTdsAmount !== null)}
                  onChange={(e) => setDeductTds(e.target.checked)}
                  className="w-4 h-4 accent-[color:var(--color-primary)]"
                />
                Deduct TDS
              </label>

              <SelectInput
                label="Section"
                name="tdsSection"
                value={tdsSection}
                options={tdsSections.map((s) => ({
                  label: `${s.code} — ${s.name}`,
                  value: s.code,
                }))}
                defaultOptionLabel="Select Section"
                disabled={saving || (isEdit && existingTdsAmount !== null)}
                onChange={(e) => setTdsSection(e.target.value)}
                error={errors.tdsSection}
              />

              {isEdit && existingTdsAmount !== null ? (
                <div className="md:col-span-2 text-sm rounded-[14px] border border-line-soft bg-card-2 p-3">
                  <div className="flex justify-between">
                    <span className="text-ink-subtle">Deducted (section {tdsSection})</span>
                    <span className="font-semibold text-ink">
                      ₹{existingTdsAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              ) : deductTds && tdsSection ? (
                <div className="md:col-span-2 text-sm rounded-[14px] border border-line-soft bg-card-2 p-3">
                  {tdsLoading ? (
                    <span className="text-ink-subtle">Calculating…</span>
                  ) : tdsPreview ? (
                    tdsPreview.belowThreshold ? (
                      <span className="text-ink-subtle">{tdsPreview.reason}</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-ink-subtle">Rate</span>
                          <span className="font-semibold text-ink">{tdsPreview.rate}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-ink-subtle">TDS Amount</span>
                          <span className="font-semibold text-[color:var(--color-danger)]">
                            ₹
                            {((tdsPreview.base * tdsPreview.rate) / 100).toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-line-soft pt-1">
                          <span className="text-ink-subtle">Net Payable</span>
                          <span className="font-bold text-ink">
                            ₹
                            {(
                              Number(formData.amount || 0) -
                              (tdsPreview.base * tdsPreview.rate) / 100
                            ).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    )
                  ) : (
                    <span className="text-ink-subtle">Enter an amount to see the deduction</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* Descriptions & Notes */}
          <div className="sl-tile p-5 sm:p-6">
            <h2 className="sl-h2 m-0 mb-4">Descriptions & Notes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <TextArea
                  label="Description"
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  disabled={saving}
                  placeholder="Enter details about this expense..."
                  rows={2}
                />
              </div>

              <div>
                <TextArea
                  label="Internal Notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  disabled={saving}
                  placeholder="Enter internal audit/review notes..."
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Form Actions — sticky footer */}
          <div className="sl-sticky-footer z-20 [--sl-footer-gap:0px]-mx-1 bg-[linear-gradient(to_top,var(--color-page)_70%,transparent)] px-1 pb-3 pt-4">
            <div className="sl-tile flex flex-wrap items-center justify-end gap-2.5 px-4 py-3">
              <ActionPill variant="secondary" onClick={onCancel} disabled={saving}>
                Cancel
              </ActionPill>
              <ActionPill
                variant="secondary"
                icon={<Eraser size={16} />}
                onClick={handleClear}
                disabled={saving}
              >
                Clear
              </ActionPill>
              <ActionPill type="submit" icon={<Save size={17} />} disabled={saving}>
                {saving ? "Saving..." : isEdit ? "Update Expense" : "Save Expense"}
              </ActionPill>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ExpensesCreate;
