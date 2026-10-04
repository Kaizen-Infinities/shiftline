import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Hash, Save } from "lucide-react";
import { ActionPill, PageHeader, Tile } from "../../components/ui/v2";
import ToggleSwitch from "../../components/ui/ToggleSwitch/ToggleSwitch";
import { FormFooter } from "../sales/shared/tradeUi";
import { toast } from "react-toastify";

import TextInput from "../../components/form/TextInput/TextInput";
import CommonLoader from "../../components/ui/Loader/CommonLoader";
import { usePermission } from "../../hooks/usePermission";
import { useDetailCache, invalidateDetailCache } from "../../hooks/useDetailCache";

import {
  invoiceSettingsService,
  type InvoiceSettingDto,
} from "../../services/invoiceSettingsService";

// Month (0-indexed) your financial year starts in.
// 3 = April (India/UK), 0 = January (US), 6 = July (Australia). Adjust as needed.
const FY_START_MONTH = 3;

const SalesInvoiceCreate: React.FC = () => {
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<InvoiceSettingDto>({
    invoicePrefix: "INV",
    sequenceLength: 4,
    currentSequenceNumber: 1,
    financialYearStart: "",
    financialYearEnd: "",
    autoFinancialYear: true,
    formatTemplate: "{PREFIX}-{FY}-{SEQ}",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { can } = usePermission();
  const canEditInvoice = can("invoice-settings.edit");

  // ---- Financial Year helpers ----

  const getAutoFinancialYearStart = (): string => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const fyStart =
      today.getMonth() >= FY_START_MONTH
        ? new Date(currentYear, FY_START_MONTH, 1)
        : new Date(currentYear - 1, FY_START_MONTH, 1);
    return fyStart.toISOString().split("T")[0];
  };

  const calculateEndDate = (startStr: string): string => {
    const start = new Date(startStr);
    if (isNaN(start.getTime())) return "";
    const end = new Date(start);
    end.setFullYear(start.getFullYear() + 1);
    end.setDate(start.getDate() - 1);
    return end.toISOString().split("T")[0];
  };

  // ---- Load existing settings (cached) ----
  const fetcher = useCallback(async (_signal: AbortSignal) => {
    return await invoiceSettingsService.getConfig();
  }, []);

  const { data: fetchedConfig, loading } = useDetailCache<any>({
    cacheKey: "invoiceSettings:config",
    socketModule: "invoiceSettings",
    fetcher,
  });

  const populated = useRef(false);
  useEffect(() => {
    if (loading || populated.current) return;
    populated.current = true;

    if (fetchedConfig) {
      const isAuto =
        fetchedConfig.autoFinancialYear !== undefined ? fetchedConfig.autoFinancialYear : true;
      const start = isAuto
        ? getAutoFinancialYearStart()
        : fetchedConfig.financialYearStart
          ? new Date(fetchedConfig.financialYearStart).toISOString().split("T")[0]
          : "";
      const end = start ? calculateEndDate(start) : "";

      setFormData({
        id: fetchedConfig.id,
        companyId: fetchedConfig.companyId,
        invoicePrefix: fetchedConfig.invoicePrefix || "INV",
        sequenceLength: fetchedConfig.sequenceLength || 4,
        currentSequenceNumber: fetchedConfig.currentSequenceNumber || 1,
        financialYearStart: start,
        financialYearEnd: end,
        autoFinancialYear: isAuto,
        formatTemplate: fetchedConfig.formatTemplate || "{PREFIX}-{FY}-{SEQ}",
      });
    } else {
      const defaultStartStr = getAutoFinancialYearStart();
      const defaultEndStr = calculateEndDate(defaultStartStr);
      setFormData((prev) => ({
        ...prev,
        financialYearStart: defaultStartStr,
        financialYearEnd: defaultEndStr,
      }));
    }
  }, [fetchedConfig, loading]);

  useEffect(() => {
    if (formData.financialYearStart) {
      const endStr = calculateEndDate(formData.financialYearStart);
      if (endStr) {
        setFormData((prev) => ({ ...prev, financialYearEnd: endStr }));
      }
    }
  }, [formData.financialYearStart]);

  // ---- Handlers ----

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    const val = type === "checkbox" ? checked : value;

    if (name === "invoicePrefix") {
      const cleaned = String(val).toUpperCase().slice(0, 3);
      setFormData((prev) => ({ ...prev, invoicePrefix: cleaned }));
      if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
      return;
    }

    if (name === "autoFinancialYear") {
      setFormData((prev) => ({
        ...prev,
        autoFinancialYear: checked,
        financialYearStart: checked ? getAutoFinancialYearStart() : prev.financialYearStart,
      }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: val }));
    }

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    const prefix = formData.invoicePrefix?.trim() || "";

    if (!prefix) {
      errs.invoicePrefix = "Invoice Prefix is required";
    } else if (prefix.length < 2 || prefix.length > 3) {
      errs.invoicePrefix = "Invoice Prefix must be 2 or 3 characters";
    } else if (!/^[A-Za-z]+$/.test(prefix)) {
      errs.invoicePrefix = "Invoice Prefix must contain only letters";
    }

    if (!formData.sequenceLength || formData.sequenceLength <= 0)
      errs.sequenceLength = "Sequence Length must be greater than 0";
    if (!formData.financialYearStart)
      errs.financialYearStart = "Financial Year Start date is required";
    if (!formData.formatTemplate?.trim()) errs.formatTemplate = "Format Template is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditInvoice) {
      toast.error("You do not have permission to edit invoice settings.");
      return;
    }
    if (!validate()) return;

    setSaving(true);
    try {
      await invoiceSettingsService.saveConfig(formData);
      toast.success("Invoice settings saved successfully!");
      invalidateDetailCache("invoiceSettings:config");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to save invoice settings");
    } finally {
      setSaving(false);
    }
  };

  // ---- Live preview ----
  const livePreview = useMemo(() => {
    const fyVal = (() => {
      if (!formData.financialYearStart) return "YYYY-YY";
      const start = new Date(formData.financialYearStart);
      if (isNaN(start.getTime())) return "YYYY-YY";
      const end = new Date(start);
      end.setFullYear(start.getFullYear() + 1);
      end.setDate(start.getDate() - 1);
      const startYear = start.getFullYear();
      const endYearTwoDigits = String(end.getFullYear()).slice(-2);
      return `${startYear}-${endYearTwoDigits}`;
    })();

    const paddedSeq = String(formData.currentSequenceNumber).padStart(
      Number(formData.sequenceLength) || 4,
      "0"
    );

    let preview = formData.formatTemplate || "{PREFIX}-{FY}-{SEQ}";
    preview = preview.replace(/{PREFIX}/g, formData.invoicePrefix || "");
    preview = preview.replace(/{FY}/g, fyVal);
    preview = preview.replace(/{SEQ}/g, paddedSeq);
    return preview;
  }, [formData]);

  if (loading) {
    return <CommonLoader text="Loading settings..." fullScreen={false} />;
  }

  const toggleAutoFy = () =>
    handleChange({
      target: {
        name: "autoFinancialYear",
        type: "checkbox",
        checked: !formData.autoFinancialYear,
        value: "",
      },
    } as unknown as React.ChangeEvent<HTMLInputElement>);

  return (
    <div className="sl-page sl-page-doc">
      <PageHeader
        title="Invoice settings"
        subtitle="Numbering for sales invoices: prefix, sequence and financial year."
        icon={<Hash size={22} />}
      />
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Tile title="Invoice Numbering" subtitle="Configure how invoice numbers are generated">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
            <div>
              <TextInput
                label="Invoice Prefix"
                name="invoicePrefix"
                value={formData.invoicePrefix}
                onChange={handleChange as any}
                required
                error={errors.invoicePrefix}
                maxLength={3}
              />
              <p className="sl-field-hint m-0">2-3 letter prefix (e.g., IN, INV)</p>
            </div>
            <div>
              <TextInput
                label="Sequence Length"
                name="sequenceLength"
                type="number"
                min={1}
                value={String(formData.sequenceLength)}
                onChange={handleChange as any}
                required
                error={errors.sequenceLength}
              />
              <p className="sl-field-hint m-0">Number of digits (e.g., 4 = 0001)</p>
            </div>
            <div>
              <TextInput
                label="Current Sequence"
                name="currentSequenceNumber"
                type="number"
                value={String(formData.currentSequenceNumber)}
                onChange={handleChange as any}
                disabled
              />
              <p className="sl-field-hint m-0">Auto-incremented with each invoice</p>
            </div>
          </div>
        </Tile>

        <Tile title="Financial Year" subtitle="Configure financial year for invoice numbering">
          <div className="mb-4 flex items-center justify-between gap-4 rounded-[14px] bg-card-2 p-3">
            <div>
              <div id="auto-fy-label" className="text-sm font-semibold text-ink">
                Auto Financial Year
              </div>
              <div className="text-[13px] text-ink-subtle">
                {formData.autoFinancialYear
                  ? "System automatically determines the financial year based on today's date"
                  : "Manually set your financial year start date"}
              </div>
            </div>
            <ToggleSwitch
              checked={formData.autoFinancialYear}
              onChange={toggleAutoFy}
              label="Auto Financial Year"
            />
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <div>
              <TextInput
                label="FY Start"
                name="financialYearStart"
                type="date"
                value={formData.financialYearStart}
                onChange={handleChange as any}
                required
                error={errors.financialYearStart}
                disabled={formData.autoFinancialYear}
              />
              <p className="sl-field-hint m-0">
                {formData.autoFinancialYear
                  ? "Auto-calculated — disabled while Auto Financial Year is on"
                  : "Start date of your financial year"}
              </p>
            </div>
            <div>
              <TextInput
                label="FY End"
                name="financialYearEnd"
                type="date"
                value={formData.financialYearEnd}
                onChange={handleChange as any}
                disabled
              />
              <p className="sl-field-hint m-0">
                Auto-calculated as one day before start date (next year)
              </p>
            </div>
          </div>
        </Tile>

        <Tile
          title="Invoice Format"
          subtitle="Auto-generated invoice number format based on your settings"
        >
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 md:grid-cols-2">
            <div>
              <TextInput
                label="Format Template"
                name="formatTemplate"
                value={formData.formatTemplate}
                onChange={handleChange as any}
                required
                error={errors.formatTemplate}
              />
              <p className="sl-field-hint m-0">
                Variables: {"{PREFIX}"} - Prefix, {"{FY}"} - Financial Year, {"{SEQ}"} - Sequence
              </p>
            </div>
            <div>
              <span className="sl-label">Preview</span>
              <div
                aria-live="polite"
                className="flex h-11 items-center justify-center rounded-[12px] bg-chip px-3 font-mono text-base font-bold tracking-widest text-chip-fg"
              >
                {livePreview}
              </div>
            </div>
          </div>
        </Tile>

        {canEditInvoice && (
          <FormFooter>
            <ActionPill
              type="submit"
              icon={<Save size={17} />}
              loading={saving}
              loadingText="Saving..."
            >
              Save Settings
            </ActionPill>
          </FormFooter>
        )}
      </form>
    </div>
  );
};

export default SalesInvoiceCreate;
