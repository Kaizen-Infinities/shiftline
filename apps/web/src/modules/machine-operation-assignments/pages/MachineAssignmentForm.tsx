import React, { useState, useEffect, useCallback } from "react";
import { addDays, todayIn, weekRange } from "@shiftline/shared";
import { Eraser, Plus, Save, X } from "lucide-react";
import { toast } from "react-toastify";
import { useNavigate, useParams } from "react-router-dom";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import TextInput from "../../../components/form/TextInput/TextInput";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import { ActionPill, Chip, PageHeader, SkeletonTile, Tile } from "../../../components/ui/v2";
import { PageBody, StickyFormFooter } from "../../production/ui";
import { machineOperationAssignmentService } from "../../../services/machineOperationAssignmentService";
import { machineService } from "../../../services/machineService";
import { shiftService } from "../../../services/shiftService";
import { useSocketSync } from "../../../hooks/useSocketSync";

export const MachineAssignmentForm: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const getMondayAndSunday = (offsetWeeks: number = 0) =>
    weekRange(addDays(todayIn(), offsetWeeks * 7));

  const getWeekRangeForDate = (dateString: string) => {
    if (!dateString || isNaN(new Date(dateString).getTime())) return null;
    return weekRange(dateString);
  };

  const currentWeek = getMondayAndSunday(0);

  const initialFormState = {
    machineId: "",
    shiftId: "",
    weekStartDate: currentWeek.start,
    weekEndDate: currentWeek.end,
    operators: [{ roleId: "", employeeId: "" }],
    remarks: "",
    isActive: true,
  };

  const [formData, setFormData] = useState(initialFormState);
  const [machines, setMachines] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEdit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [assignedShifts, setAssignedShifts] = useState<string[]>([]);
  const [employeesByRole, setEmployeesByRole] = useState<Record<string, any[]>>({});

  const fetchRefData = useCallback(async () => {
    try {
      const [mRes, rRes, sRes] = await Promise.all([
        machineService.getAll().catch(() => []),
        machineOperationAssignmentService.getRoles().catch(() => ({ data: [] })),
        shiftService.fetchAll().catch(() => []),
      ]);
      const machineList = Array.isArray(mRes) ? mRes : mRes.machines || mRes.data || [];
      setMachines(machineList.filter((m: any) => m.isActive !== false));
      const roleList = (rRes.data || []).filter(
        (r: any) =>
          !r.name?.toLowerCase().includes("super admin") &&
          !r.name?.toLowerCase().includes("superadmin") &&
          !r.code?.toLowerCase().includes("super_admin") &&
          !r.code?.toLowerCase().includes("superadmin") &&
          r.code?.toLowerCase() !== "role_admin"
      );
      setRoles(roleList);
      const shiftList = Array.isArray(sRes) ? sRes : (sRes as any).data || [];
      setShifts(shiftList.filter((s: any) => s.isActive !== false));
    } catch (err: any) {
      console.error("Failed to load reference data:", err);
      toast.error("Failed to load form reference data");
    }
  }, []);

  const refreshEmployees = useCallback(() => {
    const roleIds = new Set<string>();
    formData.operators.forEach((op) => {
      if (op.roleId) roleIds.add(op.roleId);
    });
    roleIds.forEach((roleId) => {
      machineOperationAssignmentService
        .getEmployeesByRole(Number(roleId))
        .then((res) => setEmployeesByRole((prev) => ({ ...prev, [roleId]: res.data || [] })))
        .catch((err) => console.error(err));
    });
  }, [formData.operators]);

  useSocketSync("machine", undefined, fetchRefData);
  useSocketSync("role", undefined, fetchRefData);
  useSocketSync("shift", undefined, fetchRefData);
  useSocketSync("employee", undefined, refreshEmployees);

  useEffect(() => {
    fetchRefData();
  }, [fetchRefData]);

  useEffect(() => {
    if (!id) {
      setFormData(initialFormState);
      return;
    }
    const fetchAssignment = async () => {
      setInitialLoading(true);
      try {
        const res = await machineOperationAssignmentService.getAssignmentById(id);
        const data = res.data;
        if (data) {
          setFormData({
            machineId: data.machineId || "",
            shiftId: data.shiftId || "",
            weekStartDate: data.weekStartDate
              ? data.weekStartDate.split("T")[0]
              : currentWeek.start,
            weekEndDate: data.weekEndDate ? data.weekEndDate.split("T")[0] : currentWeek.end,
            operators: data.operators
              ? data.operators.map((o: any) => ({
                  roleId: String(o.roleId),
                  employeeId: String(o.employeeId),
                }))
              : [],
            remarks: data.remarks || "",
            isActive: data.isActive !== false,
          });
          if (data.operators) {
            data.operators.forEach((op: any) => {
              if (op.roleId) fetchEmployeesForRole(String(op.roleId));
            });
          }
        }
      } catch (err: any) {
        console.error("Failed to load assignment:", err);
        toast.error("Failed to load machine assignment details");
        navigate("/machines/assignments");
      } finally {
        setInitialLoading(false);
      }
    };
    fetchAssignment();
  }, [id]);

  useEffect(() => {
    if (formData.machineId && formData.weekStartDate) {
      fetchAssignedShifts();
    } else {
      setAssignedShifts([]);
    }
  }, [formData.machineId, formData.weekStartDate]);

  const fetchAssignedShifts = async () => {
    try {
      const res = await machineOperationAssignmentService.getAssignments({
        machineId: formData.machineId,
        weekStartDate: formData.weekStartDate,
        isActive: true,
        limit: 100,
      });
      const existingShifts = res.data.map((a: any) => String(a.shiftId));
      if (isEdit && formData.shiftId) {
        setAssignedShifts(existingShifts.filter((sid: string) => sid !== String(formData.shiftId)));
      } else {
        setAssignedShifts(existingShifts);
      }
    } catch (err) {
      console.error("Failed to load existing assignments", err);
    }
  };

  const fetchEmployeesForRole = async (roleId: string) => {
    if (!roleId) return;
    try {
      const res = await machineOperationAssignmentService.getEmployeesByRole(Number(roleId));
      setEmployeesByRole((prev) => ({ ...prev, [roleId]: res.data || [] }));
    } catch (err) {
      console.error(`Failed to load employees for role ${roleId}:`, err);
    }
  };

  const handleAddOperator = () => {
    setFormData((prev) => ({
      ...prev,
      operators: [...prev.operators, { roleId: "", employeeId: "" }],
    }));
  };

  const handleRemoveOperator = (index: number) => {
    if (formData.operators.length <= 1) return;
    setFormData((prev) => ({
      ...prev,
      operators: prev.operators.filter((_, i) => i !== index),
    }));
  };

  const handleOperatorChange = (index: number, field: "roleId" | "employeeId", value: string) => {
    if (field === "roleId" && value) fetchEmployeesForRole(value);
    setFormData((prev) => {
      const newOps = [...prev.operators];
      newOps[index] = { ...newOps[index], [field]: value };
      if (field === "roleId") newOps[index].employeeId = "";
      return { ...prev, operators: newOps };
    });
  };

  const handleMachineSelect = (selectedMachineId: string) => {
    setFormData((prev) => ({ ...prev, machineId: selectedMachineId }));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.machineId) newErrors.machineId = "Machine is required";
    if (!formData.shiftId) newErrors.shiftId = "Shift is required";
    if (!formData.weekStartDate) newErrors.weekStartDate = "Start date is required";
    if (!formData.weekEndDate) newErrors.weekEndDate = "Week End Date is required";
    if (formData.weekStartDate && formData.weekEndDate) {
      if (new Date(formData.weekEndDate) < new Date(formData.weekStartDate)) {
        newErrors.weekEndDate = "Week End Date must be after Week Start Date";
      }
    }
    if (formData.operators.length < 1) {
      newErrors.operators = "At least one operator is required";
    } else {
      const empIds = new Set<string>();
      formData.operators.forEach((op, idx) => {
        if (!op.roleId) newErrors[`operatorRole_${idx}`] = "Role is required";
        if (!op.employeeId) {
          newErrors[`operatorEmp_${idx}`] = "Employee is required";
        } else {
          if (empIds.has(op.employeeId)) newErrors[`operatorEmp_${idx}`] = "Duplicate employee";
          empIds.add(op.employeeId);
        }
      });
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleClear = () => {
    setFormData(initialFormState);
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        machineId: formData.machineId,
        shiftId: formData.shiftId,
        weekStartDate: formData.weekStartDate,
        weekEndDate: formData.weekEndDate,
        operators: formData.operators.map((o) => ({
          roleId: Number(o.roleId),
          employeeId: String(o.employeeId),
        })),
        remarks: formData.remarks || null,
        isActive: formData.isActive,
      };
      if (isEdit && id) {
        await machineOperationAssignmentService.updateAssignment(id, payload);
        toast.success("Machine Operation Assignment updated successfully!");
      } else {
        await machineOperationAssignmentService.createAssignment(payload);
        toast.success("Machine Operation Assignment created successfully!");
      }
      navigate("/machines/assignments");
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || "Failed to save assignment";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const title = isEdit ? "Edit machine assignment" : "New machine assignment";
  const crumbs = [
    { label: "Machines", to: "/machines" },
    { label: "Machine assignments", to: "/machines/assignments" },
    { label: isEdit ? "Edit" : "New" },
  ];

  if (initialLoading) {
    return (
      <PageBody>
        <PageHeader
          title={title}
          back="/machines/assignments"
          backLabel="Back to List"
          breadcrumbs={crumbs}
        />
        <SkeletonTile lines={3} />
        <SkeletonTile lines={4} />
      </PageBody>
    );
  }

  const selectedEmpIds = new Set(formData.operators.map((op) => op.employeeId).filter(Boolean));

  return (
    <PageBody className="sl-page-form">
      <PageHeader
        title={title}
        subtitle="Pick the week, machine and shift, then the operators who run it."
        back="/machines/assignments"
        backLabel="Back to List"
        breadcrumbs={crumbs}
      />
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <Tile
          title="Week, machine & shift"
          subtitle="Any date you pick snaps to its Monday–Sunday week."
        >
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <DatePickerCalendar
              label="Week Start Date"
              name="weekStartDate"
              required
              value={formData.weekStartDate}
              onChange={(e: any) => {
                const range = getWeekRangeForDate(e.target.value);
                if (range) {
                  setFormData({ ...formData, weekStartDate: range.start, weekEndDate: range.end });
                } else {
                  setFormData({ ...formData, weekStartDate: e.target.value });
                }
              }}
              error={errors.weekStartDate}
            />
            <DatePickerCalendar
              label="Week End Date"
              name="weekEndDate"
              required
              value={formData.weekEndDate}
              onChange={(e: any) => {
                const range = getWeekRangeForDate(e.target.value);
                if (range) {
                  setFormData({ ...formData, weekStartDate: range.start, weekEndDate: range.end });
                } else {
                  setFormData({ ...formData, weekEndDate: e.target.value });
                }
              }}
              error={errors.weekEndDate}
            />
            <SelectInput
              label="Machine"
              name="machineId"
              required
              value={formData.machineId}
              onChange={(e) => handleMachineSelect(e.target.value)}
              error={errors.machineId}
              options={[
                { label: "-- Select Machine --", value: "" },
                ...machines.map((m) => ({
                  label: `${m.machineName} (${m.machineId})`,
                  value: m.machineId,
                })),
              ]}
            />
            <SelectInput
              label="Shift"
              name="shiftId"
              required
              value={formData.shiftId}
              onChange={(e) => setFormData({ ...formData, shiftId: e.target.value })}
              error={errors.shiftId}
              options={[
                { label: "-- Select Shift --", value: "" },
                ...shifts.map((s) => ({
                  label: `${s.shiftName} (${s.startTime} - ${s.endTime})`,
                  value: s.shiftCode,
                  disabled: assignedShifts.includes(s.shiftCode),
                })),
              ]}
            />
          </div>
          {assignedShifts.length > 0 && (
            <p className="sl-muted m-0 mt-3 text-[13px]">
              Shifts already assigned on this machine for the week are greyed out.
            </p>
          )}
        </Tile>

        <Tile
          title="Operators"
          subtitle={`${formData.operators.length} operator${formData.operators.length === 1 ? "" : "s"} on this machine and shift.`}
          actions={
            <ActionPill
              variant="secondary"
              size="sm"
              icon={<Plus size={15} />}
              onClick={handleAddOperator}
            >
              Add Operator
            </ActionPill>
          }
        >
          {errors.operators && (
            <p role="alert" className="sl-field-error m-0 mb-3">
              {errors.operators}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {formData.operators.map((operator, index) => (
              <div key={index} className="rounded-[16px] bg-card-2 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Chip size="sm">Operator {index + 1}</Chip>
                  {formData.operators.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOperator(index)}
                      className="sl-icon-btn sl-icon-btn-hover-danger"
                      title="Remove Operator"
                      aria-label={`Remove operator ${index + 1}`}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <SelectInput
                    label="Select Role First"
                    name={`operatorRole_${index}`}
                    value={operator.roleId}
                    onChange={(e) => handleOperatorChange(index, "roleId", e.target.value)}
                    error={errors[`operatorRole_${index}`]}
                    options={[
                      { label: "-- Select Role --", value: "" },
                      ...roles.map((r) => ({
                        label: r.name,
                        value: String(r.id),
                      })),
                    ]}
                    required
                  />
                  <SelectInput
                    label="Select Operator"
                    name={`operatorEmp_${index}`}
                    required
                    value={operator.employeeId}
                    onChange={(e) => handleOperatorChange(index, "employeeId", e.target.value)}
                    error={errors[`operatorEmp_${index}`]}
                    disabled={!operator.roleId}
                    options={[
                      { label: "-- Select Operator --", value: "" },
                      ...(employeesByRole[operator.roleId] || []).map((e: any) => {
                        const roleName = e.user?.role?.name || e.role?.name;
                        return {
                          label: `${e.fullName} (${e.empCode})${roleName ? ` - ${roleName}` : ""}`,
                          value: String(e.id),
                          disabled:
                            selectedEmpIds.has(String(e.id)) &&
                            operator.employeeId !== String(e.id),
                        };
                      }),
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </Tile>

        <Tile title="Remarks">
          <TextInput
            label="Remarks / Notes (Optional)"
            name="remarks"
            placeholder="e.g. Weekly operator shift rotation"
            value={formData.remarks}
            onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
          />
        </Tile>

        <StickyFormFooter hint="F2 saves">
          <ActionPill variant="secondary" onClick={() => navigate("/machines/assignments")}>
            Cancel
          </ActionPill>
          <ActionPill
            variant="secondary"
            icon={<Eraser size={16} />}
            onClick={handleClear}
            disabled={loading}
          >
            Clear
          </ActionPill>
          <ActionPill
            type="submit"
            icon={<Save size={17} />}
            loading={loading}
            loadingText="Saving..."
          >
            {isEdit ? "Update Assignment" : "Save Assignment"}
          </ActionPill>
        </StickyFormFooter>
      </form>
    </PageBody>
  );
};

export default MachineAssignmentForm;
