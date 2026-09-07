import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import { platformService, type PlatformOverview } from "../../../services/platformService";
import { Badge, Section, Stat, message, secondary, td, th, when } from "../platform.ui";

/** Platform console landing page (P1-02): the fleet at a glance and who is impersonating whom. */
const PlatformOverviewPage: React.FC = () => {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await platformService.overview());
    } catch (err) {
      toast.error(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const end = async (id: string) => {
    setBusy(id);
    try {
      await platformService.endImpersonation(id);
      toast.success("Impersonation ended");
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">Platform Overview</h2>
        <p className="text-sm text-ink-muted">
          Every tenant on this Shiftline instance. Numbers refresh on each visit.
        </p>
      </div>
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Tenants"
              value={data.tenants.total}
              hint={`${data.tenants.active} active · ${data.tenants.suspended} suspended · ${data.tenants.onboarded} onboarded`}
            />
            <Stat label="Active users" value={data.activeUsers} />
            <Stat label="Field devices" value={data.activeDevices} />
            <Stat
              label="Live impersonations"
              value={data.activeImpersonations.length}
              hint="30-minute windows"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Subscriptions by status">
              <ul className="space-y-1 text-sm">
                {Object.entries(data.subscriptionsByStatus).map(([status, n]) => (
                  <li key={status} className="flex justify-between">
                    <Badge value={status} />
                    <span className="tabular-nums">{n}</span>
                  </li>
                ))}
                {Object.keys(data.subscriptionsByStatus).length === 0 && (
                  <li className="text-ink-muted">No subscriptions yet.</li>
                )}
              </ul>
            </Section>
            <Section title="Subscriptions by plan">
              <ul className="space-y-1 text-sm">
                {data.subscriptionsByPlan.map((r) => (
                  <li key={r.plan.id} className="flex justify-between">
                    <span>
                      {r.plan.name ?? r.plan.code ?? r.plan.id}{" "}
                      <span className="text-ink-subtle">{r.plan.code}</span>
                    </span>
                    <span className="tabular-nums">{r.count}</span>
                  </li>
                ))}
                {data.subscriptionsByPlan.length === 0 && (
                  <li className="text-ink-muted">No subscriptions yet.</li>
                )}
              </ul>
            </Section>
          </div>
          <Section
            title="Active impersonations"
            right={
              <Link to="/platform/tenants" className="text-xs text-blue-700 hover:underline">
                All tenants
              </Link>
            }
          >
            {data.activeImpersonations.length === 0 ? (
              <p className="text-sm text-ink-muted">Nobody is acting as a tenant user right now.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-line-soft">
                  <thead>
                    <tr>
                      <th className={th}>Admin</th>
                      <th className={th}>Tenant</th>
                      <th className={th}>As user</th>
                      <th className={th}>Reason</th>
                      <th className={th}>Ends</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {data.activeImpersonations.map((r) => (
                      <tr key={r.id}>
                        <td className={td}>{r.admin.fullName ?? r.admin.username ?? r.adminId}</td>
                        <td className={td}>
                          <Link
                            to={`/platform/tenants/${r.company.id}`}
                            className="text-blue-700 hover:underline"
                          >
                            {r.company.companyName ?? r.company.id}
                          </Link>
                        </td>
                        <td className={td}>{r.user.fullName ?? r.user.username}</td>
                        <td className={`${td} text-ink-muted`}>{r.reason}</td>
                        <td className={td}>{when(r.expiresAt)}</td>
                        <td className={td}>
                          <button
                            type="button"
                            className={secondary}
                            disabled={busy === r.id}
                            onClick={() => end(r.id)}
                          >
                            End
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
};

export default PlatformOverviewPage;
