/**
 * Machine telemetry (P2-01, M1). Canonical signal vocabulary every adapter maps into, so
 * nothing downstream reads a vendor tag (`MachineSignalMap` does that translation, per gateway,
 * before a raw sample ever becomes a `MachineSignal` row). See P2-00 for the write path and the
 * adapter pattern this module follows.
 */
import type { GatewayAdapterKind, MachineSignalName, SignalDataType } from "@prisma/client";

export const MACHINE_SIGNAL_NAMES: MachineSignalName[] = [
  "STATE",
  "CYCLE_COMPLETE",
  "SHOT_COUNT",
  "PART_COUNT",
  "CYCLE_TIME",
  "BARREL_TEMP",
  "MOULD_TEMP",
  "INJECTION_PRESSURE",
  "ALARM",
];

export interface CanonicalSignalSpec {
  unit: string | null;
  dataType: SignalDataType;
  description: string;
}

/** Unit and datatype per canonical signal; adapters and the signal-map editor read this. */
export const CANONICAL_SIGNALS: Record<MachineSignalName, CanonicalSignalSpec> = {
  STATE: { unit: null, dataType: "TEXT", description: "Machine state (RUNNING, IDLE, ALARM, ...)" },
  CYCLE_COMPLETE: { unit: null, dataType: "TEXT", description: "One tick per completed cycle" },
  SHOT_COUNT: { unit: "count", dataType: "NUMERIC", description: "Cumulative shot counter" },
  PART_COUNT: { unit: "count", dataType: "NUMERIC", description: "Cumulative good-part counter" },
  CYCLE_TIME: { unit: "s", dataType: "NUMERIC", description: "Actual cycle time of the last shot" },
  BARREL_TEMP: { unit: "°C", dataType: "NUMERIC", description: "Barrel/zone temperature" },
  MOULD_TEMP: { unit: "°C", dataType: "NUMERIC", description: "Mould temperature" },
  INJECTION_PRESSURE: { unit: "bar", dataType: "NUMERIC", description: "Peak injection pressure" },
  ALARM: { unit: null, dataType: "TEXT", description: "Alarm code raised or cleared" },
};

/** A sample as an adapter reads it off the device: still in the vendor's own tag vocabulary. */
export interface RawSample {
  vendorTag: string;
  timestamp: Date;
  numericValue?: number;
  textValue?: string;
}

/** A sample after `MachineSignalMap` has translated its vendor tag into a canonical signal. */
export interface CanonicalSample {
  signal: MachineSignalName;
  timestamp: Date;
  numericValue?: number;
  textValue?: string;
}

export interface GatewayConnectionConfig {
  [key: string]: unknown;
}

export interface GatewayCredentials {
  [key: string]: unknown;
}

export interface AdapterDescription {
  kind: GatewayAdapterKind;
  /** False until the adapter has met real hardware; every acceptance test runs on SIMULATOR. */
  pinned: boolean;
  supportsSubscribe: boolean;
  notes: string;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    /** Whether a retry can help (network, transient) as opposed to bad configuration. */
    public readonly retryable = true
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

/**
 * One connection to one gateway. `connect` establishes the session, `poll` returns whatever
 * raw samples have arrived since the last call (empty when there are none), `subscribe` is for
 * adapters that push rather than get polled (not used by the P2-01 ingestion job, which is
 * poll-only; kept on the interface so a push-capable adapter has somewhere to plug in later),
 * `disconnect` tears the session down, and `describe` reports the adapter's own posture.
 *
 * `providerFor()` builds a fresh adapter instance per call -- pg-boss jobs are short-lived, not
 * a held-open connection -- so an adapter that needs to resume where it left off (the simulator's
 * script position; a real adapter's read cursor) reads that position from `config` in `connect`
 * and reports the updated position from `cursor()` after polling. The ingestion service persists
 * whatever `cursor()` returns back into the gateway's `connectionSettings` for the next poll.
 * Adapters with nothing to resume (the device itself tracks "since last read") return `{}`.
 */
export interface MachineProtocolAdapter {
  readonly kind: GatewayAdapterKind;
  connect(config: GatewayConnectionConfig, credentials: GatewayCredentials): Promise<void>;
  poll(): Promise<RawSample[]>;
  subscribe(onSample: (sample: RawSample) => void): void;
  disconnect(): Promise<void>;
  describe(): AdapterDescription;
  cursor(): Record<string, unknown>;
}
