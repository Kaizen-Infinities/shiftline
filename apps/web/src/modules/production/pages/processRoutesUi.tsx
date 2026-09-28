import React from "react";
import { ChevronRight, Factory, Truck } from "lucide-react";

import { Chip, cx, type ChipTone } from "../../../components/ui/v2";
import type {
  LotLocation,
  LotStatus,
  StepMode,
  StepProgress,
  StepState,
} from "../../../services/processRoutesService";
import { formatQty, humanize } from "../ui";
import { pct, stepLabel } from "./processRoutesFormat";

/** Chips and the step chain shared by the process route and lot board screens (TN-06). */

const LOT_TONE: Record<LotStatus, ChipTone> = {
  OPEN: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export const LotStatusChip: React.FC<{ status: LotStatus }> = ({ status }) => (
  <Chip size="sm" dot tone={LOT_TONE[status]}>
    {humanize(status)}
  </Chip>
);

export const ModeChip: React.FC<{ mode: StepMode }> = ({ mode }) =>
  mode === "JOB_WORK" ? (
    <Chip size="sm" tone="warning" icon={<Truck size={12} />}>
      Job work
    </Chip>
  ) : (
    <Chip size="sm" tone="muted" icon={<Factory size={12} />}>
      In-house
    </Chip>
  );

const STATE_TONE: Record<StepState, ChipTone> = {
  NOT_STARTED: "muted",
  IN_PROCESS: "info",
  DONE: "success",
};

/** Loss against the norm: red once a finished step lost more than its norm. */
export const LossChip: React.FC<{ step: StepProgress }> = ({ step }) => {
  if (step.state === "NOT_STARTED" || step.lossPct == null || step.received <= 0) return null;
  const tone: ChipTone = step.overNorm ? "danger" : step.state === "DONE" ? "success" : "muted";
  return (
    <Chip
      size="sm"
      tone={tone}
      title={`Loss ${pct(step.lossPct)} against a norm of ${pct(step.lossNormPct)}${
        step.state === "DONE" ? "" : " (so far)"
      }`}
    >
      Loss {pct(step.lossPct)} / {pct(step.lossNormPct)}
    </Chip>
  );
};

/** The lot's route as a row of step chips, each coloured by where the step stands. */
export const StepChain: React.FC<{ steps: StepProgress[]; currentSeq: number }> = ({
  steps,
  currentSeq,
}) => (
  <ol className="flex flex-wrap items-center gap-1.5" aria-label="Process steps">
    {steps.map((s, i) => (
      <li key={s.seq} className="flex items-center gap-1.5">
        <span
          className={cx(
            "inline-flex flex-col rounded-xl border px-2.5 py-1.5",
            s.seq === currentSeq ? "border-accent" : "border-line-soft",
            s.overNorm ? "border-danger/50 bg-danger/5" : "bg-card"
          )}
        >
          <span className="flex items-center gap-1.5">
            <Chip size="sm" dot tone={STATE_TONE[s.state]}>
              {s.seq}. {stepLabel(s.name)}
            </Chip>
            {s.mode === "JOB_WORK" && (
              <Truck size={13} className="text-ink-subtle" aria-label="Job work" />
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-ink-muted tabular-nums">
            {s.sent > 0 ? (
              <span>
                {formatQty(s.sent, s.uomIn)} → {formatQty(s.received, s.uomOut)}
              </span>
            ) : (
              <span>
                {s.uomIn}
                {s.uomOut !== s.uomIn ? ` → ${s.uomOut}` : ""} · norm {pct(s.lossNormPct)}
              </span>
            )}
            <LossChip step={s} />
          </span>
        </span>
        {i < steps.length - 1 && (
          <ChevronRight size={14} className="shrink-0 text-ink-subtle" aria-hidden="true" />
        )}
      </li>
    ))}
  </ol>
);

const LOCATION_LABEL: Record<LotLocation["kind"], string> = {
  JOB_WORKER: "at",
  IN_HOUSE: "in process on the floor",
  IN_HAND: "in hand, waiting for",
  FINISHED: "finished after",
};

export const LocationLine: React.FC<{ loc: LotLocation }> = ({ loc }) => (
  <li className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
    <span className="font-semibold tabular-nums text-ink">
      {loc.qty == null ? "Some" : formatQty(loc.qty, loc.uom)}
    </span>
    <span className="text-ink-muted">{LOCATION_LABEL[loc.kind]}</span>
    {loc.kind === "JOB_WORKER" ? (
      <span className="font-medium text-ink">
        {loc.jobWorkerName ?? "job worker"}{" "}
        <span className="text-ink-muted">({stepLabel(loc.stepName)})</span>
      </span>
    ) : (
      <span className="font-medium text-ink">{stepLabel(loc.stepName)}</span>
    )}
  </li>
);
