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
  };

  const [formData, setFormData] = useState<ExpenseFormData>(defaultFormData);
  const [suppliers, setSuppliers] = useState<Array<{ label: string; value: string; id: number }>>(
    []
  );
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
          }));
          setSuppliers(formatted);
        }
      } catch (error) {
        console.error("Error fetching suppliers:", error);
      }
    };
    fetchSuppliers();
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
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

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
          { label: "Expense Management", to: "/expenses" },
          { label: isEdit ? "Edit" : "New" },
        ]}
        title={isEdit ? `Edit Expense: ${formData.expenseNumber}` : "Create Expense"}
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
