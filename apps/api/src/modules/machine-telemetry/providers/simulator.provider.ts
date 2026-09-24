import type {
  AdapterDescription,
  GatewayConnectionConfig,
  GatewayCredentials,
  MachineProtocolAdapter,
  RawSample,
} from "../machine-telemetry.types";

/**
 * Deterministic, seeded simulator. This is what every P2-01 acceptance test runs against, and
 * the only adapter marked pinned -- it has "met" its hardware by construction.
 *
 * Each `poll()` call advances one step of a fixed script and returns that step's raw samples,
 * still in the simulator's own vendor tags (`SIM.*`) so the signal-map translation this module
 * exercises is real, not a shortcut. The script drives one machine through SETUP -> RUNNING,
 * five completed cycles, a jam (ALARM + BREAKDOWN) after the third, and a recovery back to
 * RUNNING -- then loops, so a long poll history stays deterministic without growing the script.
 * Continuous values (temperatures, pressure, cycle time) get small seeded jitter around a
 * baseline; discrete events (state, alarm, counts) are exact, so the acceptance test can assert
 * on them precisely.
 */
const SCRIPT_LENGTH = 9;
const CYCLE_SECONDS = 24.5;

/** mulberry32: tiny, fast, and fully reproducible for a given seed. */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Ticks (mod SCRIPT_LENGTH) that complete a cycle -- see the switch in `poll()` below. */
const CYCLE_TICKS = new Set([1, 2, 3, 4, 6, 7]);

/** How many cycles the script has completed strictly before `step` -- pure, so the cumulative
 * shot/part counters can be recomputed on resume instead of persisted alongside the cursor. */
const cyclesCompletedBefore = (step: number): number => {
  let n = 0;
  for (let i = 0; i < step; i++) if (CYCLE_TICKS.has(i % SCRIPT_LENGTH)) n += 1;
  return n;
};

export class SimulatorAdapter implements MachineProtocolAdapter {
  readonly kind = "SIMULATOR" as const;
  private connected = false;
  private step = 0;
  private shotCount = 0;
  private partCount = 0;
  private readonly rng: () => number;
  private readonly startedAt: Date;

  constructor(seed = 42, startedAt: Date = new Date("2030-01-01T00:00:00.000Z")) {
    this.rng = mulberry32(seed);
    this.startedAt = startedAt;
  }

  async connect(config: GatewayConnectionConfig, _credentials: GatewayCredentials): Promise<void> {
    this.step = Number(config._cursor ?? 0) || 0;
    this.shotCount = cyclesCompletedBefore(this.step);
    this.partCount = this.shotCount;
    this.connected = true;
  }

  cursor(): Record<string, unknown> {
    return { _cursor: this.step };
  }

  async poll(): Promise<RawSample[]> {
    if (!this.connected) throw new Error("SimulatorAdapter.poll() called before connect()");
    const at = new Date(this.startedAt.getTime() + this.step * CYCLE_SECONDS * 1000);
    const tick = this.step % SCRIPT_LENGTH;
    this.step += 1;

    const jitter = (base: number, spread: number) => base + (this.rng() - 0.5) * spread;
    const temps = (): RawSample[] => [
      { vendorTag: "SIM.BARREL_TEMP", timestamp: at, numericValue: round1(jitter(210, 4)) },
      { vendorTag: "SIM.MOULD_TEMP", timestamp: at, numericValue: round1(jitter(45, 2)) },
      { vendorTag: "SIM.INJECTION_PRESSURE", timestamp: at, numericValue: round1(jitter(850, 20)) },
    ];
    const completeCycle = (): RawSample[] => {
      this.shotCount += 1;
      this.partCount += 1;
      return [
        { vendorTag: "SIM.CYCLE_COMPLETE", timestamp: at, textValue: String(this.shotCount) },
        { vendorTag: "SIM.SHOT_COUNT", timestamp: at, numericValue: this.shotCount },
        { vendorTag: "SIM.PART_COUNT", timestamp: at, numericValue: this.partCount },
        {
          vendorTag: "SIM.CYCLE_TIME",
          timestamp: at,
          numericValue: round1(jitter(CYCLE_SECONDS, 0.6)),
        },
        ...temps(),
      ];
    };

    switch (tick) {
      case 0:
        return [{ vendorTag: "SIM.STATE", timestamp: at, textValue: "SETUP" }];
      case 1:
        return [
          { vendorTag: "SIM.STATE", timestamp: at, textValue: "RUNNING" },
          ...completeCycle(),
        ];
      case 2:
      case 3:
        return completeCycle();
      case 4:
        // The jam: this cycle's completion is immediately followed by an alarm and a breakdown.
        return [
          ...completeCycle(),
          { vendorTag: "SIM.ALARM", timestamp: at, textValue: "E-204 SCREW_JAM" },
          { vendorTag: "SIM.STATE", timestamp: at, textValue: "BREAKDOWN" },
        ];
      case 5:
        // Recovery: alarm clears, state returns to RUNNING, no cycle completes this tick.
        return [
          { vendorTag: "SIM.ALARM", timestamp: at, textValue: "" },
          { vendorTag: "SIM.STATE", timestamp: at, textValue: "RUNNING" },
        ];
      case 6:
      case 7:
        return completeCycle();
      default:
        return temps();
    }
  }

  subscribe(_onSample: (sample: RawSample) => void): void {
    // Poll-only for P2-01's ingestion job (P2-00); kept on the interface for a future
    // push-capable adapter (e.g. MODBUS_MQTT) to use once one exists.
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  describe(): AdapterDescription {
    return {
      kind: "SIMULATOR",
      pinned: true,
      supportsSubscribe: false,
      notes: "Deterministic, seeded script (setup, run, jam, recovery, loop). No real device.",
    };
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
