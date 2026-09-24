import type { GatewayAdapterKind } from "@prisma/client";

import type { MachineProtocolAdapter } from "../machine-telemetry.types";
import { Euromap63FileAdapter } from "./euromap63-file.provider";
import { ModbusMqttAdapter } from "./modbus-mqtt.provider";
import { OpcuaEuromap77Adapter } from "./opcua-euromap77.provider";
import { SimulatorAdapter } from "./simulator.provider";

export const PROVIDERS: GatewayAdapterKind[] = [
  "SIMULATOR",
  "OPCUA_EUROMAP77",
  "EUROMAP63_FILE",
  "MODBUS_MQTT",
];

/** A fresh adapter instance per call -- adapters hold per-connection state (SIMULATOR's script
 * cursor, the file adapter's last-seen values), so callers must not share one across gateways. */
export const providerFor = (kind: GatewayAdapterKind): MachineProtocolAdapter => {
  switch (kind) {
    case "OPCUA_EUROMAP77":
      return new OpcuaEuromap77Adapter();
    case "EUROMAP63_FILE":
      return new Euromap63FileAdapter();
    case "MODBUS_MQTT":
      return new ModbusMqttAdapter();
    case "SIMULATOR":
    default:
      return new SimulatorAdapter();
  }
};
