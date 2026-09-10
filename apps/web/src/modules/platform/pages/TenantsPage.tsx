import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import {
  platformService,
  type Plan,
  type ProvisionInput,
  type TenantRow,
} from "../../../services/platformService";
import { Badge, Section, input, message, primary, secondary, td, th, when } from "../platform.ui";

/** Tenant list with the provisioning form (P1-02). Provisioning invites the owner by email. */
const blank: ProvisionInput = {
  companyCode: "",
  companyName: "",
  slug: "",
  gstin: "",
  planCode: "",
  subscriptionStatus: "TRIALING",
  owner: { email: "", fullName: "" },
};

const TenantsPage: React.FC = () => {
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProvisionInput>(blank);
  const [busy, setBusy] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tenants, planData] = await Promise.all([
        platformService.tenants(),
        platformService.plans(),
      ]);
      setRows(tenants);
      setPlans(Array.isArray(planData) ? planData : planData.plans);
    } catch (err) {
      toast.error(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (k: keyof ProvisionInput, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: ProvisionInput = {
        ...form,
        companyCode: form.companyCode.trim().toUpperCase(),
        slug: form.slug.trim().toLowerCase(),
        gstin: form.gstin?.trim().toUpperCase() || undefined,
        planCode: form.planCode || undefined,
        legalName: form.legalName || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
      };
      const result = await platformService.provision(body);
      toast.success(
        result.ownerInvitation.emailed
          ? `Tenant created; invitation emailed to ${result.ownerInvitation.email}`
          : "Tenant created; email is not configured, copy the invitation link"
      );
      setAcceptUrl(result.ownerInvitation.acceptUrl ?? null);
      setForm(blank);
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter(
    (r) =>
      !q ||
      r.companyName.toLowerCase().includes(q) ||
      (r.companyCode ?? "").toLowerCase().includes(q) ||
      (r.slug ?? "").toLowerCase().includes(q)
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Tenants</h2>
          <p className="text-sm text-ink-muted">
            Every company on the platform, with its plan and onboarding state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className={input}
            placeholder="Search name, code or slug"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className={primary} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "New tenant"}
          </button>
        </div>
      </div>

      {acceptUrl && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          Owner invitation link (email not configured):{" "}
          <code className="break-all">{acceptUrl}</code>
        </div>
      )}

      {showForm && (
        <Section title="Provision a tenant">
          <form
            className="grid gap-3 md:grid-cols-3"
            onSubmit={submit}
            data-testid="provision-form"
          >
            <label className="text-xs font-medium text-ink-muted">
              Company code
              <input
                className={`${input} block w-full`}
                value={form.companyCode}
                onChange={(e) => set("companyCode", e.target.value)}
                required
                pattern="[A-Za-z0-9-]{2,20}"
              />
            </label>
            <label className="text-xs font-medium text-ink-muted md:col-span-2">
              Company name
              <input
                className={`${input} block w-full`}
                value={form.companyName}
                onChange={(e) => set("companyName", e.target.value)}
                required
                minLength={2}
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Slug (login branding)
              <input
                className={`${input} block w-full`}
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                required
                pattern="[a-z0-9-]{2,40}"
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              GSTIN
              <input
                className={`${input} block w-full`}
                value={form.gstin ?? ""}
                onChange={(e) => set("gstin", e.target.value)}
                placeholder="optional"
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Plan
              <select
                className={`${input} block w-full`}
                value={form.planCode ?? ""}
                onChange={(e) => set("planCode", e.target.value)}
              >
                <option value="">Default</option>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Owner name
              <input
                className={`${input} block w-full`}
                value={form.owner.fullName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, owner: { ...f.owner, fullName: e.target.value } }))
                }
                required
                minLength={2}
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Owner email
              <input
                type="email"
                className={`${input} block w-full`}
                value={form.owner.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, owner: { ...f.owner, email: e.target.value } }))
                }
                required
              />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Starts as
              <select
                className={`${input} block w-full`}
                value={form.subscriptionStatus}
                onChange={(e) => set("subscriptionStatus", e.target.value)}
              >
                <option value="TRIALING">Trial</option>
                <option value="ACTIVE">Active</option>
              </select>
            </label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button type="button" className={secondary} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className={primary} disabled={busy}>
                {busy ? "Provisioning…" : "Create and invite owner"}
              </button>
            </div>
          </form>
        </Section>
      )}

      <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Company</th>
              <th className={th}>Plan</th>
              <th className={th}>Status</th>
              <th className={th}>Onboarding</th>
              <th className={`${th} text-right`}>Users</th>
              <th className={th}>Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-card-2/60">
                <td className={td}>
                  <Link
                    to={`/platform/tenants/${r.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {r.companyName}
                  </Link>
                  <div className="text-xs text-ink-subtle">
                    {r.companyCode} · {r.slug} {r.gstin && `· ${r.gstin}`}
                  </div>
                </td>
                <td className={td}>
                  {r.plan?.name ?? <span className="text-ink-subtle">none</span>}
                </td>
                <td className={td}>
                  {r.isActive ? (
                    <Badge value={r.subscriptionStatus} />
                  ) : (
                    <Badge value="SUSPENDED" />
                  )}
                </td>
                <td className={td}>
                  {r.isOnboarded ? (
                    <span className="text-emerald-700">Done</span>
                  ) : (
                    <span className="text-amber-700">{r.onboardingStep ?? "Not started"}</span>
                  )}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {r.users}
                  {r.pendingInvitations > 0 && (
                    <span className="ml-1 text-xs text-ink-subtle">
                      +{r.pendingInvitations} invited
                    </span>
                  )}
                </td>
                <td className={td}>{when(r.createdAt)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={6}>
                  No tenants match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TenantsPage;
