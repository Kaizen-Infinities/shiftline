import React, { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Layers } from "lucide-react";

import { platformService, type Plan } from "../../../services/platformService";
import { Chip, EmptyState, PageHeader, SkeletonTile } from "../../../components/ui/v2";
import { Badge, message } from "../platform.ui";

const inr = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === ""
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(Number(n));

/** Plan catalogue (P1-02). Editing stays on the API for now (PUT /platform/plans/:code). */
const PlansPage: React.FC = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    platformService
      .plans()
      .then((p) => setPlans(Array.isArray(p) ? p : p.plans))
      .catch((err) => toast.error(message(err)))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div className="sl-page">
      <PageHeader
        title="Plans"
        icon={<Layers size={22} />}
        subtitle="What each plan includes. Tenants inherit from here unless overridden."
        breadcrumbs={[{ label: "Platform", to: "/platform" }, { label: "Plans" }]}
      />
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonTile key={i} lines={5} />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="sl-tile">
          <EmptyState icon={<Layers size={28} />} title="No plans in the catalogue yet." />
        </div>
      ) : (
        <ul
          className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Plans"
        >
          {plans.map((p) => (
            <li key={p.code} className="sl-tile flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="sl-h2 m-0">{p.name}</h2>
                  <p className="m-0 mt-0.5 font-mono text-xs text-ink-muted">{p.code}</p>
                </div>
                <Badge value={p.isActive ? "active" : "CANCELLED"} />
              </div>
              {p.description && <p className="m-0 text-sm text-ink-muted">{p.description}</p>}
              <div>
                <span className="sl-stat-value">{inr(p.priceInrMonthly)}</span>
                {p.priceInrMonthly !== null && p.priceInrMonthly !== undefined && (
                  <span className="ml-1 text-sm text-ink-muted">/ month</span>
                )}
              </div>
              <dl className="m-0 grid grid-cols-2 gap-2">
                <div className="rounded-[12px] bg-card-2 px-3 py-2">
                  <dt className="text-xs text-ink-muted">Seats</dt>
                  <dd className="m-0 font-semibold tabular-nums text-ink">{p.seatLimit ?? "∞"}</dd>
                </div>
                <div className="rounded-[12px] bg-card-2 px-3 py-2">
                  <dt className="text-xs text-ink-muted">API / 15 min</dt>
                  <dd className="m-0 font-semibold tabular-nums text-ink">{p.apiLimit ?? "∞"}</dd>
                </div>
              </dl>
              {p.features.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {p.features.map((f) => (
                    <Chip key={f} size="sm">
                      {f}
                    </Chip>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default PlansPage;
