import React, { useState, useEffect } from "react";
import {
  FaUserCheck,
  FaHistory,
  FaPlus,
  FaCogs,
  FaCheckCircle,
  FaExclamationCircle,
} from "react-icons/fa";
import { toast } from "react-toastify";
import CustomButton from "../../../components/ui/Button/Button";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import DataTable from "../../../components/ui/table/DataTable";
import { formatDate } from "../../../utils/dateUtils";
import {
  machineOperationAssignmentService,
  type MachineOperationAssignment,
} from "../../../services/machineOperationAssignmentService";
import { MachineAssignmentFormModal } from "./MachineAssignmentFormModal";
import { useSocketSync } from "../../../hooks/useSocketSync";

interface Props {
  machineId: string;
  machineName?: string;
}

export const MachineAssignmentTab: React.FC<Props> = ({ machineId, machineName }) => {
  const [currentAssignment, setCurrentAssignment] = useState<MachineOperationAssignment | null>(
    null
  );
  const [history, setHistory] = useState<MachineOperationAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadData = async () => {
    if (!machineId) return;
    setLoading(true);
    try {
      const [currRes, histRes] = await Promise.all([
        machineOperationAssignmentService.getCurrentByMachine(machineId),
        machineOperationAssignmentService.getHistoryByMachine(machineId),
      ]);

      setCurrentAssignment(currRes.data || null);
      setHistory(histRes.data || []);
    } catch (err: any) {
      console.error("Failed to load machine assignment data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [machineId]);

  useSocketSync("machineOperationAssignment", undefined, loadData);

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Action */}
      <div className="flex items-center justify-between p-4 bg-card-2 border border-line-soft rounded-xl">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-accent/10 text-accent rounded-xl">
            <FaCogs size={20} />
          </div>
          <div>
            <h3 className="font-bold text-ink text-base">
              Machine Operation Assignments for {machineName || machineId}
            </h3>
            <p className="text-xs text-ink-muted">
              Manage current week operator & incharge assignment and view assignment history
            </p>
          </div>
        </div>

        <CustomButton
          text="Assign Operator & Incharge"
          icon={FaPlus}
          variant="primary"
          onClick={() => setIsModalOpen(true)}
        />
      </div>

      {/* Current Active Assignment Card */}
      <div className="rounded-2xl border border-line-soft shadow-sm overflow-hidden bg-card">
        <div className="flex items-center justify-between px-5 py-4 bg-card-2 border-b border-line-soft">
          <h4 className="font-bold text-ink text-sm flex items-center gap-2">
            <FaCheckCircle className="text-[var(--color-success)]" /> Current Active Assignment
          </h4>
          {currentAssignment && (
            <StatusBadge
              status={currentAssignment.isActive ? "Active" : "Closed"}
              customText={currentAssignment.isActive ? "Active Week" : "Closed"}
            />
          )}
        </div>

        <div className="p-5">
          {currentAssignment ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Operators */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                {(currentAssignment as any).operators &&
                (currentAssignment as any).operators.length > 0 ? (
                  (currentAssignment as any).operators.map((op: any, index: number) => (
                    <div key={index} className="p-4 bg-accent/5 border border-line-soft rounded-xl">
                      <span className="text-[11px] uppercase tracking-wider font-semibold text-accent">
                        Assigned Operator {index + 1}
                      </span>
                      {op.employee ? (
                        <div className="mt-2">
                          <p className="font-bold text-ink text-base">{op.employee.fullName}</p>
                          <p className="text-xs text-ink-muted">Code: {op.employee.empCode}</p>
                          {op.role && (
                            <span className="inline-block mt-2 px-2 py-0.5 bg-accent/10 text-accent rounded text-xs font-semibold">
                              Role: {op.role.name}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-ink-subtle mt-2 font-medium">— Unassigned —</p>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-4 bg-accent/5 border border-line-soft rounded-xl col-span-2">
                    <span className="text-[11px] uppercase tracking-wider font-semibold text-accent">
                      Assigned Operators
                    </span>
                    <p className="text-sm text-ink-subtle mt-2 font-medium">
                      — No Operators Assigned —
                    </p>
                  </div>
                )}
              </div>

              {/* Week & Details */}
              <div className="p-4 bg-card-2 border border-line-soft rounded-xl flex flex-col justify-between">
                <div>
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-subtle">
                    Week Period & Shift
                  </span>
                  <p className="font-bold text-ink text-sm mt-1">
                    {currentAssignment.weekStartDate
                      ? currentAssignment.weekStartDate.split("T")[0]
                      : ""}{" "}
                    to{" "}
                    {currentAssignment.weekEndDate
                      ? currentAssignment.weekEndDate.split("T")[0]
                      : ""}
                  </p>
                  {(currentAssignment as any).shift && (
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-line"></span>
                      Shift: {(currentAssignment as any).shift.shiftName}
                    </div>
                  )}
                </div>
                <div className="mt-3 text-xs text-ink-muted">
                  <span>Assigned By: {currentAssignment.assignedBy || "SYSTEM"}</span>
                  {currentAssignment.remarks && (
                    <p className="mt-1 text-ink-muted italic">"{currentAssignment.remarks}"</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center bg-card-2 border border-dashed border-line-soft rounded-xl">
              <FaExclamationCircle className="mx-auto text-ink-subtle mb-2" size={24} />
              <p className="text-sm font-semibold text-ink-muted">
                No active assignment found for this machine for the current week.
              </p>
              <p className="text-xs text-ink-subtle mt-1">
                Click "Assign Operator & Incharge" above to create an assignment.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Assignment History Table (Newest First) */}
      <div className="rounded-2xl border border-line-soft shadow-sm overflow-hidden bg-card">
        <div className="px-5 py-4 bg-card-2 border-b border-line-soft flex items-center justify-between">
          <h4 className="font-bold text-ink text-sm flex items-center gap-2">
            <FaHistory className="text-accent" /> Assignment History (Newest First)
          </h4>
          <span className="text-xs text-ink-muted">{history.length} records</span>
        </div>

        <div className="p-5">
          <DataTable
            data={history}
            rowKey={(item: any) => item.id}
            loading={loading}
            columns={[
              {
                header: "WEEK & SHIFT",
                render: (item) => (
                  <div className="flex flex-col gap-1">
                    {(item as any).shift ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold text-ink text-sm">
                          {(item as any).shift.shiftName}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {item.weekStartDate ? item.weekStartDate.split("T")[0] : ""} to{" "}
                          {item.weekEndDate ? item.weekEndDate.split("T")[0] : ""}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-ink-subtle font-medium">All Shifts</span>
                    )}
                  </div>
                ),
              },
              {
                header: "OPERATORS & ROLES",
                render: (item) => (
                  <div>
                    {(item as any).operators && (item as any).operators.length > 0 ? (
                      <div className="flex flex-col gap-1.5">
                        {(item as any).operators.map((op: any, i: number) => (
                          <div key={i}>
                            <div className="font-semibold text-ink text-sm">
                              {op.employee?.fullName}
                            </div>
                            <div className="text-xs text-ink-muted">
                              {op.role?.name || "Operator"}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-ink-subtle text-sm">—</span>
                    )}
                  </div>
                ),
              },
              {
                header: "STATUS",
                render: (item) => (
                  <StatusBadge
                    status={item.isActive ? "Active" : "Closed"}
                    customText={item.isActive ? "Active" : "Closed"}
                  />
                ),
              },
              {
                header: "ASSIGNED BY",
                render: (item) => (
                  <span className="text-ink-muted text-xs">{item.assignedBy || "SYSTEM"}</span>
                ),
              },
              {
                header: "CREATED DATE",
                render: (item) => (
                  <span className="text-ink-muted text-xs">
                    {item.createdAt ? formatDate(item.createdAt) : "—"}
                  </span>
                ),
              },
              {
                header: "REMARKS",
                render: (item) => (
                  <span className="text-ink-muted text-xs italic">{item.remarks || "—"}</span>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* Modal */}
      <MachineAssignmentFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={loadData}
        initialData={{ machineId }}
      />
    </div>
  );
};
