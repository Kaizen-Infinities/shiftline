import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import { Building2, Plus, X } from "lucide-react";

import {
  platformService,
  type Plan,
  type ProvisionInput,
  type TenantRow,
} from "../../../services/platformService";
import { ActionPill, Chip, EmptyState, PageHeader, Tile, Toolbar } from "../../../components/ui/v2";
import { Badge, Section, input, message, when } from "../platform.ui";

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

  const fieldLabel = "block";

  return (
    <div className="sl-page">
      <PageHeader
        title="Tenants"
        icon={<Building2 size={22} />}
        subtitle="Every company on the platform, with its plan and onboarding state."
        breadcrumbs={[{ label: "Platform", to: "/platform" }, { label: "Tenants" }]}
        primaryAction={
          <ActionPill
            size="lg"
            icon={showForm ? <X size={18} /> : <Plus size={18} />}
            variant={showForm ? "secondary" : "cta"}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? "Close" : "New tenant"}
          </ActionPill>
        }
      />

      {acceptUrl && (
        <div
          role="status"
          className="rounded-[16px] bg-[color:color-mix(in_srgb,var(--color-warning)_12%,var(--color-card))] px-4 py-3 text-sm text-ink"
        >
          Owner invitation link (email not configured):{" "}
          <code className="break-all">{acceptUrl}</code>
        </div>
      )}

      {showForm && (
        <Section title="Provision a tenant" icon={<Plus size={18} />}>
          <form
            className="grid gap-4 md:grid-cols-3"
            onSubmit={submit}
            data-testid="provision-form"
          >
            <label className={fieldLabel}>
              <span className="sl-label">Company code</span>
              <input
                className={input}
                value={form.companyCode}
                onChange={(e) => set("companyCode", e.target.value)}
                required
                pattern="[A-Za-z0-9-]{2,20}"
              />
            </label>
            <label className={`${fieldLabel} md:col-span-2`}>
              <span className="sl-label">Company name</span>
              <input
                className={input}
                value={form.companyName}
                onChange={(e) => set("companyName", e.target.value)}
                required
                minLength={2}
              />
            </label>
            <label className={fieldLabel}>
              <span className="sl-label">Slug (login branding)</span>
              <input
                className={input}
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                required
                pattern="[a-z0-9-]{2,40}"
              />
            </label>
            <label className={fieldLabel}>
              <span className="sl-label">GSTIN</span>
              <input
                className={`${input} uppercase`}
                value={form.gstin ?? ""}
                maxLength={15}
                onChange={(e) => set("gstin", e.target.value)}
                placeholder="optional"
              />
            </label>
            <label className={fieldLabel}>
              <span className="sl-label">Plan</span>
              <select
                className={input}
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
            <label className={fieldLabel}>
              <span className="sl-label">Owner name</span>
              <input
                className={input}
                value={form.owner.fullName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, owner: { ...f.owner, fullName: e.target.value } }))
                }
                required
                minLength={2}
              />
            </label>
            <label className={fieldLabel}>
              <span className="sl-label">Owner email</span>
              <input
                type="email"
                className={input}
                value={form.owner.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, owner: { ...f.owner, email: e.target.value } }))
                }
                required
              />
            </label>
            <label className={fieldLabel}>
              <span className="sl-label">Starts as</span>
              <select
                className={input}
                value={form.subscriptionStatus}
                onChange={(e) => set("subscriptionStatus", e.target.value)}
              >
                <option value="TRIALING">Trial</option>
                <option value="ACTIVE">Active</option>
              </select>
            </label>
            <div className="flex justify-end gap-2 border-t border-line-soft pt-4 md:col-span-3">
              <button
                type="button"
                className="sl-btn sl-pill-md"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
              <button type="submit" className="sl-cta sl-pill-md" disabled={busy}>
                {busy ? "Provisioning…" : "Create and invite owner"}
              </button>
            </div>
          </form>
        </Section>
      )}

      <Toolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name, code or slug"
        right={
          <span className="sl-muted text-sm">
            {visible.length} of {rows.length} tenant{rows.length === 1 ? "" : "s"}
          </span>
        }
      />

      <Tile padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full" aria-label="Tenants list">
            <thead>
              <tr className="bg-card-2">
                <th className={thCell}>Company</th>
                <th className={thCell}>Plan</th>
                <th className={thCell}>Status</th>
                <th className={thCell}>Onboarding</th>
                <th className={`${thCell} text-right`}>Users</th>
                <th className={thCell}>Created</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="sl-row-hover border-t border-line-soft">
                  <td className={cell}>
                    <Link
                      to={`/platform/tenants/${r.id}`}
                      className="font-semibold text-accent hover:underline"
                    >
                      {r.companyName}
                    </Link>
                    <div className="text-xs text-ink-muted">
                      {r.companyCode} · {r.slug} {r.gstin && `· ${r.gstin}`}
                    </div>
                  </td>
                  <td className={cell}>
                    {r.plan?.name ? (
                      <Chip size="sm">{r.plan.name}</Chip>
                    ) : (
                      <span className="text-ink-subtle">none</span>
                    )}
                  </td>
                  <td className={cell}>
                    {r.isActive ? (
                      <Badge value={r.subscriptionStatus} />
                    ) : (
                      <Badge value="SUSPENDED" />
                    )}
                  </td>
                  <td className={cell}>
                    {r.isOnboarded ? (
                      <Chip tone="success" size="sm">
                        Done
                      </Chip>
                    ) : (
                      <Chip tone="warning" size="sm">
                        {r.onboardingStep ?? "Not started"}
                      </Chip>
                    )}
                  </td>
                  <td className={`${cell} text-right tabular-nums`}>
                    {r.users}
                    {r.pendingInvitations > 0 && (
                      <span className="ml-1 text-xs text-ink-muted">
                        +{r.pendingInvitations} invited
                      </span>
                    )}
                  </td>
                  <td className={`${cell} text-xs text-ink-muted`}>{when(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <EmptyState
            compact
            title="No tenants match."
            action={
              search ? (
                <ActionPill variant="secondary" size="sm" onClick={() => setSearch("")}>
                  Clear search
                </ActionPill>
              ) : undefined
            }
          />
        )}
      </Tile>
    </div>
  );
};

const thCell = "sl-th px-4 py-3 text-left";
const cell = "px-4 py-3 text-sm text-ink align-middle";

export default TenantsPage;
