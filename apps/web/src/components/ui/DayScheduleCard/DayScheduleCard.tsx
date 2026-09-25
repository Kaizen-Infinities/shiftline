import React from "react";
import { Card, Col, Row } from "../TailwindPrimitives";
import { FaPlay } from "react-icons/fa";
import StatusBadge from "../StatusBadge/Badge";
import CustomButton from "../Button/Button";
import "./DayScheduleCard.css";

interface Program {
  weeklyProgramId: string;
  productionOrderId: string;
  productName: string;
  productCode?: string;
  priority: string;
  plannedQty: number;
  producedQty: number;
  remainingQty: number;
  status: string;
  machineName?: string;
}

interface Shift {
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  programs: Program[];
}

interface Day {
  dayOfWeek: number;
  dayName: string;
  date: string;
  shifts: Shift[];
}

interface DayScheduleCardProps {
  day: Day;
  machineName?: string;
  onHourlyProductionClick: (day: Day, shift: Shift, program: Program) => void;
  onStopProductionClick?: (day: Day, shift: Shift, program: Program) => void;
  onEditClick?: (day: Day, shift: Shift, program: Program) => void;
  onDeleteClick?: (day: Day, shift: Shift, program: Program) => void;
  onAddUrgentClick?: (day: Day, shift: Shift) => void;
  startedPrograms?: Set<string>;
  completedPrograms?: Set<string>;
}

const DayScheduleCard: React.FC<DayScheduleCardProps> = ({
  day,
  machineName,
  onHourlyProductionClick,
  onStopProductionClick,
  onEditClick,
  onDeleteClick,
  onAddUrgentClick,
  startedPrograms: _startedPrograms,
  completedPrograms,
}) => {
  const hasPlans = day.shifts.some((s) => s.programs.length > 0);

  return (
    <Card className="day-schedule-card sl-tile-hover h-full">
      <Card.Header className="flex items-center justify-between gap-3 !border-0 !px-5 !pb-0 !pt-5">
        <div>
          <h5 className="sl-h2 m-0 mb-0.5">{day.dayName}</h5>
          <span className="text-[13px] font-medium text-ink-subtle">
            {new Date(day.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
          </span>
        </div>
        <StatusBadge
          status={hasPlans ? "SCHEDULED" : "DRAFT"}
          customText={hasPlans ? "Scheduled" : "No Plan"}
          tone={hasPlans ? undefined : "muted"}
        />
      </Card.Header>

      <Card.Body className="!px-5 !py-4">
        <div className="flex flex-col gap-3">
          {day.shifts.map((shift) => {
            const hasProgramsInShift = shift.programs.length > 0;

            return (
              <div
                key={shift.shiftId}
                className="rounded-[14px] border border-line-soft bg-card-2 p-3"
              >
                {/* Shift Sub-Header */}
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{shift.shiftName}</span>
                    {onAddUrgentClick && (
                      <button
                        type="button"
                        onClick={() => onAddUrgentClick(day, shift)}
                        className="sl-chip sl-chip-sm"
                      >
                        + Add Urgent Run
                      </button>
                    )}
                  </div>
                  <span className="sl-chip sl-chip-sm sl-chip-muted tabular-nums">
                    {shift.startTime} - {shift.endTime}
                  </span>
                </div>

                {/* Shift Programs */}
                {hasProgramsInShift ? (
                  <div className="flex flex-col gap-3">
                    {shift.programs.map((prog) => {
                      const isStarted = prog.status === "IN_PROGRESS";
                      const programKey = prog.weeklyProgramId;
                      const isCompletedByHours = completedPrograms?.has(programKey);
                      const isCompleted =
                        prog.status === "COMPLETED" ||
                        prog.producedQty >= prog.plannedQty ||
                        isCompletedByHours;

                      return (
                        <div
                          key={prog.weeklyProgramId}
                          className="rounded-[14px] border border-line-soft bg-card p-3.5 shadow-[var(--shadow-sm)]"
                        >
                          <div className="mb-3 flex items-start justify-between gap-2">
                            <div>
                              {(prog.machineName || machineName) && (
                                <div className="mb-1 text-xs text-ink-subtle">
                                  Machine{" "}
                                  <span className="font-semibold text-ink">
                                    {prog.machineName || machineName}
                                  </span>
                                </div>
                              )}
                              <div className="mb-2 text-xs text-ink-subtle">
                                PO{" "}
                                <span className="font-semibold text-accent">
                                  {prog.productionOrderId}
                                </span>
                              </div>
                              <div className="text-[15px] font-semibold text-ink">
                                {prog.productName}
                              </div>
                            </div>
                            <StatusBadge status={prog.status} />
                          </div>

                          {/* Quantities Grid */}
                          <Row className="my-3 !gap-2 rounded-[12px] bg-card-2 p-2.5 text-center">
                            <Col xs={4} className="!col-span-4">
                              <div className="mb-0.5 text-[11px] font-medium text-ink-subtle">
                                Planned
                              </div>
                              <div className="text-lg font-bold tabular-nums text-ink">
                                {prog.plannedQty}
                              </div>
                            </Col>
                            <Col xs={4} className="!col-span-4">
                              <div className="mb-0.5 text-[11px] font-medium text-ink-subtle">
                                Produced
                              </div>
                              <div className="text-lg font-bold tabular-nums text-[color:var(--color-success)]">
                                {prog.producedQty}
                              </div>
                            </Col>
                            <Col xs={4} className="!col-span-4">
                              <div className="mb-0.5 text-[11px] font-medium text-ink-subtle">
                                Remaining
                              </div>
                              <div className="text-lg font-bold tabular-nums text-[color:var(--color-warning)]">
                                {prog.remainingQty}
                              </div>
                            </Col>
                          </Row>

                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
                            <StatusBadge status={prog.status} />

                            {isCompleted ? (
                              <div className="flex flex-col items-end">
                                <span
                                  className={`font-semibold ${prog.producedQty >= prog.plannedQty ? "text-[color:var(--color-success)]" : "text-[color:var(--color-danger)]"}`}
                                >
                                  Completed
                                </span>
                                {prog.producedQty < prog.plannedQty && (
                                  <span className="text-[11px] font-semibold text-[color:var(--color-danger)]">
                                    Target Not Reached ({prog.plannedQty - prog.producedQty} Short)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                {isStarted && onStopProductionClick && (
                                  <button
                                    type="button"
                                    title="Stop & Complete Run"
                                    onClick={() => onStopProductionClick(day, shift, prog)}
                                    aria-label="Stop & Complete Run"
                                    className="sl-icon-btn sl-icon-btn-md sl-icon-btn-tone-danger"
                                  >
                                    <svg
                                      stroke="currentColor"
                                      fill="currentColor"
                                      strokeWidth="0"
                                      viewBox="0 0 448 512"
                                      height="1em"
                                      width="1em"
                                      xmlns="http://www.w3.org/2000/svg"
                                    >
                                      <path d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c0-26.5-21.5-48-48-48V80c0-26.5-21.5-48-48-48z"></path>
                                    </svg>
                                  </button>
                                )}
                                {!isStarted && !isCompleted && onEditClick && (
                                  <button
                                    type="button"
                                    title="Edit Run"
                                    onClick={() => onEditClick(day, shift, prog)}
                                    aria-label="Edit Run"
                                    className="sl-icon-btn sl-icon-btn-md sl-icon-btn-hover-primary"
                                  >
                                    <svg
                                      stroke="currentColor"
                                      fill="currentColor"
                                      strokeWidth="0"
                                      viewBox="0 0 512 512"
                                      height="1em"
                                      width="1em"
                                      xmlns="http://www.w3.org/2000/svg"
                                    >
                                      <path d="M497.9 142.1l-46.1 46.1c-4.7 4.7-12.3 4.7-17 0l-111-111c-4.7-4.7-4.7-12.3 0-17l46.1-46.1c18.7-18.7 49.1-18.7 67.9 0l60.1 60.1c18.8 18.7 18.8 49.1 0 67.9zM284.2 99.8L21.6 362.4.4 483.9c-2.9 16.4 11.4 30.6 27.8 27.8l121.5-21.3 262.6-262.6c4.7-4.7 4.7-12.3 0-17l-111-111c-4.8-4.7-12.4-4.7-17.1 0zM124.1 339.9c-5.5-5.5-5.5-14.3 0-19.8l154-154c5.5-5.5 14.3-5.5 19.8 0s5.5 14.3 0 19.8l-154 154c-5.5 5.5-14.3 5.5-19.8 0zM88 424h48v36.3l-64.5 11.3-31.1-31.1L51.7 376H88v48z"></path>
                                    </svg>
                                  </button>
                                )}
                                {!isStarted && !isCompleted && onDeleteClick && (
                                  <button
                                    type="button"
                                    title="Delete Run"
                                    onClick={() => onDeleteClick(day, shift, prog)}
                                    aria-label="Delete Run"
                                    className="sl-icon-btn sl-icon-btn-md sl-icon-btn-hover-danger"
                                  >
                                    <svg
                                      stroke="currentColor"
                                      fill="currentColor"
                                      strokeWidth="0"
                                      viewBox="0 0 448 512"
                                      height="1em"
                                      width="1em"
                                      xmlns="http://www.w3.org/2000/svg"
                                    >
                                      <path d="M135.2 17.7L128 32H32C14.3 32 0 46.3 0 64S14.3 96 32 96H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H320l-7.2-14.3C307.4 6.8 296.3 0 284.2 0H163.8c-12.1 0-23.2 6.8-28.6 17.7zM416 128H32L53.2 467c1.6 25.3 22.6 45 47.9 45H346.9c25.3 0 46.3-19.7 47.9-45L416 128z"></path>
                                    </svg>
                                  </button>
                                )}
                                <CustomButton
                                  text={isStarted ? "In Progress" : "Start Production"}
                                  icon={FaPlay}
                                  onClick={() => onHourlyProductionClick(day, shift, prog)}
                                  disabled={isStarted || prog.remainingQty <= 0}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 flex min-h-[100px] items-center justify-center rounded-[14px] border-2 border-dashed border-line bg-card py-4">
                    <span className="text-[13px] font-medium text-ink-subtle">
                      No runs scheduled
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card.Body>
    </Card>
  );
};

export default DayScheduleCard;
