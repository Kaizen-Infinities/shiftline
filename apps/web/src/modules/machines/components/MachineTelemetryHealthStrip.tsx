import React, { useEffect, useState } from "react";

import { Chip } from "../../../components/ui/v2";
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
      <p className="sl-muted m-0 mt-3 text-[13px]">
        No telemetry gateway configured for this machine yet.{" "}
        <a
          href="/settings/machine-gateways"
          className="font-semibold text-accent underline-offset-4 hover:underline"
        >
          Set one up
        </a>
        .
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-[14px] bg-card-2 p-3.5">
      <p className="sl-section-label m-0 mb-2">Telemetry</p>
      <ul className="m-0 list-none space-y-1.5 p-0">
        {gateways.map((g) => (
          <li key={g.id} className="flex items-center gap-2 text-sm text-ink">
            <Chip
              size="sm"
              dot
              tone={!g.isActive ? "muted" : g.consecutiveFailures > 0 ? "danger" : "success"}
            >
              {!g.isActive ? "Inactive" : g.consecutiveFailures > 0 ? "Failing" : "Healthy"}
            </Chip>
            <span className="font-mono text-xs">{g.code}</span>
            <span className="text-ink-muted">({g.adapterKind})</span>
            {g.consecutiveFailures > 0 && (
              <span className="text-[color:var(--color-danger)]">
                {g.consecutiveFailures} failing polls
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default MachineTelemetryHealthStrip;
