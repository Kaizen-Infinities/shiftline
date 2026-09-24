import { readFile } from "node:fs/promises";

import type {
  AdapterDescription,
  GatewayConnectionConfig,
  GatewayCredentials,
  MachineProtocolAdapter,
  RawSample,
} from "../machine-telemetry.types";

/**
 * EUROMAP 63 file-exchange adapter (unpinned -- P2-00's adapter posture). EUROMAP 63 machines
 * write their status as key/value tags (traditionally "SnnN" identifiers, e.g. S1 machine
 * status, S2 cycle time) to a shared file the host polls; `config.filePath` names that file.
 * The read-and-diff mechanism below is real and works against any JSON file shaped
 * `{ "<vendorTag>": <value>, ... }` written since the last poll -- that much is testable without
 * a machine. What is NOT pinned is the exact EUROMAP 63 tag dictionary and file format a real
 * press writes; confirm both against the owner's press and the EUROMAP 63 spec before trusting
 * the vendor-tag names this ships with, and update `machine-telemetry.job.ts`'s default signal
 * map for this adapter kind accordingly. No real EUROMAP 63 file has driven this adapter.
 */
interface Euromap63Config extends GatewayConnectionConfig {
  filePath?: string;
}

export class Euromap63FileAdapter implements MachineProtocolAdapter {
  readonly kind = "EUROMAP63_FILE" as const;
  private filePath: string | null = null;
  private lastValues = new Map<string, string>();

  async connect(config: GatewayConnectionConfig, _credentials: GatewayCredentials): Promise<void> {
    const cfg = config as Euromap63Config;
    if (!cfg.filePath) {
      throw new Error("EUROMAP63_FILE gateway needs connectionSettings.filePath");
    }
    this.filePath = cfg.filePath;
    const cursor = (config._cursor as Record<string, string>) ?? {};
    this.lastValues = new Map(Object.entries(cursor));
  }

  cursor(): Record<string, unknown> {
    return { _cursor: Object.fromEntries(this.lastValues) };
  }

  async poll(): Promise<RawSample[]> {
    if (!this.filePath) throw new Error("Euromap63FileAdapter.poll() called before connect()");
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (err) {
      throw new Error(
        `EUROMAP 63 status file unreadable at ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
    const parsed: Record<string, unknown> = JSON.parse(raw);
    const at = new Date();
    const samples: RawSample[] = [];
    for (const [tag, value] of Object.entries(parsed)) {
      const asString = String(value);
      // Only emit tags that changed since the last poll -- EUROMAP 63 files are a full status
      // snapshot, not a delta, so unchanged tags would otherwise duplicate every poll.
      if (this.lastValues.get(tag) === asString) continue;
      this.lastValues.set(tag, asString);
      const numericValue = typeof value === "number" ? value : Number(value);
      samples.push(
        Number.isFinite(numericValue) && typeof value !== "string"
          ? { vendorTag: tag, timestamp: at, numericValue }
          : { vendorTag: tag, timestamp: at, textValue: asString }
      );
    }
    return samples;
  }

  subscribe(_onSample: (sample: RawSample) => void): void {
    // File exchange has no push mode; the ingestion job polls.
  }

  async disconnect(): Promise<void> {
    this.filePath = null;
    this.lastValues.clear();
  }

  describe(): AdapterDescription {
    return {
      kind: "EUROMAP63_FILE",
      pinned: false,
      supportsSubscribe: false,
      notes:
        "Real file-poll mechanism; the EUROMAP 63 tag dictionary is illustrative and unconfirmed against a real press. Never met hardware.",
    };
  }
}
