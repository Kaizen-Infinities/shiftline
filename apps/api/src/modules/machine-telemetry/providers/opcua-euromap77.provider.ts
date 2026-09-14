import type {
  AdapterDescription,
  GatewayConnectionConfig,
  GatewayCredentials,
  MachineProtocolAdapter,
  RawSample,
} from "../machine-telemetry.types";

/**
 * OPC UA adapter for machines exposing the EUROMAP 77 companion specification's information
 * model (unpinned -- P2-00's adapter posture). OPC UA's binary protocol (secure channels,
 * sessions, subscriptions over its own framing) is not something to hand-roll against raw
 * sockets with any confidence; a real implementation needs an OPC UA client library
 * (`node-opcua` is the maintained option) added as a dependency, then this adapter written
 * against EUROMAP 77's node ids for state, cycle and process values. That has not happened:
 * no OPC UA server, real or simulated, has driven this adapter. `connect`/`poll` refuse rather
 * than pretend.
 */
export class OpcuaEuromap77Adapter implements MachineProtocolAdapter {
  readonly kind = "OPCUA_EUROMAP77" as const;

  async connect(_config: GatewayConnectionConfig, _credentials: GatewayCredentials): Promise<void> {
    throw new Error(
      "OPCUA_EUROMAP77 is unpinned: it needs an OPC UA client library (e.g. node-opcua) and a real or simulated server to connect against. Use SIMULATOR instead."
    );
  }

  async poll(): Promise<RawSample[]> {
    throw new Error("OPCUA_EUROMAP77.poll() called without a working connect()");
  }

  subscribe(_onSample: (sample: RawSample) => void): void {
    // Unimplemented; OPC UA subscriptions are the natural push path once connect() is real.
  }

  async disconnect(): Promise<void> {
    // Nothing to release: connect() never establishes a session.
  }

  cursor(): Record<string, unknown> {
    return {};
  }

  describe(): AdapterDescription {
    return {
      kind: "OPCUA_EUROMAP77",
      pinned: false,
      supportsSubscribe: true,
      notes:
        "Needs an OPC UA client library (node-opcua) and EUROMAP 77 node ids confirmed against a real server. Never met hardware.",
    };
  }
}
