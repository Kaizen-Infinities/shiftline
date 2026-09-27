import React, { useState, useEffect, useCallback } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { Eraser, Save } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { z } from "zod";
import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { createMachine, updateMachine } from "../../../features/machines/machineSlice";
import { machineService } from "../../../services/machineService";
import { machineOperationAssignmentService } from "../../../services/machineOperationAssignmentService";
import { ActionPill, Chip, PageHeader, SkeletonTile, Tile } from "../../../components/ui/v2";
import { PageBody, StickyFormFooter } from "../../production/ui";
import { useSocketSync } from "../../../hooks/useSocketSync";
import MachineTelemetryHealthStrip from "../components/MachineTelemetryHealthStrip";

const machineSchema = z.object({
  machineId: z.string().min(1, "Machine ID is required").max(20, "Maximum 20 characters allowed"),
  machineName: z
    .string()
    .trim()
    .min(1, "Machine Name is required")
    .max(100, "Maximum 100 characters allowed"),
  technologyType: z.string().min(1, "Technology Type is required"),
  machineType: z.string().min(1, "Machine Type is required"),
  targetTemperature: z.coerce
    .number()
    .min(0, "Temperature cannot be negative")
    .max(999.99, "Temperature must be less than 1000°C")
    .optional()
    .nullable(),
  operatorId: z
    .string()
    .min(1, "Machine Incharge is required")
    .max(20, "Maximum 20 characters allowed"),
  isActive: z.boolean().optional(),
});

const initialFormState = {
  machineId: "",
  machineName: "",
  technologyType: "",
  machineType: "",
  targetTemperature: "",
  operatorId: "",
  isActive: true,
};

const MachineForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const dispatch = useAppDispatch();

  const [roles, setRoles] = useState<any[]>([]);
  const [inchargeRoleId, setInchargeRoleId] = useState("");
  const [employees, setEmployees] = useState<any[]>([]);
  const [pendingOperatorId, setPendingOperatorId] = useState("");

  const [formData, setFormData] = useState(initialFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useFormShortcuts({});

  const fetchRoles = useCallback(() => {
    machineOperationAssignmentService.getRoles().then((res) => {
      const raw = res.data || [];
      setRoles(
        raw.filter(
          (r: any) =>
            !r.name?.toLowerCase().includes("super admin") &&
            !r.name?.toLowerCase().includes("superadmin") &&
            !r.code?.toLowerCase().includes("super_admin") &&
            !r.code?.toLowerCase().includes("superadmin") &&
            r.code?.toLowerCase() !== "role_admin"
        )
      );
    });
  }, []);

  const fetchEmployees = useCallback(() => {
    if (!inchargeRoleId) {
      setEmployees([]);
      return;
    }
    machineOperationAssignmentService
      .getEmployeesByRole(Number(inchargeRoleId))
      .then((res) => setEmployees(res.data || []))
      .catch(() => {});
  }, [inchargeRoleId]);

  useSocketSync("role", undefined, fetchRoles);
  useSocketSync("employee", undefined, fetchEmployees);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);
  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  // Edit mode: detect which role the loaded operatorId belongs to
  useEffect(() => {
    if (!pendingOperatorId || roles.length === 0 || inchargeRoleId) return;
    let cancelled = false;
    const detectRole = async () => {
      for (const role of roles) {
        try {
          const res = await machineOperationAssignmentService.getEmployeesByRole(Number(role.id));
          const emps: any[] = res.data || [];
          if (emps.some((e: any) => String(e.id) === String(pendingOperatorId))) {
            if (!cancelled) {
              setInchargeRoleId(String(role.id));
              setEmployees(emps);
            }
            break;
          }
        } catch {
          /* skip role */
        }
      }
    };
    detectRole();
    return () => {
      cancelled = true;
    };
  }, [pendingOperatorId, roles]);

  // Fetch next ID (create) or load existing machine (edit)
  useEffect(() => {
    if (isEdit && id) {
      setLoading(true);
      machineService
        .getById(id)
        .then((res: any) => {
          const s = res?.data || res;
          setFormData({
            machineId: s.machineId || "",
            machineName: s.machineName || "",
            technologyType: s.technologyType || "",
            machineType: s.machineType || "",
            targetTemperature: s.targetTemperature ? String(s.targetTemperature) : "",
            operatorId: s.operatorId || "",
            isActive: s.isActive ?? true,
          });
          if (s.operatorId) setPendingOperatorId(s.operatorId);
        })
        .catch(() => {
          toast.error("Failed to load machine data.");
          navigate("/machines");
        })
        .finally(() => setLoading(false));
    } else {
      machineService
        .fetchNextId()
        .then((nextId) => setFormData((prev) => ({ ...prev, machineId: nextId })))
        .catch(() => {});
    }
  }, [isEdit, id, navigate]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    let finalValue: any = value;
    if (type === "checkbox") {
      finalValue = (e.target as HTMLInputElement).checked;
    } else if (name === "isActive") {
      finalValue = value === "true";
    }
    setFormData((prev) => ({ ...prev, [name]: finalValue }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const payload = {
      ...formData,
      targetTemperature: formData.targetTemperature ? Number(formData.targetTemperature) : null,
      operatorId: formData.operatorId,
    };

    let hasError = false;
    const formattedErrors: Record<string, string> = {};

    if (!inchargeRoleId) {
      formattedErrors["inchargeRoleId"] = "Incharge Role is required";
      hasError = true;
    }

    try {
      machineSchema.parse(payload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = error.flatten().fieldErrors as Record<string, string[] | undefined>;
        Object.keys(fieldErrors).forEach((key) => {
          const message = fieldErrors[key]?.[0];
          if (message) formattedErrors[key] = message;
        });
        hasError = true;
      }
    }

    if (hasError) {
      setErrors(formattedErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);
    try {
      if (isEdit) {
        await dispatch(
          updateMachine({
            id: payload.machineId,
            data: {
              machineName: payload.machineName,
              technologyType: payload.technologyType,
              machineType: payload.machineType,
              targetTemperature: payload.targetTemperature,
              operatorId: payload.operatorId,
              isActive: payload.isActive,
            },
          })
        ).unwrap();
        toast.success("Machine updated successfully!");
      } else {
        await dispatch(createMachine(payload as any)).unwrap();
        toast.success("Machine created successfully!");
      }
      navigate("/machines");
    } catch (err: any) {
      toast.error(err || `Failed to ${isEdit ? "update" : "create"} machine`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = isEdit ? "Edit Machine" : "Create Machine";

  if (loading) {
    return (
      <PageBody>
        <PageHeader
          title={title}
          back="/machines"
          backLabel="Back to List"
          breadcrumbs={[{ label: "Machines", to: "/machines" }, { label: title }]}
        />
        <SkeletonTile lines={4} />
        <SkeletonTile lines={3} />
      </PageBody>
    );
  }

  return (
    <PageBody className="max-w-[1100px]">
      <PageHeader
        title={title}
        subtitle={
          isEdit
            ? `${formData.machineName || "Machine"} · ${formData.machineId}`
            : "Register a machine so it can be scheduled, planned and tracked on the floor."
        }
        back="/machines"
        backLabel="Back to List"
        breadcrumbs={[{ label: "Machines", to: "/machines" }, { label: title }]}
        meta={
          isEdit ? (
            <Chip tone={formData.isActive ? "success" : "muted"} dot>
              {formData.isActive ? "Active" : "Inactive"}
            </Chip>
          ) : undefined
        }
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <Tile title="Machine" subtitle="How the machine is identified across plans and reports.">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <TextInput
              label="Machine ID"
              name="machineId"
              value={formData.machineId}
              placeholder="e.g. MAC-01"
              required
              disabled={isEdit}
              error={errors.machineId}
              onChange={handleChange}
            />
            <TextInput
              label="Machine Name"
              name="machineName"
              value={formData.machineName}
              placeholder="e.g. Extruder A"
              required
              error={errors.machineName}
              onChange={handleChange}
            />
          </div>
        </Tile>

        <Tile title="Technology" subtitle="Used to match products and moulds to the right machine.">
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <SelectInput
              label="Technology Type"
              name="technologyType"
              value={formData.technologyType}
              defaultOptionLabel="Select Technology"
              options={[
                { label: "Injection Moulding", value: "INJECTION_MOULDING" },
                { label: "Extrusion", value: "EXTRUSION" },
                { label: "Blow Moulding", value: "BLOW_MOULDING" },
                { label: "Rotational Moulding", value: "ROTATIONAL_MOULDING" },
                { label: "Thermoforming", value: "THERMOFORMING" },
                { label: "Compression Moulding", value: "COMPRESSION_MOULDING" },
                { label: "Printing", value: "PRINTING" },
                { label: "Granulation", value: "GRANULATION" },
                { label: "Mixing", value: "MIXING" },
                { label: "Recycling", value: "RECYCLING" },
              ]}
              required
              error={errors.technologyType}
              onChange={handleChange}
            />
            <SelectInput
              label="Machine Type"
              name="machineType"
              value={formData.machineType}
              defaultOptionLabel="Select Type"
              options={[
                { label: "Production", value: "PRODUCTION" },
                { label: "Utility", value: "UTILITY" },
              ]}
              required
              error={errors.machineType}
              onChange={handleChange}
            />
            <TextInput
              label="Target Temp (°C)"
              name="targetTemperature"
              type="number"
              inputMode="decimal"
              value={formData.targetTemperature}
              placeholder="e.g. 220"
              error={errors.targetTemperature}
              onChange={handleChange}
            />
          </div>
        </Tile>

        <Tile
          title="Incharge & status"
          subtitle="Pick a role first, then the person from that role who looks after this machine."
        >
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
            <SelectInput
              label="Incharge Role"
              name="inchargeRoleId"
              value={inchargeRoleId}
              defaultOptionLabel="-- Select Role First --"
              options={roles.map((r) => ({ label: r.name, value: String(r.id) }))}
              onChange={(e) => {
                setInchargeRoleId(e.target.value);
                setFormData((prev) => ({ ...prev, operatorId: "" }));
                if (errors.inchargeRoleId) setErrors((prev) => ({ ...prev, inchargeRoleId: "" }));
              }}
              required
              error={errors.inchargeRoleId}
            />
            <SelectInput
              label="Machine Incharge"
              name="operatorId"
              value={formData.operatorId}
              defaultOptionLabel={!inchargeRoleId ? "Select Role First" : "-- Select Incharge --"}
              required
              disabled={!inchargeRoleId}
              options={employees.map((emp) => {
                const roleName = emp.user?.role?.name || emp.role?.name;
                return {
                  label: `${emp.fullName} (${emp.empCode})${roleName ? ` - ${roleName}` : ""}`,
                  value: emp.id,
                };
              })}
              error={errors.operatorId}
              onChange={handleChange}
            />
            <SelectInput
              label="Active Status"
              name="isActive"
              value={formData.isActive ? "true" : "false"}
              defaultOptionLabel="Select Status"
              options={[
                { label: "Active", value: "true" },
                { label: "Inactive", value: "false" },
              ]}
              error={errors.isActive}
              onChange={handleChange}
            />
          </div>
          {isEdit && formData.machineId && (
            <MachineTelemetryHealthStrip machineId={formData.machineId} />
          )}
        </Tile>

        <StickyFormFooter hint="F2 saves">
          <ActionPill variant="secondary" onClick={() => navigate("/machines")}>
            Cancel
          </ActionPill>
          {!isEdit && (
            <ActionPill
              variant="secondary"
              icon={<Eraser size={16} />}
              onClick={() => {
                setFormData(initialFormState);
                setErrors({});
              }}
              disabled={isSubmitting}
            >
              Clear
            </ActionPill>
          )}
          <ActionPill
            type="submit"
            icon={<Save size={17} />}
            loading={isSubmitting}
            loadingText={isEdit ? "Updating..." : "Saving..."}
          >
            {isEdit ? "Update Machine" : "Save Machine"}
          </ActionPill>
        </StickyFormFooter>
      </form>
    </PageBody>
  );
};

export default MachineForm;
