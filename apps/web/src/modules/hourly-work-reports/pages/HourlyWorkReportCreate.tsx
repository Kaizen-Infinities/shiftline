import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { Form } from "../../../components/ui/TailwindPrimitives";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Cog,
  Crown,
  Eraser,
  Info,
  Plus,
  Save,
  Trophy,
  Users,
} from "lucide-react";
import { ActionPill, Chip, PageHeader, SkeletonTile, Tile } from "../../../components/ui/v2";
import { Figure, InfoItem, PageBody, StickyFormFooter, formatQty } from "../../production/ui";
import { formatDate } from "../../../utils/dateUtils";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "react-toastify";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import QuantityInput from "../../../components/form/QuantityInput/QuantityInput";
import DeleteButton from "../../../components/ui/DeleteButton/DeleteButton";
import CommonModal from "../../../components/ui/Modal/CommonModal";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  createHourlyProduction,
  updateHourlyProduction,
} from "../../../features/hourly-productions/hourlyProductionSlice";
import { fetchMachines } from "../../../features/machines/machineSlice";
import { fetchShifts } from "../../../features/shifts/shiftSlice";
import { dailyPlanService } from "../../../services/dailyPlanService";
import apiClient from "../../../api/apiClient";
import config from "../../../api/config";

const formatLocalDateString = (d: Date) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getUomOptions = (baseUom: string) => {
  if (!baseUom) return [];
  return baseUom.split(",").map((u) => {
    const cleaned = u.trim().toLowerCase();
    const display = cleaned === "ea" ? "pcs" : cleaned;
    return { value: cleaned, label: display };
  });
};

/** Normalize UOM aliases to canonical short form */
const normalizeUom = (uom: string): string => {
  const u = uom.trim().toLowerCase();
  if (u === "kilogram" || u === "kilograms") return "kg";
  if (u === "gram" || u === "grams") return "g";
  if (u === "ton" || u === "tonne" || u === "tonnes" || u === "tons") return "t";
  if (u === "liter" || u === "litre" || u === "liters" || u === "litres" || u === "ltr") return "l";
  if (
    u === "milliliter" ||
    u === "millilitre" ||
    u === "milliliters" ||
    u === "millilitres" ||
    u === "ml"
  )
    return "ml";
  if (u === "meter" || u === "meters" || u === "metre" || u === "metres") return "m";
  if (u === "centimeter" || u === "centimetre" || u === "centimeters" || u === "centimetres")
    return "cm";
  if (u === "millimeter" || u === "millimetre" || u === "millimeters" || u === "millimetres")
    return "mm";
  if (u === "pcs" || u === "piece" || u === "pieces" || u === "ea" || u === "each") return "pcs";
  if (u === "box" || u === "boxes") return "box";
  if (u === "dozen" || u === "dz") return "dz";
  return u;
};

const HourlyWorkReportCreate: React.FC = () => {
  const navigate = useNavigate();
  const locationState = useLocation();
  const dispatch = useAppDispatch();

  // Redux State
  const { data: machines } = useAppSelector((state) => state.machines);
  const { data: shifts } = useAppSelector((state: any) => state.shifts || { data: [] });

  // State for selectors
  const [machineId, setMachineId] = useState("");
  const [productionDate, setProductionDate] = useState(formatLocalDateString(new Date()));
  const [shiftId, setShiftId] = useState("");
  const [editingLogId, setEditingLogId] = useState<string | null>(null);

  // State for hourly log fields
  const [hourIndex, setHourIndex] = useState("1");
  const [qtyProduced, setQtyProduced] = useState("0");
  const [rejectQty, setRejectQty] = useState("0");
  const [scrapQty, setScrapQty] = useState("0");
  const [downtime, setDowntime] = useState("0");
  const [remarks, setRemarks] = useState("");
  const [downtimeReason, setDowntimeReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [scrapReason, setScrapReason] = useState("");
  const [operatorId, setOperatorId] = useState("");
  // Tracks whether the user manually chose an operator from the dropdown.
  // When true, async useEffects must NOT overwrite the user's selection.
  const userSelectedOperator = useRef(false);

  // Inline validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Auto-loaded plan details
  const [activePlan, setActivePlan] = useState<any>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dailyPlanId, setDailyPlanId] = useState<string | null>(null);

  // Added states for Daily Production Plan dropdown and Operator lookup
  const [dailyPlans, setDailyPlans] = useState<any[]>([]);
  const [selectedDailyPlanId, setSelectedDailyPlanId] = useState("");
  const [availableOperators, setAvailableOperators] = useState<any[]>([]);
  const [planError, setPlanError] = useState<string | null>(null);

  // Wastage Audit State
  const [wastages, setWastages] = useState<any[]>([]);
  const [wastageStores, setWastageStores] = useState<any[]>([]);
  const [rawMaterialStores, setRawMaterialStores] = useState<any[]>([]);
  const [rawMaterials, setRawMaterials] = useState<any[]>([]);
  const [rawMaterialsUsed, setRawMaterialsUsed] = useState<any[]>([]);
  const [rawMaterialOptions, setRawMaterialOptions] = useState<any[]>([]);

  const [stopPlanEarly, setStopPlanEarly] = useState(false);
  const [stopPlanReason, setStopPlanReason] = useState("");
  const [stopOption, setStopOption] = useState<"CARRY_FORWARD" | "FORCE_COMPLETE">("CARRY_FORWARD");
  const [showNewHighModal, setShowNewHighModal] = useState(false);
  const [newHighDetails, setNewHighDetails] = useState<any>(null);

  useFormShortcuts({});

  // Is the form pre-filled from Daily Planning?
  const isPreFilled = useMemo(() => {
    return !!(locationState.state && locationState.state.productionOrderId);
  }, [locationState.state]);

  useEffect(() => {
    dispatch(fetchMachines());
    dispatch(fetchShifts());
    // Fetch WASTAGE stores (for Wastage Products section)
    apiClient
      .get(config.store.base, { params: { storeCategory: "WASTAGE", limit: 100 } })
      .then((res) => {
        const data = res.data?.data;
        let list: any[] = [];
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.stores)) list = data.stores;
        else if (res.data && Array.isArray(res.data.stores)) list = res.data.stores;
        setWastageStores(list);
      })
      .catch((err) => console.error(err));

    // Fetch RAW_MATERIAL stores (for Returned Raw Materials section)
    apiClient
      .get(config.store.base, { params: { storeCategory: "RAW_MATERIAL", limit: 100 } })
      .then((res) => {
        const data = res.data?.data;
        let list: any[] = [];
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.stores)) list = data.stores;
        else if (res.data && Array.isArray(res.data.stores)) list = res.data.stores;
        setRawMaterialStores(list);
      })
      .catch((err) => console.error(err));

    apiClient
      .get(config.rawMaterial.base, { params: { limit: 500 } })
      .then((res) => {
        const data = res.data?.data;
        let list: any[] = [];
        if (Array.isArray(data)) list = data;
        else if (data && Array.isArray(data.rawMaterials)) list = data.rawMaterials;
        else if (res.data && Array.isArray(res.data.rawMaterials)) list = res.data.rawMaterials;
        setRawMaterials(list.filter((rm: any) => rm.itemType === "WASTAGE"));
        setRawMaterialOptions(list.filter((rm: any) => rm.itemType !== "WASTAGE"));
      })
      .catch((err) => console.error(err));
  }, [dispatch]);

  // Fetch daily plans list for dropdown (if not prefilled)
  useEffect(() => {
    if (isPreFilled) return;
    dailyPlanService
      .getAll()
      .then((res: any) => {
        let list: any[] = [];
        if (Array.isArray(res)) list = res;
        else if (res && Array.isArray(res.data)) list = res.data;
        else if (res && res.data && Array.isArray(res.data.dailyPlans)) list = res.data.dailyPlans;
        else if (res && Array.isArray(res.dailyPlans)) list = res.dailyPlans;

        // Filter by active statuses: APPROVED, IN_PROGRESS
        const activePlansList = list.filter(
          (p: any) =>
            p.status === "APPROVED" ||
            p.status === "IN_PROGRESS" ||
            p.status === "STOPPED" ||
            p.status === "CANCELLED" ||
            (p.status === "COMPLETED" && p.producedQty < p.plannedQty)
        );
        setDailyPlans(activePlansList);
      })
      .catch((err) => console.error("Failed to load daily plans:", err));
  }, [isPreFilled]);

  // Handle selection of Daily Production Plan
  const handleDailyPlanSelect = (val: string) => {
    setSelectedDailyPlanId(val);
    setDailyPlanId(val);
  };

  // Unified useEffect to load plan details when dailyPlanId changes
  useEffect(() => {
    if (!dailyPlanId) {
      setActivePlan(null);
      setAvailableOperators([]);
      setOperatorId("");
      setPlanError(null);
      return;
    }

    setLoadingPlan(true);
    setPlanError(null);

    dailyPlanService
      .getById(dailyPlanId)
      .then((res: any) => {
        const plan = res.data;
        if (!plan) {
          toast.error("Daily Production Plan not found");
          setActivePlan(null);
          setAvailableOperators([]);
          setOperatorId("");
          return;
        }

        setMachineId(plan.machineId);
        setShiftId(plan.shiftId);
        setProductionDate(plan.productionDate?.split("T")[0]);

        if (!plan.operators || plan.operators.length === 0) {
          setAvailableOperators([]);
          setOperatorId("");
          setPlanError("The selected Daily Production Plan does not have an assigned operator.");
        } else {
          setAvailableOperators(plan.operators);
          // Reset manual-selection flag since this is a plan change (new context)
          userSelectedOperator.current = false;
          // Only auto-select if there's exactly one operator (no choice to make).
          // If multiple operators exist, leave blank so user must explicitly select.
          if (plan.operators.length === 1) {
            setOperatorId(plan.operators[0].id.toString());
          } else {
            setOperatorId("");
          }
          setPlanError(null);
        }

        setActivePlan({
          productionOrderId: plan.productionOrderId,
          productName: plan.productionOrder?.productItem?.productName || "Unknown Product",
          productCode: plan.productionOrder?.productItem?.productCode || "",
          plannedQty: plan.plannedQty,
          uom:
            (plan.productionOrder?.productItem?.uom?.uomCode?.toUpperCase() === "EA"
              ? "PCS"
              : plan.productionOrder?.productItem?.uom?.uomCode?.toUpperCase()) || "PCS",
          weeklyProgramId: plan.weeklyProgramId,
          productId: plan.productionOrder?.productItemId
            ? Number(plan.productionOrder.productItemId)
            : null,
          // Production order level data for carry-forward guard
          poTargetQty: Number(plan.productionOrder?.targetQty || 0),
          poProducedQty: Number(plan.productionOrder?.producedQty || 0),
          poStatus: plan.productionOrder?.status || "",
        });
      })
      .catch((err: any) => {
        console.error("Failed to fetch daily plan:", err);
        toast.error("Failed to load daily plan details");
        setActivePlan(null);
        setAvailableOperators([]);
        setOperatorId("");
      })
      .finally(() => {
        setLoadingPlan(false);
      });
  }, [dailyPlanId]);

  // Handle pre-filled state
  useEffect(() => {
    if (locationState.state && locationState.state.productionOrderId) {
      const s = locationState.state;
      setMachineId(s.machineId || "");
      setProductionDate(s.productionDate || formatLocalDateString(new Date()));
      setShiftId(s.shiftId || "");
      if (s.dailyPlanId) {
        setDailyPlanId(s.dailyPlanId);
      }
      if (s.hourIndex) {
        setHourIndex(String(s.hourIndex));
      }
      if (s.editingLogId) {
        setEditingLogId(s.editingLogId);
        setHourIndex(s.hourIndex || "1");
        setQtyProduced(s.qtyProduced || "");
        setRejectQty(s.rejectQty || "0");
        setScrapQty(s.scrapQty || "0");
        setDowntime(s.downtime?.toString() || "0");
        setRemarks(s.remarks || "");
        setDowntimeReason(s.downtimeReason || "");
        setRejectReason(s.rejectReason || "");
        setScrapReason(s.scrapReason || "");
        setOperatorId(s.operatorId || "");
      }
    }
  }, [locationState.state]);

  // State for existing logs to prevent duplicates and enable editing
  const [existingLogs, setExistingLogs] = useState<any[]>([]);

  const fetchExistingLogs = useCallback(async () => {
    if (!machineId || !productionDate || !shiftId) {
      setExistingLogs([]);
      return;
    }
    try {
      const response = await apiClient.get(config.hourlyProduction.base, {
        params: {
          machineId,
          shiftId,
          productionDate,
        },
      });
      if (response.data?.success) {
        setExistingLogs(response.data.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch existing hourly logs", err);
    }
  }, [machineId, productionDate, shiftId]);

  useEffect(() => {
    fetchExistingLogs();
  }, [fetchExistingLogs]);

  // When the user switches to a different hour, reset the manual-selection flag and
  // clear the operator field so each hour starts with a fresh pick.
  useEffect(() => {
    userSelectedOperator.current = false;
    setOperatorId("");
  }, [hourIndex]);

  // Track chosen hour index to load/edit existing production values
  useEffect(() => {
    const matched = existingLogs.find(
      (log) => Number(log.hourIndex) === Number(hourIndex) && log.dailyPlanId === dailyPlanId
    );
    if (matched) {
      setQtyProduced(String(matched.qtyProduced));
      setRejectQty(String(matched.rejectQty || 0));
      setScrapQty(String(matched.scrapQty || 0));
      setDowntime(String(matched.downtime || 0));
      setRemarks(matched.remarks || "");
      setDowntimeReason(matched.downtimeReason || "");

      // Only load operator from saved log if user has NOT manually picked someone yet.
      // Once the user selects an operator, their choice is locked in for this hour.
      if (matched.operatorId && !userSelectedOperator.current) {
        setOperatorId(matched.operatorId);
      }

      setEditingLogId(matched.hourlyProductionId);

      // Load existing wastages if available on this log
      if (
        matched.productionWastages &&
        Array.isArray(matched.productionWastages) &&
        matched.productionWastages.length > 0
      ) {
        setWastages(
          matched.productionWastages.map((w: any) => ({
            storeId: w.storeId || "",
            targetWastageProductId: w.targetWastageProductId || "",
            quantity: String(w.quantity || ""),
            uom: w.uom || "KG",
            selectedUom: w.uom || "KG",
            storeError: "",
            productError: "",
            quantityError: "",
          }))
        );
      } else {
        setWastages([]);
      }
      setRawMaterialsUsed([]);
    } else {
      setQtyProduced("0");
      setRejectQty("0");
      setScrapQty("0");
      setDowntime("0");
      setRemarks("");
      setDowntimeReason("");
      // operatorId is already cleared by the hourIndex effect above
      setEditingLogId(null);
      setWastages([]);
      setRawMaterialsUsed([]);
    }
  }, [hourIndex, existingLogs]);

  // Shift timing for hour slots generation
  const shiftTiming = useMemo(() => {
    if (locationState.state?.startTime && locationState.state?.endTime) {
      return {
        startTime: locationState.state.startTime,
        endTime: locationState.state.endTime,
      };
    }
    const selectedShift = shifts.find((s: any) => s.shiftCode === shiftId);
    if (selectedShift) {
      return {
        startTime: selectedShift.startTime,
        endTime: selectedShift.endTime,
      };
    }
    return null;
  }, [locationState.state, shifts, shiftId]);

  const hourOptions = useMemo(() => {
    let baseOptions: { label: string; value: string; disabled?: boolean }[];
    if (!shiftTiming?.startTime || !shiftTiming?.endTime) {
      baseOptions = Array.from({ length: 24 }, (_, i) => ({
        label: `Hour ${i + 1}`,
        value: String(i + 1),
      }));
    } else {
      const [startH, startM] = shiftTiming.startTime.split(":").map(Number);
      const [endH, endM] = shiftTiming.endTime.split(":").map(Number);

      const startMinutes = startH * 60 + startM;
      let endMinutes = endH * 60 + endM;

      if (endMinutes <= startMinutes) {
        endMinutes += 24 * 60;
      }

      const totalMinutes = endMinutes - startMinutes;
      const hours = Math.floor(totalMinutes / 60);

      baseOptions = Array.from({ length: hours }, (_, i) => ({
        label: `Hour ${i + 1}`,
        value: String(i + 1),
      }));
    }

    const filledIndices = existingLogs.map((log) => Number(log.hourIndex));
    const maxFilled = filledIndices.length > 0 ? Math.max(...filledIndices) : 0;
    const nextRequiredHour = maxFilled + 1;
    const limit = activePlan?.plannedHours ? Number(activePlan.plannedHours) : baseOptions.length;

    return baseOptions.map((opt) => {
      const optNum = Number(opt.value);
      const isEditingThisOne = existingLogs.some(
        (log) =>
          String(log.hourIndex) === opt.value &&
          String(log.hourlyProductionId) === String(editingLogId)
      );

      let disabled = true;
      if (isEditingThisOne) {
        disabled = false;
      } else if (optNum === nextRequiredHour && optNum <= limit) {
        disabled = false;
      }

      return {
        ...opt,
        disabled,
      };
    });
  }, [shiftTiming, existingLogs, editingLogId, activePlan]);

  const isFinalHour = hourOptions.length > 0 && Number(hourIndex) === hourOptions.length;

  // Auto-select the next available hour if the currently selected one is disabled
  useEffect(() => {
    if (!hourOptions || hourOptions.length === 0) return;
    const selectedOption = hourOptions.find((opt) => opt.value === hourIndex);
    if (!selectedOption || selectedOption.disabled) {
      const firstAvailable = hourOptions.find((opt) => !opt.disabled);
      if (firstAvailable && firstAvailable.value !== hourIndex) {
        setHourIndex(firstAvailable.value);
      }
    }
  }, [hourOptions, hourIndex]);

  const handleClear = () => {
    if (!isPreFilled) {
      setMachineId("");
      setShiftId("");
      setProductionDate(formatLocalDateString(new Date()));
      setSelectedDailyPlanId("");
      setDailyPlanId("");
    }
    setWastages([]);
    setStopPlanEarly(false);
    setStopPlanReason("");
    setStopOption("CARRY_FORWARD");
    setHourIndex("1");
    setQtyProduced("");
    setRejectQty("0");
    setScrapQty("0");
    setDowntime("0");
    setRemarks("");
    setOperatorId("");
    if (!isPreFilled) {
      setActivePlan(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});

    // Collect ALL errors in one pass
    const errors: Record<string, string> = {};

    if (!hourIndex) errors.hourIndex = "Hour index is required";
    if (!operatorId) errors.operatorId = "Operator is required";
    if (!qtyProduced || Number(qtyProduced) <= 0)
      errors.qtyProduced = "Produced quantity must be greater than 0";
    if (Number(downtime) > 0 && !downtimeReason)
      errors.downtimeReason = "Please select a downtime reason";
    if (Number(rejectQty) > 0 && !rejectReason)
      errors.rejectReason = "Please select a reject reason";
    if (Number(scrapQty) > 0 && !scrapReason) errors.scrapReason = "Please select a scrap reason";
    if (
      (downtimeReason === "Others" || rejectReason === "Others" || scrapReason === "Others") &&
      !remarks?.trim()
    ) {
      errors.remarks = "Please provide a reason";
    }

    // Stop plan reason validation (same pass)
    if (stopPlanEarly && !stopPlanReason.trim()) {
      errors.stopPlanReason = "Reason for stopping is required";
    }

    // Wastage validation
    const isLastHour = hourOptions.length > 0 && Number(hourIndex) === hourOptions.length;
    if (isLastHour && !stopPlanEarly && wastages.length === 0) {
      errors.logWastage = "Please add at least one wastage product for the final hourly entry";
    }

    let updatedWastages = wastages;
    let hasWastageError = false;
    if (wastages.length > 0) {
      const normalizedWastages = wastages.map((w) => ({
        ...w,
        storeError: !w.storeId ? "Store is required" : "",
        productError: !w.targetWastageProductId ? "Product is required" : "",
        quantityError: Number(w.quantity) > 0 ? "" : "Quantity must be greater than 0",
      }));
      hasWastageError = normalizedWastages.some(
        (w) => w.storeError || w.productError || w.quantityError
      );
      if (hasWastageError) updatedWastages = normalizedWastages;
    }

    let updatedRawMaterials = rawMaterialsUsed;
    let hasRawMaterialError = false;
    if (rawMaterialsUsed.length > 0) {
      const normalizedRM = rawMaterialsUsed.map((rm) => ({
        ...rm,
        storeError: !rm.storeId ? "Store is required" : "",
        productError: !rm.rawMaterialId ? "Raw Material is required" : "",
        quantityError: Number(rm.quantity) > 0 ? "" : "Quantity must be greater than 0",
      }));
      hasRawMaterialError = normalizedRM.some(
        (rm) => rm.storeError || rm.productError || rm.quantityError
      );
      if (hasRawMaterialError) updatedRawMaterials = normalizedRM;
    }

    // Show all errors at once and stop
    if (Object.keys(errors).length > 0 || hasWastageError || hasRawMaterialError) {
      setFormErrors(errors);
      if (hasWastageError) setWastages(updatedWastages);
      if (hasRawMaterialError) setRawMaterialsUsed(updatedRawMaterials);
      return;
    }

    // Non-field checks (toast only)
    if (planError) {
      toast.error(planError);
      return;
    }
    if (!activePlan) {
      toast.error("Cannot save: No active Daily Plan loaded.");
      return;
    }

    setIsSubmitting(true);
    try {
      const numReject = Math.round(Number(rejectQty) || 0);
      const numScrap = Math.round(Number(scrapQty) || 0);
      const numProduced = Math.round(Number(qtyProduced) || 0);

      const payload = {
        productionOrderId: activePlan.productionOrderId,
        productionDate,
        shiftId,
        machineId,
        hourIndex: Number(hourIndex),
        qtyProduced: numProduced,
        rejectQty: numReject,
        scrapQty: numScrap,
        downtime: Number(downtime) || 0,
        remarks: remarks.trim() || undefined,
        downtimeReason: Number(downtime) > 0 ? downtimeReason : undefined,
        rejectReason: numReject > 0 ? rejectReason : undefined,
        scrapReason: numScrap > 0 ? scrapReason : undefined,
        operatorId: operatorId,
        stopPlanEarly,
        stopPlanReason: stopPlanEarly ? stopPlanReason : null,
        logWastage: (isFinalHour || stopPlanEarly) && wastages.length > 0,
        wastages:
          isFinalHour || stopPlanEarly
            ? wastages.map((w) => {
                const matched = rawMaterials.find(
                  (r: any) => r.rawMaterialId === w.targetWastageProductId
                );
                let baseUomStr = matched?.baseUom || "kg";
                if (Array.isArray(matched?.baseUom)) baseUomStr = matched.baseUom.join(",");
                else if (typeof matched?.baseUom === "string" && matched.baseUom.startsWith("[")) {
                  try {
                    baseUomStr = JSON.parse(matched.baseUom).join(",");
                  } catch (e) {}
                }
                const primaryUom = baseUomStr.split(",")[0] || "kg";
                const selectedUom = w.selectedUom || primaryUom;
                // Send the raw user-entered quantity + selectedUom.
                // The backend will do the actual conversion to primaryUom.
                return {
                  storeId: w.storeId,
                  targetWastageProductId: w.targetWastageProductId,
                  quantity: Number(w.quantity) || 0,
                  selectedUom,
                };
              })
            : [],
        rawMaterialsUsed:
          isFinalHour || stopPlanEarly
            ? rawMaterialsUsed.map((rm) => {
                const matched = rawMaterialOptions.find(
                  (r: any) => r.rawMaterialId === rm.rawMaterialId
                );
                const baseUomStr = matched?.baseUom || rm.uom || "kg";
                const primaryUom = baseUomStr.split(",")[0] || "kg";
                // Use selectedUom (user's chosen unit), fall back to primary UOM.
                const selectedUom = rm.selectedUom || primaryUom;
                // Send raw user-entered quantity + selectedUom; backend does conversion.
                return {
                  storeId: rm.storeId,
                  rawMaterialId: rm.rawMaterialId,
                  quantity: Number(rm.quantity) || 0,
                  selectedUom,
                };
              })
            : [],
        dailyPlanId: dailyPlanId || undefined,
      };

      let res: any;
      if (editingLogId) {
        res = await dispatch(
          updateHourlyProduction({ id: String(editingLogId), data: payload })
        ).unwrap();
        toast.success("Hourly Production entry updated successfully!");
      } else {
        res = await dispatch(createHourlyProduction(payload)).unwrap();
        toast.success("Hourly Production entry saved successfully!");
      }
      // Handle Stop Plan Early
      if (stopPlanEarly && dailyPlanId) {
        try {
          // CARRY_FORWARD → STOPPED: daily plan stops, PO stays open, remaining qty can be
          //   carried forward to a new daily plan from the Daily Planning page.
          // FORCE_COMPLETE → POST_PRODUCTION + shortClosePO: true: PO is permanently locked
          //   (COMPLETED_WITH_SHORTFALL), all other active plans cascade-stopped, produced
          //   qty flows immediately into post-production → dispatch.
          const isCompleteStop = stopOption === "FORCE_COMPLETE";
          const stopStatus = isCompleteStop ? "POST_PRODUCTION" : "STOPPED";
          const remarksPrefix = isCompleteStop ? "Permanently Stopped" : "Short Closed";
          const stopRemarks = activePlan?.remarks
            ? `${activePlan.remarks} | ${remarksPrefix}: ${stopPlanReason.trim()}`
            : `${remarksPrefix}: ${stopPlanReason.trim()}`;

          const stopPayload: any = {
            status: stopStatus,
            remarks: stopRemarks,
            plannedHours: Number(hourIndex),
          };
          if (isCompleteStop) {
            stopPayload.shortClosePO = true;
          }

          await apiClient.put(`/daily-production-plans/${dailyPlanId}`, stopPayload);
          toast.success(
            isCompleteStop
              ? "Production permanently stopped. Proceeding to post-production."
              : "Production stopped. You can carry forward the remaining quantity from the planning page."
          );
        } catch (err: any) {
          console.error("Failed to stop production plan early", err);
          toast.error(err?.response?.data?.message || "Failed to stop production plan early");
        }
      }

      const dataObj = res?.data || res;
      if (dataObj?.newHighReached) {
        setNewHighDetails(dataObj.newHighDetails);
        setShowNewHighModal(true);
      } else {
        navigate("/daily-machine-planning");
      }
    } catch (err: any) {
      toast.error(err || "Failed to log hourly production");
    } finally {
      setIsSubmitting(false);
    }
  };

  const shiftProducedQty = existingLogs
    .filter((log) => log.dailyPlanId === dailyPlanId && Number(log.hourIndex) > 0)
    .reduce(
      (sum, log) =>
        sum +
        Math.max(
          0,
          Number(log.qtyProduced || 0) - Number(log.rejectQty || 0) - Number(log.scrapQty || 0)
        ),
      0
    );

  const remainingQtyForShift = activePlan
    ? Math.max(0, Number(activePlan.plannedQty || 0) - shiftProducedQty)
    : 0;

  const planLimit = activePlan?.plannedHours ? Number(activePlan.plannedHours) : 0;
  const filledHourIndices = existingLogs.map((log) => Number(log.hourIndex));
  const maxFilledHour = filledHourIndices.length > 0 ? Math.max(...filledHourIndices) : 0;
  const isNewLogBlocked = planLimit > 0 && maxFilledHour + 1 > planLimit && !editingLogId;
  const machineLabel =
    machines.find((m: any) => m.machineId === machineId)?.machineName || machineId || "—";
  const shiftLabel = shifts.find((s: any) => s.shiftCode === shiftId)?.shiftName || shiftId || "—";
  const bigNumberClass = "h-14 text-center text-[20px] font-bold tabular-nums";

  return (
    <PageBody className="sl-page-form">
      <PageHeader
        title="Hourly Production Entry"
        subtitle={
          activePlan
            ? `${activePlan.productionOrderId} · ${activePlan.productName}`
            : "Pick the daily plan, then log what the machine made this hour."
        }
        back="/daily-machine-planning"
        backLabel="Back to Planning"
        breadcrumbs={[
          { label: "Daily planning", to: "/daily-machine-planning" },
          { label: editingLogId ? "Edit hourly entry" : "Log hour" },
        ]}
      />
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {planError && (
          <div
            role="alert"
            className="sl-tile flex items-start gap-3 p-4"
            style={{ boxShadow: "inset 4px 0 0 var(--color-danger)" }}
          >
            <AlertTriangle
              size={20}
              className="mt-0.5 shrink-0 text-[color:var(--color-danger)]"
              aria-hidden="true"
            />
            <div>
              <p className="m-0 text-sm font-bold text-[color:var(--color-danger)]">
                Plan Verification Failed
              </p>
              <p className="m-0 text-sm text-ink-muted">{planError}</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Left Side: Plan Details */}
          <Tile title="Plan Details" className="self-start lg:sticky lg:top-4 lg:col-span-4">
            <div>
              <div className="flex flex-col gap-4">
                {/* Daily Production Plan dropdown when not prefilled */}
                {!isPreFilled ? (
                  <div>
                    <SelectInput
                      label="Daily Production Plan"
                      name="selectedDailyPlanId"
                      value={selectedDailyPlanId}
                      required
                      options={dailyPlans.map((dp) => ({
                        label: `${dp.dailyPlanId} — PO: ${dp.productionOrderId} — Date: ${dp.productionDate?.split("T")[0]} — Machine: ${dp.machineId} — Shift: ${dp.shiftId}`,
                        value: dp.dailyPlanId,
                      }))}
                      onChange={(e) => handleDailyPlanSelect(e.target.value)}
                      defaultOptionLabel="— Select Daily Production Plan —"
                    />
                  </div>
                ) : (
                  <div>
                    <TextInput
                      label="Daily Production Plan ID"
                      name="dailyPlanId"
                      value={dailyPlanId || ""}
                      disabled
                    />
                  </div>
                )}

                <dl className="m-0 grid grid-cols-2 gap-4 rounded-[14px] bg-card-2 p-4 lg:grid-cols-1">
                  <InfoItem label="Machine" value={machineLabel} />
                  <InfoItem
                    label="Production Date"
                    value={productionDate ? formatDate(productionDate) : "—"}
                  />
                  <InfoItem label="Shift" value={shiftLabel} />
                </dl>
              </div>
            </div>
          </Tile>

          {/* Right Side: Active Plan + Hourly Entry Log */}
          <div className="flex flex-col gap-5 lg:col-span-8">
            {/* Active plan: the big figures */}
            {loadingPlan ? (
              <SkeletonTile lines={2} label="Loading active plan..." />
            ) : activePlan ? (
              <Tile>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Chip size="sm" tone="success" icon={<CheckCircle2 size={13} />}>
                      Active plan loaded
                    </Chip>
                    <p className="m-0 mt-2 text-[17px] font-bold leading-tight text-ink">
                      {activePlan.productName}
                    </p>
                    <p className="sl-muted m-0 font-mono text-[13px]">
                      {activePlan.productionOrderId}
                      {activePlan.productCode ? ` · ${activePlan.productCode}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 rounded-[16px] bg-card-2 p-4">
                  <Figure size="lg" label="Target" value={formatQty(activePlan.plannedQty)} />
                  <Figure
                    size="lg"
                    label="Produced"
                    tone="success"
                    value={formatQty(shiftProducedQty)}
                  />
                  <Figure
                    size="lg"
                    label="Remaining"
                    tone="warning"
                    value={formatQty(remainingQtyForShift)}
                  />
                </div>
              </Tile>
            ) : (
              <div
                role="status"
                className="sl-tile flex items-center gap-3 p-4 text-sm font-medium text-[color:var(--color-warning)]"
              >
                <Info size={18} className="shrink-0" aria-hidden="true" />
                No active plan. Select a valid Daily Production Plan to begin.
              </div>
            )}

            <Tile title="Hourly Entry Log" subtitle="Good pieces, rejects and scrap for this hour.">
              <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
                <div className="flex flex-col">
                  <SelectInput
                    label="Hour index of Shift"
                    name="hourIndex"
                    value={hourIndex}
                    options={hourOptions}
                    required
                    error={formErrors.hourIndex}
                    onChange={(e) => {
                      setHourIndex(e.target.value);
                      setFormErrors((prev) => ({ ...prev, hourIndex: "" }));
                    }}
                  />
                  {(() => {
                    const limit = activePlan?.plannedHours ? Number(activePlan.plannedHours) : 0;
                    const filledIndices = existingLogs.map((log) => Number(log.hourIndex));
                    const maxFilled = filledIndices.length > 0 ? Math.max(...filledIndices) : 0;
                    const nextRequiredHour = maxFilled + 1;

                    if (
                      limit > 0 &&
                      nextRequiredHour > limit &&
                      limit < hourOptions.length &&
                      !editingLogId
                    ) {
                      return (
                        <div className="mt-2 rounded-[12px] bg-card-2 p-3 text-[13px] text-[color:var(--color-warning)]">
                          <strong>Plan Completed:</strong> {limit} hours planned and logged.
                          Remaining shift hours can be allocated to a new plan.
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
                <div>
                  <SelectInput
                    label="Operator"
                    name="operatorId"
                    value={operatorId}
                    required
                    error={
                      formErrors.operatorId ||
                      (planError && planError.includes("operator") ? planError : undefined)
                    }
                    disabled={loadingPlan || availableOperators.length === 0}
                    defaultOptionLabel={loadingPlan ? "Loading operator..." : "— Select Operator —"}
                    options={availableOperators.map((op) => ({
                      value: op.id.toString(),
                      label: op.fullName,
                    }))}
                    onChange={(e: any) => {
                      userSelectedOperator.current = true;
                      setOperatorId(e.target.value);
                      setFormErrors((prev) => ({ ...prev, operatorId: "" }));
                    }}
                  />
                </div>
                <div>
                  <TextInput
                    label="Produced Qty"
                    name="qtyProduced"
                    value={qtyProduced}
                    type="number"
                    inputMode="numeric"
                    inputClassName={bigNumberClass}
                    step="1"
                    required
                    placeholder="Enter produced amount"
                    error={formErrors.qtyProduced}
                    onChange={(e) => {
                      setQtyProduced(e.target.value);
                      setFormErrors((prev) => ({ ...prev, qtyProduced: "" }));
                    }}
                  />
                </div>
                <div>
                  <TextInput
                    label="Reject Qty"
                    name="rejectQty"
                    value={rejectQty}
                    type="number"
                    inputMode="numeric"
                    inputClassName={bigNumberClass}
                    step="1"
                    placeholder="Enter reject amount"
                    error={formErrors.rejectQty}
                    onChange={(e) => {
                      setRejectQty(e.target.value);
                      setFormErrors((prev) => ({ ...prev, rejectQty: "" }));
                    }}
                  />
                </div>
                <div>
                  <TextInput
                    label="Scrap Qty"
                    name="scrapQty"
                    value={scrapQty}
                    type="number"
                    inputMode="numeric"
                    inputClassName={bigNumberClass}
                    step="1"
                    placeholder="Enter scrap amount"
                    error={formErrors.scrapQty}
                    onChange={(e) => {
                      setScrapQty(e.target.value);
                      setFormErrors((prev) => ({ ...prev, scrapQty: "" }));
                    }}
                  />
                </div>
                <div>
                  <QuantityInput
                    label="Downtime"
                    name="downtime"
                    value={downtime}
                    baseUoms="mins,hrs"
                    error={formErrors.downtime}
                    onChange={(e) => {
                      setDowntime(e.target.value);
                      setFormErrors((prev) => ({ ...prev, downtime: "" }));
                    }}
                  />
                </div>
                {Number(downtime) > 0 && (
                  <div>
                    <SelectInput
                      label="Downtime Reason"
                      name="downtimeReason"
                      value={downtimeReason}
                      error={formErrors.downtimeReason}
                      onChange={(e) => {
                        setDowntimeReason(e.target.value);
                        setFormErrors((prev) => ({ ...prev, downtimeReason: "" }));
                      }}
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
                  </div>
                )}
                {Number(rejectQty) > 0 && (
                  <div>
                    <SelectInput
                      label="Reject Reason"
                      name="rejectReason"
                      value={rejectReason}
                      error={formErrors.rejectReason}
                      onChange={(e) => {
                        setRejectReason(e.target.value);
                        setFormErrors((prev) => ({ ...prev, rejectReason: "" }));
                      }}
                      options={[
                        { value: "Quality Issue", label: "Quality Issue" },
                        { value: "Machine Defect", label: "Machine Defect" },
                        { value: "Material Defect", label: "Material Defect" },
                        { value: "Operator Error", label: "Operator Error" },
                        { value: "Others", label: "Others" },
                      ]}
                    />
                  </div>
                )}
                {Number(scrapQty) > 0 && (
                  <div>
                    <SelectInput
                      label="Scrap Reason"
                      name="scrapReason"
                      value={scrapReason}
                      error={formErrors.scrapReason}
                      onChange={(e) => {
                        setScrapReason(e.target.value);
                        setFormErrors((prev) => ({ ...prev, scrapReason: "" }));
                      }}
                      options={[
                        { value: "Startup Scrap", label: "Startup Scrap" },
                        { value: "Process Setting", label: "Process Setting" },
                        { value: "Material Purging", label: "Material Purging" },
                        { value: "Others", label: "Others" },
                      ]}
                    />
                  </div>
                )}
                {(downtimeReason === "Others" ||
                  rejectReason === "Others" ||
                  scrapReason === "Others") && (
                  <div>
                    <TextInput
                      label="Remarks (Reason for Others)"
                      name="remarks"
                      value={remarks}
                      required
                      placeholder="Enter specific reason"
                      error={formErrors.remarks}
                      onChange={(e) => {
                        setRemarks(e.target.value);
                        setFormErrors((prev) => ({ ...prev, remarks: "" }));
                      }}
                    />
                  </div>
                )}
              </div>
            </Tile>
          </div>
        </div>

        {/* Stop Section — full width */}
        {hourOptions.length > 0 && dailyPlanId && (
          <Tile>
            <Form.Check
              type="switch"
              id="stop-plan-early-switch"
              label={
                <span className="ml-3 text-[15px] font-semibold text-[color:var(--color-danger)]">
                  {Number(hourIndex) === hourOptions.length
                    ? "Permanently Stop this Production Order"
                    : "Stop Production Plan after this hour"}
                </span>
              }
              checked={stopPlanEarly}
              onChange={(e) => {
                setStopPlanEarly(e.target.checked);
                if (!e.target.checked) {
                  setFormErrors((prev) => ({ ...prev, stopPlanReason: "" }));
                }
                // Final hour stop is always a Complete Stop — lock the PO
                if (Number(hourIndex) === hourOptions.length) {
                  setStopOption("FORCE_COMPLETE");
                }
              }}
            />
            {stopPlanEarly && (
              <div className="mt-4 flex w-full flex-col gap-4 rounded-[16px] bg-card-2 p-4">
                <div className="w-full">
                  <TextInput
                    label="Reason for Stopping"
                    name="stopPlanReason"
                    value={stopPlanReason}
                    required
                    placeholder="e.g. Target not met — permanently closing this PO"
                    error={formErrors.stopPlanReason}
                    onChange={(e) => {
                      setStopPlanReason(e.target.value);
                      setFormErrors((prev) => ({ ...prev, stopPlanReason: "" }));
                    }}
                    width="100%"
                  />
                </div>

                {/* Non-final hour: let user choose between Complete Stop and Carry Forward */}
                {Number(hourIndex) < hourOptions.length && (
                  <div className="w-full">
                    <span className="sl-label">
                      Stop Action Type
                      <span className="sl-required" aria-hidden="true">
                        *
                      </span>
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                      <div
                        className={`flex min-h-[64px] cursor-pointer flex-col rounded-[14px] border bg-card p-3 transition-colors ${
                          stopOption === "FORCE_COMPLETE"
                            ? "border-[color:var(--color-danger)] ring-2 ring-[color:var(--color-danger)]/20"
                            : "border-line hover:bg-card-2"
                        }`}
                        onClick={() => setStopOption("FORCE_COMPLETE")}
                      >
                        <div className="flex items-center gap-2 font-semibold text-ink text-sm">
                          <input
                            type="radio"
                            name="stopOption"
                            checked={stopOption === "FORCE_COMPLETE"}
                            onChange={() => setStopOption("FORCE_COMPLETE")}
                            className="sl-check"
                          />
                          Completed Stop
                        </div>
                        <span className="mt-1 pl-6 text-[12px] text-ink-subtle">
                          Stop production without carrying forward any quantity.
                        </span>
                      </div>

                      <div
                        className={`flex min-h-[64px] cursor-pointer flex-col rounded-[14px] border bg-card p-3 transition-colors ${
                          stopOption === "CARRY_FORWARD"
                            ? "border-[color:var(--color-warning)] ring-2 ring-[color:var(--color-warning)]/20"
                            : "border-line hover:bg-card-2"
                        }`}
                        onClick={() => setStopOption("CARRY_FORWARD")}
                      >
                        <div className="flex items-center gap-2 font-semibold text-ink text-sm">
                          <input
                            type="radio"
                            name="stopOption"
                            checked={stopOption === "CARRY_FORWARD"}
                            onChange={() => setStopOption("CARRY_FORWARD")}
                            className="sl-check"
                          />
                          Stop & Carry Forward
                        </div>
                        <span className="mt-1 pl-6 text-[12px] text-ink-subtle">
                          Carry forward the remaining{" "}
                          <strong>
                            {Math.max(0, remainingQtyForShift - (Number(qtyProduced) || 0))} pcs
                          </strong>{" "}
                          to a new daily plan.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Final hour: always Complete Stop — just show info */}
                {Number(hourIndex) === hourOptions.length && (
                  <div className="rounded-[12px] bg-card p-3 text-[13px] leading-relaxed text-[color:var(--color-danger)]">
                    <strong>Complete Stop:</strong> The Production Order will be permanently locked.
                    No new daily plans can be created for this PO. All produced quantity will
                    proceed to post-production and dispatch.
                  </div>
                )}
              </div>
            )}
          </Tile>
        )}

        {hourOptions.length > 0 && (Number(hourIndex) === hourOptions.length || stopPlanEarly) && (
          <Tile>
            {/* Info Banner */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Chip tone="warning" size="sm">
                {stopPlanEarly ? "Log Wastage (Optional)" : "Final Hour — Log Wastage (Required)"}
              </Chip>
              <span className="text-[13px] font-medium text-ink-muted">
                {stopPlanEarly
                  ? "Add rows below only if wastage occurred."
                  : "At least one wastage entry is required."}
              </span>
            </div>

            {/* Wastage error (when final hour + no rows) */}
            {formErrors.logWastage && (
              <p role="alert" className="sl-field-error m-0 mb-3">
                {formErrors.logWastage}
              </p>
            )}

            {/* Wastage Table — always shown (no checkbox) */}
            <div className="mt-2">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="sl-h2 m-0 leading-tight">
                  Wastage Products
                  {!stopPlanEarly && (
                    <span className="text-[color:var(--color-danger)] ml-1">*</span>
                  )}
                  {stopPlanEarly && (
                    <span className="ml-2 text-xs font-normal text-ink-subtle">(optional)</span>
                  )}
                </h2>
                <ActionPill
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={15} />}
                  onClick={() => {
                    setFormErrors((prev) => ({ ...prev, logWastage: "" }));
                    setWastages([
                      ...wastages,
                      {
                        storeId: "",
                        targetWastageProductId: "",
                        quantity: "",
                        uom: "",
                        selectedUom: "",
                        storeError: "",
                        productError: "",
                        quantityError: "",
                      },
                    ]);
                  }}
                >
                  Add Wastage Product
                </ActionPill>
              </div>

              {wastages.length === 0 ? (
                <div className="rounded-[14px] bg-card-2 py-8 text-center text-sm font-medium text-ink-subtle">
                  {stopPlanEarly
                    ? "No wastage products added. Click '+ Add Wastage Product' if needed."
                    : "No wastage products added yet. Click '+ Add Wastage Product' to add one."}
                </div>
              ) : (
                <div className="mt-3 overflow-visible rounded-[14px] border border-line-soft">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-line-soft">
                          <th className="sl-th bg-card-2 px-4 py-3 min-w-[160px]">
                            Store{" "}
                            <span className="sl-required" aria-hidden="true">
                              *
                            </span>
                          </th>
                          <th className="sl-th bg-card-2 px-4 py-3 min-w-[220px]">
                            Wastage Product{" "}
                            <span className="sl-required" aria-hidden="true">
                              *
                            </span>
                          </th>
                          <th className="sl-th bg-card-2 px-4 py-3 min-w-[180px]">
                            Quantity{" "}
                            <span className="sl-required" aria-hidden="true">
                              *
                            </span>
                          </th>
                          <th className="sl-th bg-card-2 px-4 py-3 text-center w-[80px]">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line-soft">
                        {wastages.map((w, index) => (
                          <tr key={index}>
                            <td className="px-4 py-3 align-top min-w-[160px]">
                              <SelectInput
                                label=""
                                hideLabel
                                noMargin
                                name={`storeId-${index}`}
                                value={w.storeId}
                                onChange={(e) => {
                                  const newW = [...wastages];
                                  newW[index].storeId = e.target.value;
                                  newW[index].storeError = "";
                                  newW[index].targetWastageProductId = "";
                                  newW[index].productError = "";
                                  setWastages(newW);
                                }}
                                options={[
                                  { label: "Select Store", value: "" },
                                  ...wastageStores.map((s: any) => ({
                                    label: s.storeName,
                                    value: s.storeId,
                                  })),
                                ]}
                                required
                                error={w.storeError}
                              />
                            </td>
                            <td className="px-4 py-3 align-top min-w-[220px]">
                              <SelectInput
                                label=""
                                hideLabel
                                noMargin
                                name={`targetWastageProductId-${index}`}
                                value={w.targetWastageProductId}
                                onChange={(e) => {
                                  const newW = [...wastages];
                                  newW[index].targetWastageProductId = e.target.value;
                                  newW[index].productError = "";
                                  const rm = rawMaterials.find(
                                    (r) => r.rawMaterialId === e.target.value
                                  );
                                  if (rm) {
                                    let uoms = rm.baseUom || "kg";
                                    if (Array.isArray(rm.baseUom)) uoms = rm.baseUom.join(",");
                                    else if (
                                      typeof rm.baseUom === "string" &&
                                      rm.baseUom.startsWith("[")
                                    ) {
                                      try {
                                        uoms = JSON.parse(rm.baseUom).join(",");
                                      } catch (e) {}
                                    }
                                    newW[index].uom = uoms;
                                    // Only reset selectedUom to primary if none was set yet.
                                    // This prevents overwriting the UOM the user already chose.
                                    if (!newW[index].selectedUom) {
                                      const opts = getUomOptions(uoms);
                                      newW[index].selectedUom =
                                        opts.length > 0 ? opts[0].value : "";
                                    }
                                  } else {
                                    newW[index].uom = "";
                                    newW[index].selectedUom = "";
                                  }
                                  setWastages(newW);
                                }}
                                options={[
                                  { label: "Select Product", value: "" },
                                  ...rawMaterials
                                    .filter((r: any) => {
                                      if (!w.storeId) return true;
                                      const rmStoreId = r.storeId || r.store?.storeId;
                                      return rmStoreId && String(rmStoreId) === String(w.storeId);
                                    })
                                    .map((r: any) => {
                                      const isSelectedInOtherRow = wastages.some(
                                        (otherW, otherIdx) =>
                                          otherIdx !== index &&
                                          otherW.targetWastageProductId === r.rawMaterialId
                                      );
                                      return {
                                        label: `${r.materialName} (${r.rawMaterialId})`,
                                        value: r.rawMaterialId,
                                        disabled: isSelectedInOtherRow,
                                      };
                                    }),
                                ]}
                                disabled={!w.storeId}
                                required
                                error={w.productError}
                              />
                            </td>
                            <td className="px-4 py-3 align-top min-w-[180px]">
                              <QuantityInput
                                label=""
                                hideLabel
                                name={`quantity-${index}`}
                                value={w.quantity}
                                uom={w.selectedUom || undefined}
                                onUomChange={(uomVal) => {
                                  const newW = [...wastages];
                                  newW[index].selectedUom = uomVal;
                                  setWastages(newW);
                                }}
                                onChange={(e) => {
                                  const newW = [...wastages];
                                  newW[index].quantity = e.target.value;
                                  if (e.target.uom) {
                                    newW[index].selectedUom = e.target.uom;
                                  }
                                  newW[index].quantityError = "";
                                  setWastages(newW);
                                }}
                                baseUoms={w.uom || "KG"}
                                required
                                error={w.quantityError}
                              />
                            </td>
                            <td className="px-4 py-3 align-middle text-center w-[80px]">
                              <DeleteButton
                                onClick={() => {
                                  const newW = [...wastages];
                                  newW.splice(index, 1);
                                  setWastages(newW);
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </Tile>
        )}

        {/* Returned Raw Materials */}
        {(isFinalHour || stopPlanEarly) && (
          <Tile
            title="Returned Raw Materials"
            subtitle="Log remaining raw materials returned to the warehouse."
            actions={
              <ActionPill
                size="sm"
                variant="secondary"
                icon={<Plus size={15} />}
                onClick={() => {
                  setRawMaterialsUsed([
                    ...rawMaterialsUsed,
                    {
                      storeId: "",
                      rawMaterialId: "",
                      quantity: "",
                      uom: "",
                      selectedUom: "",
                      storeError: "",
                      productError: "",
                      quantityError: "",
                    },
                  ]);
                }}
              >
                Add Raw Material
              </ActionPill>
            }
          >
            <div className="overflow-hidden rounded-[14px] border border-line-soft">
              {rawMaterialsUsed.length === 0 ? (
                <div className="bg-card-2 p-6 text-center text-sm font-medium text-ink-subtle">
                  No raw materials logged. Click '+ Add Raw Material' to add one.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-line-soft">
                        <th className="sl-th bg-card-2 px-4 py-3 min-w-[160px]">
                          Store{" "}
                          <span className="sl-required" aria-hidden="true">
                            *
                          </span>
                        </th>
                        <th className="sl-th bg-card-2 px-4 py-3 min-w-[220px]">
                          Raw Material{" "}
                          <span className="sl-required" aria-hidden="true">
                            *
                          </span>
                        </th>
                        <th className="sl-th bg-card-2 px-4 py-3 min-w-[180px]">
                          Quantity{" "}
                          <span className="sl-required" aria-hidden="true">
                            *
                          </span>
                        </th>
                        <th className="sl-th bg-card-2 px-4 py-3 text-center w-[80px]">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line-soft">
                      {rawMaterialsUsed.map((rm, index) => (
                        <tr key={`rm-${index}`}>
                          <td className="px-4 py-3 align-top min-w-[160px]">
                            <SelectInput
                              hideLabel={true}
                              noMargin
                              name={`rm-store-${index}`}
                              value={rm.storeId}
                              options={[
                                { value: "", label: "-- Select Store --" },
                                ...rawMaterialStores.map((s: any) => ({
                                  value: s.storeId,
                                  label: s.storeName || s.storeId,
                                })),
                              ]}
                              onChange={(e) => {
                                const newRm = [...rawMaterialsUsed];
                                newRm[index].storeId = e.target.value;
                                newRm[index].storeError = "";
                                newRm[index].rawMaterialId = ""; // Reset raw material when store changes
                                setRawMaterialsUsed(newRm);
                              }}
                              error={rm.storeError}
                            />
                          </td>
                          <td className="px-4 py-3 align-top min-w-[220px]">
                            <SelectInput
                              hideLabel={true}
                              name={`rm-id-${index}`}
                              value={rm.rawMaterialId}
                              options={[
                                { value: "", label: "-- Select Raw Material --" },
                                ...rawMaterialOptions
                                  .filter((r: any) => {
                                    if (r.itemType === "WASTAGE") return false;
                                    if (r.store?.storeCategory === "WASTAGE") return false;
                                    if (r.store?.storeName?.toLowerCase().includes("wastage"))
                                      return false;
                                    if (r.category?.categoryName?.toLowerCase().includes("wastage"))
                                      return false;
                                    if (r.materialName?.toLowerCase().startsWith("wastage"))
                                      return false;
                                    return rm.storeId
                                      ? String(r.storeId) === String(rm.storeId)
                                      : true;
                                  })
                                  .map((r: any) => {
                                    const isSelectedInOtherRow = rawMaterialsUsed.some(
                                      (otherRm, otherIdx) =>
                                        otherIdx !== index &&
                                        otherRm.rawMaterialId === r.rawMaterialId
                                    );
                                    return {
                                      value: r.rawMaterialId,
                                      label: `${r.rawMaterialId} - ${r.materialName}`,
                                      disabled: isSelectedInOtherRow,
                                    };
                                  }),
                              ]}
                              onChange={(e) => {
                                const newRm = [...rawMaterialsUsed];
                                newRm[index].rawMaterialId = e.target.value;
                                newRm[index].productError = "";
                                const matchedRm = rawMaterialOptions.find(
                                  (r: any) => r.rawMaterialId === e.target.value
                                );
                                if (matchedRm) {
                                  const base = matchedRm.baseUom || "";
                                  newRm[index].uom = base;
                                  const opts = getUomOptions(base);
                                  // Only reset selectedUom if it's empty or not valid for this product's UOM list.
                                  const currentSelected = newRm[index].selectedUom || "";
                                  const isValidForProduct = opts.some(
                                    (o) => o.value === currentSelected
                                  );
                                  if (!currentSelected || !isValidForProduct) {
                                    newRm[index].selectedUom = opts.length > 0 ? opts[0].value : "";
                                  }
                                } else {
                                  newRm[index].uom = "";
                                  newRm[index].selectedUom = "";
                                }
                                setRawMaterialsUsed(newRm);
                              }}
                              error={rm.productError}
                            />
                          </td>
                          <td className="px-4 py-3 align-top min-w-[180px]">
                            <QuantityInput
                              label=""
                              hideLabel
                              name={`rm-qty-${index}`}
                              value={rm.quantity}
                              uom={rm.selectedUom || undefined}
                              onUomChange={(uomVal) => {
                                const newRm = [...rawMaterialsUsed];
                                newRm[index].selectedUom = uomVal;
                                setRawMaterialsUsed(newRm);
                              }}
                              onChange={(e) => {
                                const newRm = [...rawMaterialsUsed];
                                newRm[index].quantity = e.target.value;
                                if (e.target.uom) {
                                  newRm[index].selectedUom = e.target.uom;
                                }
                                newRm[index].quantityError = "";
                                setRawMaterialsUsed(newRm);
                              }}
                              baseUoms={rm.uom || "KG"}
                              required
                              error={rm.quantityError}
                            />
                          </td>
                          <td className="px-4 py-3 align-middle text-center w-[80px]">
                            <DeleteButton
                              onClick={() => {
                                const newRm = [...rawMaterialsUsed];
                                newRm.splice(index, 1);
                                setRawMaterialsUsed(newRm);
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Tile>
        )}

        {/* Action Buttons */}
        <StickyFormFooter hint="F2 saves">
          <ActionPill
            variant="secondary"
            icon={<Eraser size={16} />}
            onClick={handleClear}
            disabled={isSubmitting}
          >
            Reset Fields
          </ActionPill>
          <ActionPill
            type="submit"
            size="lg"
            icon={<Save size={18} />}
            loading={isSubmitting}
            loadingText={editingLogId ? "Updating..." : "Saving..."}
            disabled={!activePlan || isNewLogBlocked}
          >
            {editingLogId ? "Update Entry" : "Save Entry"}
          </ActionPill>
        </StickyFormFooter>
      </form>

      {/* ─────── New High Reached Modal ─────── */}
      <CommonModal
        show={showNewHighModal}
        onHide={() => {
          setShowNewHighModal(false);
          navigate("/daily-machine-planning");
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
              navigate("/daily-machine-planning");
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
          <p className="text-ink-subtle text-sm max-w-sm mx-auto mb-6">
            {newHighDetails?.previousCapacity > 0
              ? "You have recorded a new highest production capacity for this product on this machine!"
              : "First production capacity record set for this product on this machine!"}
          </p>

          <div className="mb-6 inline-block min-w-[240px] rounded-[18px] bg-card-2 p-6">
            <div className="text-xs uppercase tracking-wider text-ink-subtle font-semibold mb-1">
              New Capacity High
            </div>
            <div className="flex items-center justify-center gap-2 text-4xl font-extrabold text-ink tabular-nums">
              <span>{newHighDetails?.newCapacity}</span>
              <span className="text-lg font-normal text-ink-muted">
                {activePlan?.uom || "units"}
              </span>
            </div>
            {newHighDetails?.previousCapacity > 0 && (
              <div className="mt-2 inline-block rounded-full bg-card px-3 py-1 text-xs text-ink-subtle">
                Previous High:{" "}
                <span className="font-semibold text-ink">
                  {newHighDetails.previousCapacity} {activePlan?.uom || "units"}
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
                <strong className="text-ink font-semibold">{newHighDetails?.date}</strong>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Cog size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <span className="text-ink-subtle text-xs block font-medium">Machine</span>
                <strong
                  className="text-ink font-semibold truncate block max-w-[150px]"
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
                <strong className="text-ink font-semibold">{newHighDetails?.shiftName}</strong>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Users size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <div>
                <span className="text-ink-subtle text-xs block font-medium">Operators</span>
                <strong
                  className="text-ink font-semibold block truncate max-w-[150px]"
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

export default HourlyWorkReportCreate;
