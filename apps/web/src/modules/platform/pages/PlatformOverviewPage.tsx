import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { Building2, Eye, Smartphone, Users } from "lucide-react";

import { platformService, type PlatformOverview } from "../../../services/platformService";
import { PageHeader, SkeletonTile, StatTile, actionPillClass } from "../../../components/ui/v2";
import { Badge, Section, message, secondary, td, th, when } from "../platform.ui";

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
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="Platform Overview"
        icon={<Building2 size={22} />}
        subtitle="Every tenant on this Shiftline instance. Numbers refresh on each visit."
        actions={
          <Link to="/platform/plans" className={actionPillClass({ variant: "secondary" })}>
            Plans
          </Link>
        }
        primaryAction={
          <Link to="/platform/tenants" className={actionPillClass({ size: "lg" })}>
            Manage tenants
          </Link>
        }
      />
      {!data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonTile key={i} lines={2} />
          ))}
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label="Tenants"
              value={data.tenants.total}
              icon={<Building2 size={18} />}
              to="/platform/tenants"
              hint={`${data.tenants.active} active · ${data.tenants.suspended} suspended · ${data.tenants.onboarded} onboarded`}
            />
            <StatTile label="Active users" value={data.activeUsers} icon={<Users size={18} />} />
            <StatTile
              label="Field devices"
              value={data.activeDevices}
              icon={<Smartphone size={18} />}
            />
            <StatTile
              label="Live impersonations"
              value={data.activeImpersonations.length}
              icon={<Eye size={18} />}
              hint="30-minute windows"
              delta={data.activeImpersonations.length > 0 ? "Live" : undefined}
              deltaTone="warning"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Subscriptions by status">
              <ul className="m-0 list-none space-y-2 p-0 text-sm">
                {Object.entries(data.subscriptionsByStatus).map(([status, n]) => (
                  <li
                    key={status}
                    className="flex items-center justify-between rounded-[12px] bg-card-2 px-3 py-2"
                  >
                    <Badge value={status} />
                    <span className="font-semibold tabular-nums">{n}</span>
                  </li>
                ))}
                {Object.keys(data.subscriptionsByStatus).length === 0 && (
                  <li className="text-ink-muted">No subscriptions yet.</li>
                )}
              </ul>
            </Section>
            <Section title="Subscriptions by plan">
              <ul className="m-0 list-none space-y-2 p-0 text-sm">
                {data.subscriptionsByPlan.map((r) => (
                  <li
                    key={r.plan.id}
                    className="flex items-center justify-between rounded-[12px] bg-card-2 px-3 py-2"
                  >
                    <span>
                      {r.plan.name ?? r.plan.code ?? r.plan.id}{" "}
                      <span className="text-ink-subtle">{r.plan.code}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{r.count}</span>
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
              <Link to="/platform/tenants" className={secondary}>
                All tenants
              </Link>
            }
          >
            {data.activeImpersonations.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">
                Nobody is acting as a tenant user right now.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
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
                  <tbody>
                    {data.activeImpersonations.map((r) => (
                      <tr key={r.id} className="border-t border-line-soft">
                        <td className={td}>{r.admin.fullName ?? r.admin.username ?? r.adminId}</td>
                        <td className={td}>
                          <Link
                            to={`/platform/tenants/${r.company.id}`}
                            className="font-semibold text-accent hover:underline"
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
