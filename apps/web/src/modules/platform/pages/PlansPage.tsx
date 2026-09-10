import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";

import { platformService, type Plan } from "../../../services/platformService";
import { Badge, message, td, th } from "../platform.ui";

/** Plan catalogue (P1-02). Editing stays on the API for now (PUT /platform/plans/:code). */
const PlansPage: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => {
    platformService
      .plans()
      .then((p) => setPlans(Array.isArray(p) ? p : p.plans))
      .catch((err) => toast.error(message(err)));
  }, []);
  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">Plans</h2>
        <p className="text-sm text-ink-muted">
          What each plan includes. Tenants inherit from here unless overridden.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Plan</th>
              <th className={th}>Features</th>
              <th className={`${th} text-right`}>Seats</th>
              <th className={`${th} text-right`}>API / 15 min</th>
              <th className={`${th} text-right`}>₹ / month</th>
              <th className={th}>State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {plans.map((p) => (
              <tr key={p.code}>
                <td className={td}>
                  <b>{p.name}</b> <span className="text-xs text-ink-subtle">{p.code}</span>
                  {p.description && <div className="text-xs text-ink-muted">{p.description}</div>}
                </td>
                <td className={`${td} text-xs`}>{p.features.join(", ")}</td>
                <td className={`${td} text-right tabular-nums`}>{p.seatLimit ?? "∞"}</td>
                <td className={`${td} text-right tabular-nums`}>{p.apiLimit ?? "∞"}</td>
                <td className={`${td} text-right tabular-nums`}>{p.priceInrMonthly ?? "—"}</td>
                <td className={td}>
                  <Badge value={p.isActive ? "active" : "CANCELLED"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PlansPage;
