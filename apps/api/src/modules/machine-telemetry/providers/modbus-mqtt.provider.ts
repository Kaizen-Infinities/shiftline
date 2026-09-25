import type {
  AdapterDescription,
  GatewayConnectionConfig,
  GatewayCredentials,
  MachineProtocolAdapter,
  RawSample,
} from "../machine-telemetry.types";

/**
 * Modbus TCP register reads bridged onto MQTT publish (unpinned -- P2-00's adapter posture),
 * for machines and energy meters that speak Modbus but sit behind a gateway that republishes
 * registers as MQTT topics rather than exposing the Modbus port directly. A real implementation
 * needs a Modbus client (`modbus-serial`) or an MQTT client (`mqtt`) depending on which side of
 * the bridge the gateway is configured to reach, plus the register/topic map for the specific
 * meter or PLC. Neither has been added, and no broker or device has driven this adapter.
 * `connect`/`poll` refuse rather than pretend.
 */
export class ModbusMqttAdapter implements MachineProtocolAdapter {
  readonly kind = "MODBUS_MQTT" as const;

  async connect(_config: GatewayConnectionConfig, _credentials: GatewayCredentials): Promise<void> {
    throw new Error(
      "MODBUS_MQTT is unpinned: it needs a Modbus client (modbus-serial) or MQTT client (mqtt) and a real broker/device to connect against. Use SIMULATOR instead."
    );
  }

  async poll(): Promise<RawSample[]> {
    throw new Error("ModbusMqttAdapter.poll() called without a working connect()");
  }

  subscribe(_onSample: (sample: RawSample) => void): void {
    // Unimplemented; MQTT's own subscribe is the natural push path once connect() is real.
  }

  async disconnect(): Promise<void> {
    // Nothing to release: connect() never establishes a session.
  }

  cursor(): Record<string, unknown> {
    return {};
  }

  describe(): AdapterDescription {
    return {
      kind: "MODBUS_MQTT",
      pinned: false,
      supportsSubscribe: true,
      notes:
        "Needs a Modbus (modbus-serial) or MQTT (mqtt) client library and a real gateway's register/topic map. Never met hardware.",
    };
  }
}
