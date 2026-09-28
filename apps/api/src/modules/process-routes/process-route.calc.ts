/**
 * Pure calculations for multi-step process routes (TN-06): a lot of knit fabric goes knitting →
 * dyeing → compacting → printing → stitching, a lot of castings goes foundry → fettling →
 * machining, some steps in-house and some at a job worker. This file works out, from the route's
 * steps and the lot's movements, the quantity sent and received per step with the unit change
 * (KG in, PCS out), the process loss against the norm, the cumulative yield, where the lot sits
 * right now, and whether a new movement is allowed. No database access, so the unit test covers
 * every rule. Quantities are summed in thousandths (the column scale) to avoid float drift.
 */

export const STEP_MODES = ["IN_HOUSE", "JOB_WORK"] as const;
export type StepMode = (typeof STEP_MODES)[number];

export const LOT_STATUSES = ["OPEN", "COMPLETED", "CANCELLED"] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const DIRECTIONS = ["OUT", "IN"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type StepState = "NOT_STARTED" | "IN_PROCESS" | "DONE";

/** Step names offered in the route editor; free text is accepted too. */
export const STEP_NAME_PRESETS = [
  "KNITTING",
  "DYEING",
  "COMPACTING",
  "PRINTING",
  "EMBROIDERY",
  "STITCHING",
  "CHECKING",
  "PACKING",
  "CASTING",
  "FETTLING",
  "HEAT_TREATMENT",
  "MACHINING",
  "PAINTING",
  "ASSEMBLY",
] as const;

/**
 * How far a return may exceed what was sent (after the unit conversion) before it is refused:
 * weighing differences and moisture regain after dyeing or compacting. Beyond it the entry is a
 * mistake, not a gain.
 */
export const GAIN_TOLERANCE_PCT = 2;

export interface RouteTemplateStep {
  name: string;
  mode: StepMode;
  uomIn: string;
  uomOut: string;
  conversionFactor: number | null;
  lossNormPct: number;
}

/** Starting points for the route editor; everything can be changed before saving. */
export const ROUTE_TEMPLATES: { key: string; name: string; steps: RouteTemplateStep[] }[] = [
  {
    key: "TIRUPPUR_KNITWEAR",
    name: "Knitwear: knitting → dyeing → compacting → printing → stitching",
    steps: [
      step("KNITTING", "JOB_WORK", "KG", "KG", null, 1.5),
      step("DYEING", "JOB_WORK", "KG", "KG", null, 8),
      step("COMPACTING", "JOB_WORK", "KG", "KG", null, 1),
      step("PRINTING", "JOB_WORK", "KG", "KG", null, 1),
      step("STITCHING", "IN_HOUSE", "KG", "PCS", 4, 3),
    ],
  },
  {
    key: "COIMBATORE_CASTING",
    name: "Castings: foundry → fettling → machining",
    steps: [
      step("CASTING", "JOB_WORK", "KG", "PCS", 0.4, 0),
      step("FETTLING", "IN_HOUSE", "PCS", "PCS", null, 1),
      step("MACHINING", "JOB_WORK", "PCS", "PCS", null, 2),
    ],
  },
];

function step(
  name: string,
  mode: StepMode,
  uomIn: string,
  uomOut: string,
  conversionFactor: number | null,
  lossNormPct: number
): RouteTemplateStep {
  return { name, mode, uomIn, uomOut, conversionFactor, lossNormPct };
}

// ─── numbers ─────────────────────────────────────────────────────────────────

const toMilli = (q: number) => Math.round(q * 1000);
const fromMilli = (m: number) => m / 1000;
const pct2 = (v: number) => Math.round(v * 100) / 100;

export const sameUom = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * The factor that turns one unit in into units out: the step's own factor, 1 when the unit does
 * not change, or null when the units differ and no factor was given (then no loss can be worked
 * out for the step).
 */
export const effectiveFactor = (s: { uomIn: string; uomOut: string; factor: number | null }) =>
  s.factor != null && s.factor > 0 ? s.factor : sameUom(s.uomIn, s.uomOut) ? 1 : null;

/** What `qty` units in should become in units out at full yield (KG → PCS). */
export const convertQty = (qty: number, factor: number | null) =>
  factor == null ? null : fromMilli(Math.round(toMilli(qty) * factor));

/** Loss % of what should have come back; negative when more came back than expected. */
export const lossPct = (expectedOut: number, receivedOut: number) =>
  expectedOut > 0 ? pct2(((expectedOut - receivedOut) / expectedOut) * 100) : null;

// ─── route checks ────────────────────────────────────────────────────────────

export interface StepDraft {
  name: string;
  mode: StepMode;
  uomIn: string;
  uomOut: string;
  conversionFactor?: number | null;
  lossNormPct?: number;
  defaultJobWorkerId?: string | null;
}

/**
 * Checks a route's ordered steps: what leaves a step in its unit out is what the next step takes
 * in, an in-house step has no job worker, and a factor on a step that keeps its unit is 1.
 * Returns the first problem, or null.
 */
export function checkRouteSteps(steps: StepDraft[]): string | null {
  if (steps.length === 0) return "A route needs at least one step";
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const label = `Step ${i + 1} (${s.name})`;
    if (s.mode === "IN_HOUSE" && s.defaultJobWorkerId) {
      return `${label} is in-house, so it cannot have a job worker`;
    }
    if (
      sameUom(s.uomIn, s.uomOut) &&
      s.conversionFactor != null &&
      Math.abs(s.conversionFactor - 1) > 1e-9
    ) {
      return `${label} keeps the unit ${s.uomIn}, so its conversion factor must be 1 or blank`;
    }
    if (i > 0 && !sameUom(steps[i - 1].uomOut, s.uomIn)) {
      return `${label} takes ${s.uomIn} but step ${i} gives ${steps[i - 1].uomOut}; the units must chain`;
    }
  }
  return null;
}

// ─── lot progress ────────────────────────────────────────────────────────────

export interface RouteStep {
  id: string;
  seq: number;
  name: string;
  mode: StepMode;
  uomIn: string;
  uomOut: string;
  factor: number | null;
  lossNormPct: number;
}

export interface Movement {
  stepSeq: number;
  direction: Direction;
  qty: number;
  /** Who holds it: the job worker, or null for in-house. */
  jobWorkerId: string | null;
  /** YYYY-MM-DD */
  date: string;
  /** On an IN movement: this receipt finishes the step; what has not come back is loss. */
  closesStep?: boolean;
}

export interface Holder {
  jobWorkerId: string | null;
  sent: number;
  /** In the step's unit out. */
  received: number;
  /** Still at the holder, in the step's unit in; 0 once the step is done. Null without a factor. */
  wip: number | null;
}

export interface StepProgress {
  seq: number;
  name: string;
  mode: StepMode;
  uomIn: string;
  uomOut: string;
  factor: number | null;
  lossNormPct: number;
  state: StepState;
  sent: number;
  received: number;
  /** What was sent, converted to the unit out at full yield. */
  expectedOut: number | null;
  /** Loss in the unit out (expected − received); interim until the step is done. */
  lossQty: number | null;
  lossPct: number | null;
  /** Only judged once the step is done. */
  overNorm: boolean;
  yieldPct: number | null;
  /** Waiting to be sent to this step, in its unit in. */
  availableToSend: number;
  firstOutDate: string | null;
  firstInDate: string | null;
  holders: Holder[];
}

export type LocationKind = "JOB_WORKER" | "IN_HOUSE" | "IN_HAND" | "FINISHED";

export interface Location {
  kind: LocationKind;
  stepSeq: number;
  stepName: string;
  jobWorkerId: string | null;
  qty: number | null;
  uom: string;
}

export interface LotProgress {
  steps: StepProgress[];
  /** The first step not yet done; steps.length + 1 once every step is done. */
  currentSeq: number;
  finalOutput: number;
  finalUom: string;
  /** Product of the finished steps' yields; null while a finished step has no factor. */
  cumulativeYieldPct: number | null;
  /** What the norms allow over the same finished steps. */
  normYieldPct: number | null;
  overNormSteps: number;
  locations: Location[];
  closeBlockers: string[];
}

const minDate = (a: string | null, b: string) => (a == null || b < a ? b : a);

export function computeLot(
  steps: RouteStep[],
  input: { qty: number; status?: LotStatus },
  movements: Movement[]
): LotProgress {
  const ordered = [...steps].sort((a, b) => a.seq - b.seq);
  const progress: StepProgress[] = [];
  let prevReceivedM = toMilli(input.qty);

  for (const s of ordered) {
    const own = movements.filter((m) => m.stepSeq === s.seq);
    const factor = effectiveFactor(s);
    const holders = new Map<string, { id: string | null; sentM: number; recvM: number }>();
    let sentM = 0;
    let recvM = 0;
    let firstOut: string | null = null;
    let firstIn: string | null = null;
    let done = false;
    for (const m of own) {
      const key = m.jobWorkerId ?? "";
      const h = holders.get(key) ?? { id: m.jobWorkerId, sentM: 0, recvM: 0 };
      if (m.direction === "OUT") {
        h.sentM += toMilli(m.qty);
        sentM += toMilli(m.qty);
        firstOut = minDate(firstOut, m.date);
      } else {
        h.recvM += toMilli(m.qty);
        recvM += toMilli(m.qty);
        firstIn = minDate(firstIn, m.date);
        if (m.closesStep) done = true;
      }
      holders.set(key, h);
    }
    const sent = fromMilli(sentM);
    const received = fromMilli(recvM);
    const expectedOut = convertQty(sent, factor);
    const lossQty = expectedOut == null ? null : fromMilli(toMilli(expectedOut) - recvM);
    const lp = expectedOut == null ? null : lossPct(expectedOut, received);
    const yieldPct = lp == null ? null : pct2(100 - lp);
    progress.push({
      seq: s.seq,
      name: s.name,
      mode: s.mode,
      uomIn: s.uomIn,
      uomOut: s.uomOut,
      factor,
      lossNormPct: s.lossNormPct,
      state: done ? "DONE" : sentM > 0 ? "IN_PROCESS" : "NOT_STARTED",
      sent,
      received,
      expectedOut,
      lossQty,
      lossPct: lp,
      overNorm: done && lp != null && lp > s.lossNormPct + 1e-9,
      yieldPct,
      availableToSend: fromMilli(Math.max(0, prevReceivedM - sentM)),
      firstOutDate: firstOut,
      firstInDate: firstIn,
      holders: [...holders.values()].map((h) => ({
        jobWorkerId: h.id,
        sent: fromMilli(h.sentM),
        received: fromMilli(h.recvM),
        wip: done
          ? 0
          : factor == null
            ? h.recvM === 0
              ? fromMilli(h.sentM)
              : null
            : fromMilli(Math.max(0, h.sentM - Math.round(h.recvM / factor))),
      })),
    });
    prevReceivedM = recvM;
  }

  const current = progress.find((p) => p.state !== "DONE");
  const last = progress[progress.length - 1];
  const doneSteps = progress.filter((p) => p.state === "DONE");
  let cumulative: number | null = doneSteps.length > 0 ? 1 : null;
  let norm: number | null = doneSteps.length > 0 ? 1 : null;
  for (const p of doneSteps) {
    cumulative = cumulative == null || p.yieldPct == null ? null : cumulative * (p.yieldPct / 100);
    norm = norm == null ? null : norm * (1 - p.lossNormPct / 100);
  }

  const locations: Location[] = [];
  for (const p of progress) {
    if (p.availableToSend > 0 && input.status !== "CANCELLED") {
      const lastDone = p.seq === last?.seq && p.state === "DONE";
      if (!lastDone) {
        locations.push({
          kind: "IN_HAND",
          stepSeq: p.seq,
          stepName: p.name,
          jobWorkerId: null,
          qty: p.availableToSend,
          uom: p.uomIn,
        });
      }
    }
    if (p.state !== "IN_PROCESS") continue;
    for (const h of p.holders) {
      if (h.wip === 0) continue;
      locations.push({
        kind: h.jobWorkerId ? "JOB_WORKER" : "IN_HOUSE",
        stepSeq: p.seq,
        stepName: p.name,
        jobWorkerId: h.jobWorkerId,
        qty: h.wip,
        uom: p.uomIn,
      });
    }
  }
  if (last && last.received > 0) {
    locations.push({
      kind: "FINISHED",
      stepSeq: last.seq,
      stepName: last.name,
      jobWorkerId: null,
      qty: last.received,
      uom: last.uomOut,
    });
  }

  const closeBlockers = progress
    .filter((p) => p.state !== "DONE")
    .map((p) =>
      p.state === "NOT_STARTED"
        ? `Step ${p.seq} (${p.name}) has not started`
        : `Step ${p.seq} (${p.name}) is still in process`
    );

  return {
    steps: progress,
    currentSeq: current ? current.seq : progress.length + 1,
    finalOutput: last ? last.received : 0,
    finalUom: last ? last.uomOut : "",
    cumulativeYieldPct: cumulative == null ? null : pct2(cumulative * 100),
    normYieldPct: norm == null ? null : pct2(norm * 100),
    overNormSteps: progress.filter((p) => p.overNorm).length,
    locations,
    closeBlockers,
  };
}

// ─── movement rules ──────────────────────────────────────────────────────────

export interface MovementDraft {
  stepSeq: number;
  direction: Direction;
  qty: number;
  jobWorkerId: string | null;
  date: string;
}

export type MovementCheck =
  { ok: true; jobWorkerId: string | null } | { ok: false; status: 400 | 409; message: string };

const fmt = (q: number) => String(Math.round(q * 1000) / 1000);

/**
 * Whether a movement may be recorded on a lot, given its progress so far. Steps run in order
 * (nothing goes to a step before the previous one has returned something), a step cannot receive
 * more than was sent to it beyond the gain tolerance, a finished step takes nothing more, and the
 * dates follow the flow. On IN at a job-work step with one holder, the job worker is filled in.
 */
export function checkMovement(
  lot: LotProgress,
  input: { startDate: string },
  mv: MovementDraft
): MovementCheck {
  const p = lot.steps.find((s) => s.seq === mv.stepSeq);
  if (!p) return { ok: false, status: 400, message: "That step is not on this lot's route" };
  if (p.state === "DONE") {
    return { ok: false, status: 409, message: `Step ${p.seq} (${p.name}) is already complete` };
  }
  if (p.mode === "IN_HOUSE" && mv.jobWorkerId) {
    return {
      ok: false,
      status: 400,
      message: `Step ${p.seq} (${p.name}) is in-house, so no job worker holds it`,
    };
  }
  if (mv.date < input.startDate) {
    return { ok: false, status: 400, message: "A movement cannot be dated before the lot started" };
  }

  if (mv.direction === "OUT") {
    const prev = lot.steps.find((s) => s.seq === mv.stepSeq - 1);
    if (prev && prev.received <= 0) {
      return {
        ok: false,
        status: 400,
        message: `Step ${prev.seq} (${prev.name}) has not returned anything yet; steps run in order`,
      };
    }
    if (prev?.firstInDate && mv.date < prev.firstInDate) {
      return {
        ok: false,
        status: 400,
        message: `It cannot go to ${p.name} before it came back from ${prev.name} (${prev.firstInDate})`,
      };
    }
    if (toMilli(mv.qty) > toMilli(p.availableToSend)) {
      return {
        ok: false,
        status: 400,
        message: `Only ${fmt(p.availableToSend)} ${p.uomIn} is available to send to ${p.name}`,
      };
    }
    if (p.mode === "JOB_WORK" && !mv.jobWorkerId) {
      return { ok: false, status: 400, message: `Pick the job worker doing ${p.name}` };
    }
    return { ok: true, jobWorkerId: mv.jobWorkerId };
  }

  // IN
  if (p.sent <= 0) {
    return {
      ok: false,
      status: 400,
      message: `Nothing has been sent to step ${p.seq} (${p.name}) yet`,
    };
  }
  let holder: Holder | undefined;
  if (p.mode === "JOB_WORK") {
    const withStock = p.holders.filter((h) => h.sent > 0);
    if (mv.jobWorkerId) {
      holder = p.holders.find((h) => h.jobWorkerId === mv.jobWorkerId);
      if (!holder) {
        return {
          ok: false,
          status: 400,
          message: `Nothing was sent to that job worker for ${p.name}`,
        };
      }
    } else if (withStock.length === 1) {
      holder = withStock[0];
    } else {
      return { ok: false, status: 400, message: "Pick which job worker returned it" };
    }
  } else {
    holder = p.holders.find((h) => h.jobWorkerId === null);
  }
  if (!holder) return { ok: false, status: 400, message: "Nothing is in process at that step" };
  if (p.firstOutDate && mv.date < p.firstOutDate) {
    return {
      ok: false,
      status: 400,
      message: `It cannot come back from ${p.name} before it was sent (${p.firstOutDate})`,
    };
  }
  const expected = convertQty(holder.sent, p.factor);
  if (expected != null) {
    const capM = Math.floor(toMilli(expected) * (1 + GAIN_TOLERANCE_PCT / 100));
    if (toMilli(holder.received) + toMilli(mv.qty) > capM) {
      const left = fromMilli(Math.max(0, capM - toMilli(holder.received)));
      return {
        ok: false,
        status: 400,
        message: `That is more than was sent: at most ${fmt(left)} ${p.uomOut} more can come back from ${p.name} (${fmt(holder.sent)} ${p.uomIn} sent, ${GAIN_TOLERANCE_PCT}% tolerance)`,
      };
    }
  }
  return { ok: true, jobWorkerId: holder.jobWorkerId };
}
