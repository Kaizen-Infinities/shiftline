import React, { useState, useEffect } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { CalendarDays, Clock, Cog, Crown, Info, Lock, Save, Trophy, Users } from "lucide-react";
import { ActionPill, Chip, PageHeader, Tile } from "../../../components/ui/v2";
import { InfoItem, PageBody, StickyFormFooter } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import QuantityInput from "../../../components/form/QuantityInput/QuantityInput";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { updateHourlyProduction } from "../../../features/hourly-productions/hourlyProductionSlice";
import CommonModal from "../../../components/ui/Modal/CommonModal";

const HourlyWorkReportEdit: React.FC = () => {
  const navigate = useNavigate();
  const locationState = useLocation();
  const dispatch = useAppDispatch();

  // Form fields
  const [hourlyProductionId, setHourlyProductionId] = useState("");
  const [productionOrderId, setProductionOrderId] = useState("");
  const [productionDate, setProductionDate] = useState("");
  const [hourIndex, setHourIndex] = useState("1");
  const [qtyProduced, setQtyProduced] = useState("");
  const [rejectQty, setRejectQty] = useState("0");
  const [scrapQty, setScrapQty] = useState("0");
  const [downtime, setDowntime] = useState("0");
  const [remarks, setRemarks] = useState("");
  const [downtimeReason, setDowntimeReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [scrapReason, setScrapReason] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [operatorName, setOperatorName] = useState("");

  // Display-only fields
  const [productName, setProductName] = useState("");
  const [machineName, setMachineName] = useState("");
  const [shiftName, setShiftName] = useState("");
  const [uom, setUom] = useState("units");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEditDisabled, setIsEditDisabled] = useState(false);
  const [showNewHighModal, setShowNewHighModal] = useState(false);
  const [newHighDetails, setNewHighDetails] = useState<any>(null);

  useFormShortcuts({});

  useEffect(() => {
    if (locationState.state) {
      const s = locationState.state;
      setHourlyProductionId(s.hourlyProductionId?.toString() || "");
      setProductionOrderId(s.productionOrderId || "");
      setProductionDate(s.productionDate ? s.productionDate.split("T")[0] : "");
      setHourIndex(s.hourIndex?.toString() || "1");
      setQtyProduced(s.qtyProduced?.toString() || "");
      setRejectQty(s.rejectQty?.toString() || "0");
      setScrapQty(s.scrapQty?.toString() || "0");
      setDowntime(s.downtime?.toString() || "0");
      setRemarks(s.remarks || "");
      setDowntimeReason(s.downtimeReason || "");
      setRejectReason(s.rejectReason || "");
      setScrapReason(s.scrapReason || "");
      setOperatorId(s.operatorId || "");
      setOperatorName(s.operatorName || "");

      setProductName(s.productionOrder?.productItem?.productName || "Unknown Product");
      setMachineName(s.machine?.machineName || s.machineId || "Unknown Machine");
      setShiftName(s.shift?.shiftName || s.shiftId || "Unknown Shift");
      setUom(
        (s.productionOrder?.productItem?.uom?.uomCode?.toUpperCase() === "EA"
          ? "PCS"
          : s.productionOrder?.productItem?.uom?.uomCode?.toUpperCase()) || "PCS"
      );
      setIsEditDisabled(s.isEditDisabled || false);
    } else {
      toast.error("No report data provided.");
      navigate("/hourly-work-reports");
    }
  }, [locationState.state, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const numReject = Number(rejectQty) || 0;
      const numScrap = Number(scrapQty) || 0;
      const numDowntime = Number(downtime) || 0;

      const payload = {
        qtyProduced: Number(qtyProduced) || 0,
        rejectQty: numReject,
        scrapQty: numScrap,
        downtime: numDowntime,
        remarks: remarks.trim() || undefined,
        downtimeReason: numDowntime > 0 ? downtimeReason : undefined,
        rejectReason: numReject > 0 ? rejectReason : undefined,
        scrapReason: numScrap > 0 ? scrapReason : undefined,
        operatorId: operatorId || undefined,
      };

      const res = await dispatch(
        updateHourlyProduction({
          id: hourlyProductionId,
          data: payload,
        })
      ).unwrap();
      toast.success("Hourly Report updated successfully!");

      const dataObj = res?.data || res;
      if (dataObj?.newHighReached) {
        setNewHighDetails(dataObj.newHighDetails);
        setShowNewHighModal(true);
      } else {
        navigate("/hourly-work-reports");
      }
    } catch (err: any) {
      toast.error(err || "Failed to update report");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageBody className="max-w-[1180px]">
      <PageHeader
        title="Edit Hourly Production Log"
        subtitle={`${productionOrderId || "—"} · Hour ${hourIndex}`}
        back="/hourly-work-reports"
        backLabel="Back to List"
        breadcrumbs={[
          { label: "Hourly logs", to: "/hourly-work-reports" },
          { label: "Edit entry" },
        ]}
        meta={
          isEditDisabled ? (
            <Chip tone="muted" icon={<Lock size={13} />}>
              Locked
            </Chip>
          ) : undefined
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        {isEditDisabled && (
          <div
            role="status"
            className="sl-tile flex items-center gap-3 p-4 text-sm font-medium text-[color:var(--color-danger)]"
          >
            <Info size={18} className="shrink-0" aria-hidden="true" />
            This log is locked (shift completed, stopped, or final hour logged).
          </div>
        )}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <Tile
            title="Reference Plan Info"
            subtitle="Locked for editing"
            className="self-start lg:col-span-2"
          >
            <dl className="m-0 grid grid-cols-2 gap-4 rounded-[14px] bg-card-2 p-4 lg:grid-cols-1">
              <InfoItem label="Machine" value={machineName} />
              <InfoItem
                label="Production Date"
                value={productionDate ? formatDate(productionDate) : "—"}
              />
              <InfoItem label="Shift" value={shiftName} />
              <InfoItem label="Production Order" value={productionOrderId} mono />
              <InfoItem label="Product" value={productName} className="col-span-2 lg:col-span-1" />
            </dl>
          </Tile>

          <Tile title="Log Parameters" className="lg:col-span-3">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SelectInput
                label="Hour Index of Shift"
                name="hourIndex"
                value={hourIndex}
                options={Array.from({ length: 24 }, (_, i) => ({
                  label: `Hour ${i + 1}`,
                  value: String(i + 1),
                }))}
                required
                disabled={isEditDisabled}
                onChange={(e) => setHourIndex(e.target.value)}
              />
              <TextInput
                label="Operator"
                name="operatorName"
                value={operatorName || operatorId || "—"}
                disabled
              />
              <QuantityInput
                label="Produced Qty"
                name="qtyProduced"
                value={qtyProduced}
                baseUoms={uom}
                disabled={isEditDisabled}
                onChange={(e) => setQtyProduced(e.target.value)}
              />
              <QuantityInput
                label="Reject Qty"
                name="rejectQty"
                value={rejectQty}
                baseUoms={uom}
                disabled={isEditDisabled}
                onChange={(e) => setRejectQty(e.target.value)}
              />
              <QuantityInput
                label="Scrap Qty"
                name="scrapQty"
                value={scrapQty}
                baseUoms={uom}
                disabled={isEditDisabled}
                onChange={(e) => setScrapQty(e.target.value)}
              />
              <QuantityInput
                label="Downtime"
                name="downtime"
                value={downtime}
                baseUoms="mins,hrs"
                disabled={isEditDisabled}
                onChange={(e) => setDowntime(e.target.value)}
              />

              {Number(downtime) > 0 && (
                <SelectInput
                  label="Downtime Reason"
                  name="downtimeReason"
                  value={downtimeReason}
                  disabled={isEditDisabled}
                  onChange={(e) => setDowntimeReason(e.target.value)}
                  options={[
                    { label: "Machine Breakdown", value: "Machine Breakdown" },
                    { label: "Power Failure", value: "Power Failure" },
                    { label: "Material Shortage", value: "Material Shortage" },
                    { label: "Tool/Mould Change", value: "Tool/Mould Change" },
                    { label: "Operator Unavailable", value: "Operator Unavailable" },
                    { label: "Quality Issue", value: "Quality Issue" },
                    { label: "Preventative Maintenance", value: "Preventative Maintenance" },
                    { label: "Others", value: "Others" },
                  ]}
                />
              )}
              {Number(rejectQty) > 0 && (
                <SelectInput
                  label="Reject Reason"
                  name="rejectReason"
                  value={rejectReason}
                  disabled={isEditDisabled}
                  onChange={(e) => setRejectReason(e.target.value)}
                  options={[
                    { value: "Quality Issue", label: "Quality Issue" },
                    { value: "Machine Defect", label: "Machine Defect" },
                    { value: "Material Defect", label: "Material Defect" },
                    { value: "Operator Error", label: "Operator Error" },
                    { value: "Others", label: "Others" },
                  ]}
                />
              )}
              {Number(scrapQty) > 0 && (
                <SelectInput
                  label="Scrap Reason"
                  name="scrapReason"
                  value={scrapReason}
                  disabled={isEditDisabled}
                  onChange={(e) => setScrapReason(e.target.value)}
                  options={[
                    { value: "Startup Scrap", label: "Startup Scrap" },
                    { value: "Process Setting", label: "Process Setting" },
                    { value: "Material Purging", label: "Material Purging" },
                    { value: "Others", label: "Others" },
                  ]}
                />
              )}
              {(downtimeReason === "Others" ||
                rejectReason === "Others" ||
                scrapReason === "Others") && (
                <div className="md:col-span-2">
                  <TextInput
                    label="Remarks (Reason for Others)"
                    name="remarks"
                    value={remarks}
                    required
                    placeholder="Enter specific reason"
                    disabled={isEditDisabled}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </div>
              )}
            </div>
          </Tile>
        </div>

        <StickyFormFooter
          hint={isEditDisabled ? "This entry can no longer be changed." : "F2 saves"}
        >
          <ActionPill
            variant="secondary"
            onClick={() => navigate("/hourly-work-reports")}
            disabled={isSubmitting}
          >
            Cancel
          </ActionPill>
          {!isEditDisabled && (
            <ActionPill
              type="submit"
              size="lg"
              icon={<Save size={18} />}
              loading={isSubmitting}
              loadingText="Updating..."
            >
              Update Log
            </ActionPill>
          )}
        </StickyFormFooter>
      </form>

      {/* ─────── New High Reached Modal ─────── */}
      <CommonModal
        show={showNewHighModal}
        onHide={() => {
          setShowNewHighModal(false);
          navigate("/hourly-work-reports");
        }}
        title={
          <div className="flex items-center gap-2 font-bold text-ink">
            <Trophy size={20} className="text-accent" aria-hidden="true" />
            <span>New Production High Reached!</span>
          </div>
        }
        footer={
          <ActionPill
            onClick={() => {
              setShowNewHighModal(false);
              navigate("/hourly-work-reports");
            }}
          >
            Awesome!
          </ActionPill>
        }
      >
        <div className="text-center py-4">
          <div className="flex justify-center mb-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-chip text-accent motion-safe:animate-bounce">
              <Crown size={40} aria-hidden="true" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-ink mb-2">Congratulations!</h3>
          <p className="text-ink-muted text-sm max-w-sm mx-auto mb-6">
            You have recorded a new highest production capacity for this product on this machine!
          </p>

          <div className="mb-6 inline-block min-w-60 rounded-[18px] bg-card-2 p-6">
            <div className="text-xs uppercase tracking-wider text-ink-subtle font-semibold mb-1">
              New Capacity High
            </div>
            <div className="text-4xl font-extrabold text-ink flex items-center justify-center gap-2">
              <span>{newHighDetails?.newCapacity}</span>
              <span className="text-lg font-normal text-ink-muted">{uom || "units"}</span>
            </div>
            {newHighDetails?.previousCapacity > 0 && (
              <div className="mt-2 inline-block rounded-full bg-card px-3 py-1 text-xs text-ink-subtle">
                Previous High:{" "}
                <span className="font-semibold text-ink-muted">
                  {newHighDetails.previousCapacity} {uom || "units"}
                </span>
              </div>
            )}
          </div>

          <div className="mx-auto grid max-w-md grid-cols-2 gap-4 rounded-[16px] bg-card-2 p-5 text-left text-sm">
            <div className="flex items-start gap-2.5">
              <CalendarDays
                size={16}
                className="mt-0.5 shrink-0 text-ink-muted"
                aria-hidden="true"
              />
              <div>
                <span className="text-ink-subtle text-xs block font-medium">Date</span>
                <strong className="text-ink-muted font-semibold">{newHighDetails?.date}</strong>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Cog size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <span className="text-ink-subtle text-xs block font-medium">Machine</span>
                <strong
                  className="text-ink-muted font-semibold truncate block max-w-37.5"
                  title={newHighDetails?.machineName}
                >
                  {newHighDetails?.machineName}
                </strong>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Clock size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <span className="text-ink-subtle text-xs block font-medium">Shift</span>
                <strong className="text-ink-muted font-semibold">
                  {newHighDetails?.shiftName}
                </strong>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Users size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <span className="text-ink-subtle text-xs block font-medium">Operators</span>
                <strong
                  className="text-ink-muted font-semibold block truncate max-w-37.5"
                  title={newHighDetails?.operators}
                >
                  {newHighDetails?.operators}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </CommonModal>
    </PageBody>
  );
};

export default HourlyWorkReportEdit;
