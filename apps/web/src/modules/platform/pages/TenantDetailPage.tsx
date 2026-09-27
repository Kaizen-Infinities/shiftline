import React, { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { FEATURE_KEYS } from "@shiftline/shared";
import { Building2, Eye } from "lucide-react";

import { getCurrentUser, setAccessToken } from "../../../features/auth/authSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { AuditEntry } from "../../../services/auditTrailService";
import {
  platformService,
  type DeviceRow,
  type ImpersonationRow,
  type Plan,
  type TenantDetail,
  type TenantUser,
} from "../../../services/platformService";
import { ActionPill, Chip, ChipTabs, PageHeader, SkeletonTile } from "../../../components/ui/v2";
import {
  Badge,
  Section,
  Stat,
  danger,
  input,
  message,
  primary,
  secondary,
  td,
  th,
  when,
} from "../platform.ui";

/**
 * One tenant for the platform operator (P1-02): record and usage, suspend or activate,
 * subscription and overrides, users with "act as", field devices with revoke-and-wipe,
 * impersonation history and the tenant's audit trail.
 */
type Tab = "users" | "devices" | "audit" | "impersonations";

const TenantDetailPage: React.FC = () => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [t, setT] = useState<TenantDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [audit, setAudit] = useState<{ data: AuditEntry[]; total: number } | null>(null);
  const [history, setHistory] = useState<ImpersonationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState({
    planCode: "",
    status: "",
    seats: "",
    apiLimit: "",
    negotiatedMonthlyPrice: "",
  });
  const [override, setOverride] = useState({ feature: "", enabled: "true", reason: "" });

  const load = useCallback(async () => {
    try {
      const [detail, planData] = await Promise.all([
        platformService.tenant(id),
        platformService.plans(),
      ]);
      setT(detail);
      setPlans(Array.isArray(planData) ? planData : planData.plans);
      setSub({
        planCode: detail.subscription?.plan.code ?? "",
        status: detail.subscription?.status ?? "",
        seats: detail.subscription?.seats?.toString() ?? "",
        apiLimit: detail.subscription?.apiLimit?.toString() ?? "",
        negotiatedMonthlyPrice: detail.subscription?.negotiatedMonthlyPrice?.toString() ?? "",
      });
    } catch (err) {
      toast.error(message(err));
    }
  }, [id]);

  const loadTab = useCallback(
    async (which: Tab) => {
      try {
        if (which === "users") setUsers(await platformService.users(id));
        if (which === "devices") setDevices(await platformService.devices(id));
        if (which === "audit") setAudit(await platformService.audit(id, { pageSize: 25 }));
        if (which === "impersonations")
          setHistory(await platformService.impersonations({ companyId: id, limit: 50 }));
      } catch (err) {
        toast.error(message(err));
      }
    },
    [id]
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadTab(tab);
  }, [tab, loadTab]);

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await load();
      if (after) await after();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = () => {
    if (!t) return;
    if (t.company.isActive) {
      const reason = window.prompt("Why is this tenant being suspended? Every user is signed out.");
      if (!reason) return;
      return run("Tenant suspended", () =>
        platformService.updateTenant(id, { isActive: false, suspendReason: reason })
      );
    }
    return run("Tenant activated", () => platformService.updateTenant(id, { isActive: true }));
  };

  const saveSubscription = () =>
    run("Subscription saved", () =>
      platformService.updateSubscription(id, {
        ...(sub.planCode && { planCode: sub.planCode }),
        ...(sub.status && { status: sub.status }),
        seats: sub.seats === "" ? null : Number(sub.seats),
        apiLimit: sub.apiLimit === "" ? null : Number(sub.apiLimit),
        negotiatedMonthlyPrice:
          sub.negotiatedMonthlyPrice === "" ? null : Number(sub.negotiatedMonthlyPrice),
      })
    );

  const saveOverride = () => {
    if (!override.feature) return;
    return run("Override saved", () =>
      platformService.setOverride(id, override.feature, {
        enabled: override.enabled === "true",
        reason: override.reason || null,
      })
    );
  };

  const impersonate = async (userId?: string, who?: string) => {
    const reason = window.prompt(
      `Why are you acting as ${who ?? "the owner"}? The tenant's audit trail keeps this.`
    );
    if (!reason) return;
    setBusy(true);
    try {
      const r = await platformService.impersonate(id, { userId, reason });
      dispatch(
        setAccessToken({
          accessToken: r.accessToken,
          accessTokenExpiresAt: r.accessTokenExpiresAt,
          reason: r.impersonation.reason,
        })
      );
      await dispatch(getCurrentUser());
      toast.info(`Acting as ${r.user.fullName} at ${r.company.companyName} for 30 minutes`);
      navigate("/dashboard");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = (d: DeviceRow) => {
    if (
      !window.confirm(
        `Revoke ${d.model ?? d.deviceId} used by ${d.agentName}? The app signs out and wipes.`
      )
    )
      return;
    return run(
      "Device revoked",
      () => platformService.revokeDevice(id, d.id),
      () => loadTab("devices")
    );
  };

  if (!t)
    return (
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <SkeletonTile lines={2} label="Loading…" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonTile key={i} lines={1} />
          ))}
        </div>
      </div>
    );
  const c = t.company;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title={c.companyName}
        icon={<Building2 size={22} />}
        back="/platform/tenants"
        backLabel="Back to tenants"
        breadcrumbs={[
          { label: "Platform", to: "/platform" },
          { label: "Tenants", to: "/platform/tenants" },
          { label: c.companyName },
        ]}
        meta={
          <>
            {!c.isActive && <Badge value="SUSPENDED" />}
            <Chip tone={c.isOnboarded ? "success" : "warning"} size="sm">
              {c.isOnboarded ? "Onboarded" : "Onboarding pending"}
            </Chip>
          </>
        }
        subtitle={
          <>
            {c.companyCode} · {c.slug} {c.gstin && `· GSTIN ${c.gstin}`} · created{" "}
            {when(c.createdAt)}
          </>
        }
        actions={
          <ActionPill
            variant="secondary"
            className={c.isActive ? "sl-btn-soft-danger" : undefined}
            disabled={busy}
            onClick={toggleActive}
          >
            {c.isActive ? "Suspend tenant" : "Activate tenant"}
          </ActionPill>
        }
        primaryAction={
          <ActionPill
            size="lg"
            icon={<Eye size={18} />}
            disabled={busy || !c.isActive}
            onClick={() => impersonate()}
          >
            Act as owner
          </ActionPill>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat
          label="Users"
          value={t.usage.users}
          hint={`${t.usage.activeUsers} active · ${t.usage.pendingInvitations} invited`}
        />
        <Stat
          label="Seats"
          value={`${t.entitlements.seatsUsed}${t.entitlements.seatLimit ? ` / ${t.entitlements.seatLimit}` : ""}`}
        />
        <Stat label="Devices" value={t.usage.activeDevices} />
        <Stat
          label="Last 30 days"
          value={t.usage.last30Days.salesInvoices}
          hint={`invoices · ${t.usage.last30Days.vouchers} vouchers · ${t.usage.last30Days.grns} GRNs`}
        />
        <Stat
          label="Last login"
          value={<span className="text-base">{when(t.usage.lastLoginAt)}</span>}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Subscription" right={<Badge value={t.subscription?.status ?? null} />}>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-muted">
              Plan
              <select
                className={`${input} block w-full`}
                value={sub.planCode}
                onChange={(e) => setSub({ ...sub, planCode: e.target.value })}
              >
                <option value="">—</option>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-muted">
              Status
              <select
                className={`${input} block w-full`}
                value={sub.status}
                onChange={(e) => setSub({ ...sub, status: e.target.value })}
              >
                <option value="">—</option>
                {["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-muted">
              Seats (blank = plan default)
              <input
                className={`${input} block w-full`}
                value={sub.seats}
                onChange={(e) => setSub({ ...sub, seats: e.target.value })}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-muted">
              API calls / 15 min
              <input
                className={`${input} block w-full`}
                value={sub.apiLimit}
                onChange={(e) => setSub({ ...sub, apiLimit: e.target.value })}
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-muted">
              Negotiated monthly price ₹ (blank = plan price)
              <input
                className={`${input} block w-full`}
                value={sub.negotiatedMonthlyPrice}
                onChange={(e) => setSub({ ...sub, negotiatedMonthlyPrice: e.target.value })}
                inputMode="decimal"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-line-soft pt-4">
            <div className="flex flex-wrap gap-1.5" aria-label="Features">
              {t.entitlements.features.map((f) => (
                <Chip key={f} size="sm">
                  {f}
                </Chip>
              ))}
            </div>
            <button type="button" className={primary} disabled={busy} onClick={saveSubscription}>
              Save
            </button>
          </div>
        </Section>

        <Section title="Feature overrides">
          <ul className="m-0 mb-4 list-none space-y-2 p-0 text-sm">
            {t.overrides.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-2 rounded-[12px] bg-card-2 px-3 py-2"
              >
                <span>
                  <b>{o.feature}</b>{" "}
                  <Chip tone={o.enabled ? "success" : "muted"} size="sm">
                    {o.enabled ? "On" : "Off"}
                  </Chip>
                  {o.reason && <span className="text-ink-subtle"> · {o.reason}</span>}
                  {o.expiresAt && (
                    <span className="text-ink-subtle"> · until {when(o.expiresAt)}</span>
                  )}
                </span>
                <button
                  type="button"
                  className={secondary}
                  disabled={busy}
                  onClick={() =>
                    run("Override removed", () => platformService.removeOverride(id, o.feature))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
            {t.overrides.length === 0 && (
              <li className="text-ink-muted">None. The plan decides.</li>
            )}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <select
              className={input}
              value={override.feature}
              onChange={(e) => setOverride({ ...override, feature: e.target.value })}
            >
              <option value="">Feature…</option>
              {FEATURE_KEYS.filter((f) => f !== "core").map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select
              className={input}
              value={override.enabled}
              onChange={(e) => setOverride({ ...override, enabled: e.target.value })}
            >
              <option value="true">Enable</option>
              <option value="false">Disable</option>
            </select>
            <input
              className={`${input} flex-1`}
              placeholder="Reason"
              value={override.reason}
              onChange={(e) => setOverride({ ...override, reason: e.target.value })}
            />
            <button
              type="button"
              className={secondary}
              disabled={busy || !override.feature}
              onClick={saveOverride}
            >
              Add
            </button>
          </div>
        </Section>
      </div>

      <ChipTabs<Tab>
        ariaLabel="Tenant records"
        value={tab}
        onChange={setTab}
        size="lg"
        items={[
          { key: "users", label: "Users" },
          { key: "devices", label: "Devices" },
          { key: "audit", label: "Audit" },
          { key: "impersonations", label: "Impersonations" },
        ]}
      />

      {tab === "users" && (
        <div className="sl-tile overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>User</th>
                <th className={th}>Role</th>
                <th className={th}>Status</th>
                <th className={th}>Last login</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-t border-line-soft">
                  <td className={td}>
                    {u.fullName}{" "}
                    <span className="text-xs text-ink-muted">
                      {u.username} · {u.email}
                    </span>
                  </td>
                  <td className={td}>{u.role?.name ?? "—"}</td>
                  <td className={td}>
                    <Badge value={u.status} />
                  </td>
                  <td className={td}>{when(u.lastLoginAt)}</td>
                  <td className={td}>
                    <button
                      type="button"
                      className={secondary}
                      disabled={busy || u.status !== "active" || !c.isActive}
                      onClick={() => impersonate(u.userId, u.fullName)}
                    >
                      Act as
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "devices" && (
        <div className="sl-tile overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Device</th>
                <th className={th}>Agent</th>
                <th className={th}>App</th>
                <th className={th}>Last seen</th>
                <th className={th}>State</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-t border-line-soft">
                  <td className={td}>
                    {d.model ?? "Unknown"}{" "}
                    <span className="text-xs text-ink-muted">
                      {d.platform} · {d.deviceId}
                    </span>
                  </td>
                  <td className={td}>{d.agentName}</td>
                  <td className={td}>{d.appVersion ?? "—"}</td>
                  <td className={td}>{when(d.lastSeenAt)}</td>
                  <td className={td}>
                    {d.revokedAt ? <Badge value="SUSPENDED" /> : <Badge value="active" />}
                  </td>
                  <td className={td}>
                    {!d.revokedAt && (
                      <button
                        type="button"
                        className={danger}
                        disabled={busy}
                        onClick={() => revoke(d)}
                      >
                        Revoke and wipe
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-muted`} colSpan={6}>
                    No field devices.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "audit" && (
        <div className="sl-tile overflow-x-auto">
          <div className="px-4 py-3 text-xs text-ink-muted">
            {audit?.total ?? 0} entries, newest first. Impersonated changes show the admin.
          </div>
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>When</th>
                <th className={th}>Entity</th>
                <th className={th}>Action</th>
                <th className={th}>By</th>
                <th className={th}>Changes</th>
              </tr>
            </thead>
            <tbody>
              {(audit?.data ?? []).map((e) => (
                <tr key={e.id} className="border-t border-line-soft">
                  <td className={td}>{when(e.changedAt)}</td>
                  <td className={td}>
                    {e.entityLabel} <span className="text-xs text-ink-muted">{e.entityId}</span>
                  </td>
                  <td className={td}>{e.action}</td>
                  <td className={td}>
                    {e.actor.name}
                    {e.impersonatedBy && (
                      <Chip tone="warning" size="sm" className="ml-1">
                        via {e.impersonatedBy}
                      </Chip>
                    )}
                  </td>
                  <td className={`${td} text-xs text-ink-muted`}>
                    {e.changes
                      .slice(0, 4)
                      .map((ch) => ch.field)
                      .join(", ")}
                    {e.changes.length > 4 && ` +${e.changes.length - 4}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "impersonations" && (
        <div className="sl-tile overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Admin</th>
                <th className={th}>As user</th>
                <th className={th}>Reason</th>
                <th className={th}>Started</th>
                <th className={th}>Ended</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className={td}>{r.admin.fullName ?? r.admin.username ?? r.adminId}</td>
                  <td className={td}>{r.user.fullName ?? r.user.username}</td>
                  <td className={`${td} text-ink-muted`}>{r.reason}</td>
                  <td className={td}>{when(r.startedAt)}</td>
                  <td className={td}>
                    {r.active ? (
                      <Badge value="active" />
                    ) : (
                      `${when(r.endedAt ?? r.expiresAt)}${r.endedReason ? ` · ${r.endedReason}` : ""}`
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-muted`} colSpan={5}>
                    Nobody has acted as a user of this tenant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TenantDetailPage;
