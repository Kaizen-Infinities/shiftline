import React, { useEffect, useState } from "react";

import { usePermission } from "../../../hooks/usePermission";
import { machineTelemetryReadService } from "../../../services/machineTelemetryService";
import type { MachineGatewayRow } from "../../../services/machineTelemetryService";

/** Machine detail's telemetry health strip (P2-01): every gateway configured for this machine,
 * at a glance, without leaving the machine screen for /settings/machine-gateways. */
const MachineTelemetryHealthStrip: React.FC<{ machineId: string }> = ({ machineId }) => {
  const { can, hasFeature } = usePermission();
  const [gateways, setGateways] = useState<MachineGatewayRow[] | null>(null);

  useEffect(() => {
    if (!can("machine-telemetry.view") || !hasFeature("shop-floor")) return;
    let cancelled = false;
    void machineTelemetryReadService
      .health()
      .then((rows) => {
        if (!cancelled) setGateways(rows.filter((r) => r.machineId === machineId));
      })
      .catch(() => {
        if (!cancelled) setGateways([]);
      });
    return () => {
      cancelled = true;
    };
  }, [machineId, can, hasFeature]);

  if (!can("machine-telemetry.view") || !hasFeature("shop-floor")) return null;
  if (gateways === null) return null;
  if (gateways.length === 0) {
    return (
      <p className="mt-3 text-xs text-ink-muted">
        No telemetry gateway configured for this machine yet.{" "}
        <a href="/settings/machine-gateways" className="text-blue-600 hover:underline">
          Set one up
        </a>
        .
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-line-soft bg-card-2 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Telemetry</p>
      <ul className="space-y-1">
        {gateways.map((g) => (
          <li key={g.id} className="flex items-center gap-2 text-sm text-ink">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                !g.isActive
                  ? "bg-ink-muted"
                  : g.consecutiveFailures > 0
                    ? "bg-rose-500"
                    : "bg-emerald-500"
              }`}
            />
            <span className="font-mono text-xs">{g.code}</span>
            <span className="text-ink-muted">({g.adapterKind})</span>
            {g.consecutiveFailures > 0 && (
              <span className="text-rose-700">{g.consecutiveFailures} failing polls</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MachineTelemetryHealthStrip;
