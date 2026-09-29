import React, { useState, useEffect } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  createGoodsDispatch,
  fetchEligibleOrders,
} from "../../../features/goods-dispatch/goodsDispatchSlice";
import { fetchStores } from "../../../features/stores/storeSlice";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import DataTable from "../../../components/ui/table/DataTable";
import type { DataTableColumn } from "../../../components/ui/table/DataTable";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import IndiaPhoneInput, { validatePhoneNumber } from "../../../components/ui/PhoneInput/PhoneInput";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import TimePickerInput from "../../../components/form/TimePickerInput/TimePickerInput";
import { usePermission } from "../../../hooks/usePermission";
import { Plus, Send } from "lucide-react";
import { ActionPill, Chip, PageHeader, SectionLabel, Tile } from "../../../components/ui/v2";
import FormFooter from "../../stock/lib/FormFooter";
import { useT } from "../../../i18n/I18nProvider";

const formatUOM = (code: string | null | undefined) => {
  if (!code) return "pcs";
  const lower = code.toLowerCase().trim();
  return lower === "ea" || lower === "each" ? "pcs" : code;
};

const GoodsDispatchCreate: React.FC = () => {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { can } = usePermission();

  const { eligibleOrders, loading } = useAppSelector((state) => state.goodsDispatch);
  const { data: stores = [] } = useAppSelector((state) => state.stores);

  const [searchPo] = useState<string>("");
  const [selectedPOs, setSelectedPOs] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    dispatchDate: new Date().toISOString().split("T")[0],
    vehicleNumber: "",
    driverName: "",
    driverMobile: "",
    transportName: "",
    loadingTime: "",
    remarks: "",
    destinationStoreId: "",
  });

  const [formErrors, setFormErrors] = useState({
    vehicleNumber: "",
    driverName: "",
    driverMobile: "",
    destinationStoreId: "",
  });

  useFormShortcuts({});

  const { t } = useT();

  useEffect(() => {
    dispatch(fetchEligibleOrders({}));
    dispatch(fetchStores({ storeCategory: "FINISHED_GOODS", limit: 100 }));
  }, [dispatch]);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectPO = (po: any) => {
    const poStoreId = po.destinationStoreId;

    if (selectedPOs.some((p) => p.productionOrderId === po.productionOrderId)) {
      toast.warning(t("dispatch.toast.alreadyAdded"));
      return;
    }

    if (poStoreId) {
      if (selectedPOs.length === 0 || !formData.destinationStoreId) {
        const matchedStore = stores.find((s: any) => s.storeId === poStoreId);
        const storeLabel = matchedStore ? matchedStore.storeName : poStoreId;

        setFormData((prev) => ({ ...prev, destinationStoreId: poStoreId }));
        setFormErrors((prev) => ({ ...prev, destinationStoreId: "" }));
        toast.info(t("dispatch.toast.storeAutoSet", { store: storeLabel }));
      } else if (poStoreId !== formData.destinationStoreId) {
        toast.error(
          t("dispatch.toast.storeMismatch", { po: po.productionOrderId, store: poStoreId })
        );
        return;
      }
    }

    setSelectedPOs((prev) => [...prev, { ...po, dispatchQty: po.pendingDispatchQty, remarks: "" }]);
  };

  const handleRemovePO = (productionOrderId: string) => {
    setSelectedPOs((prev) => {
      const nextPOs = prev.filter((p) => p.productionOrderId !== productionOrderId);
      if (nextPOs.length === 0) {
        setFormData((f) => ({ ...f, destinationStoreId: "" }));
      }
      return nextPOs;
    });
  };

  const handleQtyChange = (productionOrderId: string, val: string, maxQty: number) => {
    const num = Number(val);
    if (num > maxQty) {
      toast.warning(t("dispatch.toast.overPending", { qty: maxQty }));
      return;
    }
    setSelectedPOs((prev) =>
      prev.map((p) => (p.productionOrderId === productionOrderId ? { ...p, dispatchQty: val } : p))
    );
  };

  const handleRemarksChange = (productionOrderId: string, val: string) => {
    setSelectedPOs((prev) =>
      prev.map((p) => (p.productionOrderId === productionOrderId ? { ...p, remarks: val } : p))
    );
  };

  const validateForm = () => {
    const errors = {
      vehicleNumber: "",
      driverName: "",
      driverMobile: "",
      destinationStoreId: "",
    };
    let isValid = true;

    if (!formData.vehicleNumber.trim()) {
      errors.vehicleNumber = t("dispatch.err.vehicle");
      isValid = false;
    }
    if (!formData.driverName.trim()) {
      errors.driverName = t("dispatch.err.driver");
      isValid = false;
    }
    if (formData.driverMobile) {
      const mobileErr = validatePhoneNumber(formData.driverMobile, false);
      if (mobileErr) {
        errors.driverMobile = mobileErr;
        isValid = false;
      }
    }
    if (!formData.destinationStoreId) {
      errors.destinationStoreId = t("dispatch.err.store");
      isValid = false;
    }

    setFormErrors(errors);
    return isValid;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error(t("dispatch.toast.fixErrors"));
      return;
    }
    if (selectedPOs.length === 0) {
      toast.error(t("dispatch.toast.noOrders"));
      return;
    }
    const invalidItem = selectedPOs.some((po) => !po.dispatchQty || Number(po.dispatchQty) <= 0);
    if (invalidItem) {
      toast.error(t("dispatch.toast.zeroQty"));
      return;
    }

    const storeMismatch = selectedPOs.find(
      (po) => po.destinationStoreId && po.destinationStoreId !== formData.destinationStoreId
    );
    if (storeMismatch) {
      toast.error(
        t("dispatch.toast.storeMismatch", {
          po: storeMismatch.productionOrderId,
          store: storeMismatch.destinationStoreId,
        })
      );
      return;
    }

    try {
      const payload = {
        ...formData,
        items: selectedPOs.map((po) => ({
          productionOrderId: po.productionOrderId,
          productItemId: po.productItem.id,
          dispatchQty: Number(po.dispatchQty),
          uom: po.uom,
          remarks: po.remarks,
        })),
      };

      await dispatch(createGoodsDispatch(payload)).unwrap();
      toast.success(t("dispatch.toast.created"));
      navigate("/production/goods-dispatch");
    } catch (error: any) {
      toast.error(error || t("dispatch.toast.createFailed"));
    }
  };

  const combinedColumns: DataTableColumn<any>[] = [
    {
      header: t("dispatch.col.po"),
      width: "110px",
      accessor: "productionOrderId",
      render: (item: any) => (
        <span className="font-bold text-ink text-sm">{item.productionOrderId}</span>
      ),
    },
    {
      header: t("common.product"),
      width: "minmax(130px, 1fr)",
      accessor: "productItem",
      render: (item: any) => (
        <div>
          <div className="font-medium text-ink text-sm">{item.productItem?.productName}</div>
          {item.productItem?.productCode && (
            <div className="text-xs text-ink-subtle font-mono">{item.productItem?.productCode}</div>
          )}
        </div>
      ),
    },
    {
      header: t("dispatch.col.pending"),
      width: "100px",
      accessor: "pendingDispatchQty",
      align: "right",
      render: (item: any) => (
        <span className="font-semibold tabular-nums text-accent">
          {Number(item.pendingDispatchQty).toLocaleString("en-IN")} {formatUOM(item.uom)}
        </span>
      ),
    },
    {
      header: t("dispatch.col.dispatchQty"),
      width: "160px",
      render: (item: any) => {
        const selected = selectedPOs.find((p) => p.productionOrderId === item.productionOrderId);
        if (!selected) return <span className="text-ink-subtle text-xs">—</span>;
        return (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min="0.1"
              step="any"
              max={item.pendingDispatchQty}
              value={selected.dispatchQty}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                handleQtyChange(item.productionOrderId, e.target.value, item.pendingDispatchQty)
              }
              inputMode="decimal"
              aria-label={t("dispatch.qtyFor", { po: item.productionOrderId })}
              className="sl-input h-9 w-24 px-2 text-right tabular-nums"
            />
            <span className="text-xs text-ink-subtle">{formatUOM(item.uom)}</span>
          </div>
        );
      },
    },
    {
      header: t("common.remarks"),
      width: "140px",
      render: (item: any) => {
        const selected = selectedPOs.find((p) => p.productionOrderId === item.productionOrderId);
        if (!selected) return <span className="text-ink-subtle text-xs">—</span>;
        return (
          <input
            type="text"
            placeholder={t("dispatch.optional")}
            value={selected.remarks || ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleRemarksChange(item.productionOrderId, e.target.value)}
            aria-label={t("dispatch.remarksFor", { po: item.productionOrderId })}
            className="sl-input h-9 w-full px-2 text-sm"
          />
        );
      },
    },
    {
      header: t("hourly.action"),
      width: "90px",
      accessor: "id",
      render: (item: any) => {
        const isSelected = selectedPOs.some((p) => p.productionOrderId === item.productionOrderId);
        return isSelected ? (
          <DeleteButton onClick={() => handleRemovePO(item.productionOrderId)} />
        ) : (
          <ActionPill
            variant="blue"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => handleSelectPO(item)}
          >
            {t("dispatch.add")}
          </ActionPill>
        );
      },
    },
  ];

  const DISPATCH_ELIGIBLE_STATUSES = [
    "READY_FOR_DISPATCH",
    "COMPLETED",
    "PARTIAL_COMPLETED",
    "COMPLETED_WITH_SHORTFALL",
    "CLOSED",
  ];

  const filteredEligibleOrders = eligibleOrders.filter((o) => {
    // Only allow fully completed orders — block POST_PRODUCTION and earlier statuses
    if (!DISPATCH_ELIGIBLE_STATUSES.includes(o.status)) return false;
    if (!searchPo) return true;
    return (
      o.productionOrderId?.toLowerCase().includes(searchPo.toLowerCase()) ||
      o.productItem?.productName?.toLowerCase().includes(searchPo.toLowerCase())
    );
  });

  const totalDispatchQty = selectedPOs.reduce((sum, po) => sum + (Number(po.dispatchQty) || 0), 0);

  return (
    <div className="w-full min-w-0">
      <PageHeader
        title={t("dispatch.createTitle")}
        subtitle={t("dispatch.createSubtitle")}
        back="/production/goods-dispatch"
        backLabel={t("dispatch.back")}
        breadcrumbs={[
          { label: t("dispatch.crumbProduction") },
          { label: t("dispatch.title"), to: "/production/goods-dispatch" },
          { label: t("dispatch.crumbNew") },
        ]}
      />

      <div className="flex flex-col gap-4">
        <section aria-label={t("dispatch.selectOrders")}>
          <SectionLabel
            action={
              selectedPOs.length > 0 ? (
                <span className="flex items-center gap-2">
                  <Chip size="sm">
                    {t("dispatch.selectedCount", { count: selectedPOs.length })}
                  </Chip>
                  <Chip size="sm" tone="success" className="tabular-nums">
                    {t("dispatch.totalUnits", { qty: totalDispatchQty })}
                  </Chip>
                </span>
              ) : undefined
            }
          >
            {t("dispatch.selectOrders")}
          </SectionLabel>
          <DataTable
            columns={combinedColumns}
            data={filteredEligibleOrders}
            loading={loading}
            rowKey={(item) => item.productionOrderId}
            ariaLabel={t("dispatch.eligibleLabel")}
            emptyMessage={t("dispatch.noEligible")}
            minHeightClassName=""
            rowClassName={(item: any) =>
              selectedPOs.some((p) => p.productionOrderId === item.productionOrderId)
                ? "bg-nav-active"
                : ""
            }
          />
        </section>

        <Tile title={t("dispatch.vehicleTitle")} subtitle={t("dispatch.vehicleSub")}>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            <DatePickerCalendar
              label={t("dispatch.date")}
              name="dispatchDate"
              value={formData.dispatchDate}
              onChange={(e) => handleInputChange(e as any)}
              required
            />
            <SelectInput
              label={t("dispatch.destination")}
              name="destinationStoreId"
              value={formData.destinationStoreId}
              onChange={handleInputChange}
              required
              error={formErrors.destinationStoreId}
              options={[
                { value: "", label: t("dispatch.selectStore") },
                ...stores.map((s) => ({ value: s.storeId, label: s.storeName })),
              ]}
            />
            <TextInput
              label={t("dispatch.vehicleNumber")}
              name="vehicleNumber"
              value={formData.vehicleNumber}
              onChange={handleInputChange}
              placeholder={t("dispatch.vehiclePlaceholder")}
              required
              error={formErrors.vehicleNumber}
            />
            <TextInput
              label={t("dispatch.driverName")}
              name="driverName"
              value={formData.driverName}
              onChange={handleInputChange}
              placeholder={t("dispatch.driverName")}
              required
              error={formErrors.driverName}
            />
            <IndiaPhoneInput
              label={t("dispatch.driverMobile")}
              name="driverMobile"
              value={formData.driverMobile}
              onChange={(e: any) => handleInputChange(e)}
              required={false}
              error={formErrors.driverMobile}
            />
            <TextInput
              label={t("dispatch.transportName")}
              name="transportName"
              value={formData.transportName}
              onChange={handleInputChange}
              placeholder={t("dispatch.transportPlaceholder")}
            />
            <TimePickerInput
              label={t("dispatch.loadingTime")}
              name="loadingTime"
              value={formData.loadingTime}
              onChange={(val) => setFormData((prev) => ({ ...prev, loadingTime: val }))}
            />
            <div className="md:col-span-2">
              <TextInput
                label={t("common.remarks")}
                name="remarks"
                value={formData.remarks}
                onChange={handleInputChange}
                placeholder={t("dispatch.remarksPlaceholder")}
                as="textarea"
                rows={2}
              />
            </div>
          </div>
        </Tile>
      </div>

      <FormFooter
        hint={
          selectedPOs.length > 0
            ? t("dispatch.footerCount", { count: selectedPOs.length, qty: totalDispatchQty })
            : t("dispatch.footerEmpty")
        }
      >
        <ActionPill
          variant="secondary"
          onClick={() => navigate("/production/goods-dispatch")}
          disabled={loading}
        >
          {t("common.cancel")}
        </ActionPill>
        {can("goods-dispatch.create") && (
          <ActionPill
            icon={<Send size={16} />}
            onClick={handleSubmit}
            loading={loading}
            loadingText={t("dispatch.creating")}
          >
            {t("dispatch.create")}
          </ActionPill>
        )}
      </FormFooter>
    </div>
  );
};

export default GoodsDispatchCreate;
