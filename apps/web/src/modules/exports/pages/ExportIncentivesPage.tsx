import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Plane, Plus, X } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  exportIncentivesService as svc,
  type Authorisation,
  type IncentiveClaim,
  type IncentiveScheme,
  type IncentiveSummary,
} from "../../../services/exportIncentivesService";
import DataTable, { type DataTableColumn } from "../../../components/ui/table/DataTable";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  Field,
  PageHeader,
  StatTile,
  Tile,
  Toolbar,
  fieldControlClass,
  type ChipTone,
} from "../../../components/ui/v2";
import { PAGE_CLASS, errorMessage, formatDateIN, formatINR } from "../../sales/shared/tradeUi";

/** Export incentives (TN-01): drawback / RoDTEP / RoSCTL claims and EPCG / AA obligations. */
const inr = (v: unknown) => formatINR(Number(v ?? 0), { decimals: 0 });

const STATUS_TONE: Record<string, ChipTone> = {
  DECLARED: "muted",
  SCROLLED: "info",
  SCRIP_GENERATED: "info",
  UTILISED: "default",
  TRANSFERRED: "warning",
  CREDITED: "success",
  REJECTED: "danger",
};

const StatusChip: React.FC<{ status: string }> = ({ status }) => (
  <Chip size="sm" dot tone={STATUS_TONE[status] ?? "muted"}>
    {status.replace(/_/g, " ")}
  </Chip>
);

type Tab = "claims" | "authorisations";

const ExportIncentivesPage: React.FC = () => {
  const { can } = usePermission();
  const canCreate = can("export-incentives.create");
  const [tab, setTab] = useState<Tab>("claims");
  const [scheme, setScheme] = useState<IncentiveScheme | "">("");
  const [claims, setClaims] = useState<IncentiveClaim[]>([]);
  const [summary, setSummary] = useState<IncentiveSummary | null>(null);
  const [auths, setAuths] = useState<Authorisation[]>([]);
  const [detail, setDetail] = useState<Authorisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [claimForm, setClaimForm] = useState({
    scheme: "RODTEP",
    shippingBillNo: "",
    shippingBillDate: "",
    fobValueInr: "",
    ratePercent: "",
  });
  const [authForm, setAuthForm] = useState({
    authType: "EPCG",
    authNo: "",
    issueDate: "",
    dutySaved: "",
    exportObligationAmount: "",
  });

  const load = useCallback(async () => {
    try {
      const [c, s, a] = await Promise.all([
        svc.listClaims(scheme ? { scheme } : {}),
        svc.summary(),
        svc.listAuthorisations(),
      ]);
      setClaims(c);
      setSummary(s);
      setAuths(a);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [scheme]);

  useEffect(() => {
    void load();
  }, [load]);

  const addClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await svc.createClaim({
        ...claimForm,
        fobValueInr: Number(claimForm.fobValueInr),
        ratePercent: claimForm.ratePercent === "" ? undefined : Number(claimForm.ratePercent),
      });
      toast.success("Claim recorded");
      setClaimForm({ ...claimForm, shippingBillNo: "", fobValueInr: "", ratePercent: "" });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const addAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await svc.createAuthorisation({
        ...authForm,
        dutySaved: Number(authForm.dutySaved),
        exportObligationAmount:
          authForm.exportObligationAmount === ""
            ? undefined
            : Number(authForm.exportObligationAmount),
      });
      toast.success("Authorisation recorded");
      setAuthForm({ ...authForm, authNo: "", dutySaved: "", exportObligationAmount: "" });
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await svc.getAuthorisation(id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const ctaLabel = tab === "claims" ? "Add Claim" : "Add Authorisation";
  const cta = canCreate ? (
    <ActionPill
      icon={showForm ? <X size={18} /> : <Plus size={18} />}
      variant={showForm ? "secondary" : "cta"}
      onClick={() => setShowForm((v) => !v)}
    >
      {showForm ? "Close" : ctaLabel}
    </ActionPill>
  ) : null;

  const claimColumns: DataTableColumn<IncentiveClaim>[] = [
    {
      header: "Scheme",
      render: (c) => <Chip size="sm">{c.scheme}</Chip>,
    },
    {
      header: "Shipping bill",
      render: (c) => <span className="font-semibold text-ink">{c.shippingBillNo}</span>,
    },
    {
      header: "Date",
      render: (c) => <span className="tabular-nums">{formatDateIN(c.shippingBillDate)}</span>,
    },
    {
      header: "FOB",
      align: "right",
      render: (c) => <span className="tabular-nums">{inr(c.fobValueInr)}</span>,
    },
    {
      header: "Expected",
      align: "right",
      render: (c) => <span className="font-semibold tabular-nums">{inr(c.expectedAmount)}</span>,
    },
    {
      header: "Scrip expires",
      render: (c) => <span className="tabular-nums">{formatDateIN(c.scripExpiresOn)}</span>,
    },
    { header: "Status", render: (c) => <StatusChip status={c.status} /> },
  ];

  type Entry = NonNullable<Authorisation["entries"]>[number];
  const entryColumns: DataTableColumn<Entry>[] = [
    {
      header: "Shipping bill",
      render: (e) => <span className="font-medium">{e.shippingBillNo}</span>,
    },
    {
      header: "Date",
      render: (e) => <span className="tabular-nums">{formatDateIN(e.shippingBillDate)}</span>,
    },
    {
      header: "FOB",
      align: "right",
      render: (e) => <span className="tabular-nums">{inr(e.fobValueInr)}</span>,
    },
    {
      header: "Realised on",
      render: (e) => <span className="tabular-nums">{formatDateIN(e.realisedOn)}</span>,
    },
    { header: "BRC", render: (e) => e.brcNo ?? "—" },
  ];

  return (
    <div className={PAGE_CLASS}>
      <PageHeader
        title="Export incentives"
        subtitle="Drawback, RoDTEP and RoSCTL claims per shipping bill, and EPCG / Advance Authorisation export obligations."
        icon={<Plane size={22} />}
        primaryAction={cta}
      >
        <ChipTabs<Tab>
          ariaLabel="Export incentive views"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setShowForm(false);
          }}
          items={[
            { key: "claims", label: "Claims", count: claims.length },
            { key: "authorisations", label: "Authorisations", count: auths.length },
          ]}
        />
      </PageHeader>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Pending receivable"
          value={summary ? inr(summary.pendingReceivable) : "—"}
          loading={loading && !summary}
        />
        <StatTile
          label="Scrips expiring in 60 days"
          value={summary ? String(summary.expiringScrips.length) : "—"}
          loading={loading && !summary}
        />
        <StatTile
          label="Credited this financial year"
          value={summary ? inr(summary.creditedThisFy) : "—"}
          loading={loading && !summary}
        />
      </div>

      {tab === "claims" && (
        <div className="flex flex-col gap-4">
          {canCreate && showForm && (
            <Tile title="New claim" subtitle="One claim per shipping bill and scheme.">
              <form
                onSubmit={addClaim}
                className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5"
              >
                <Field label="Scheme">
                  <select
                    className={fieldControlClass()}
                    value={claimForm.scheme}
                    onChange={(e) => setClaimForm({ ...claimForm, scheme: e.target.value })}
                    aria-label="Claim scheme"
                  >
                    <option value="RODTEP">RoDTEP</option>
                    <option value="ROSCTL">RoSCTL</option>
                    <option value="DRAWBACK">Drawback</option>
                  </select>
                </Field>
                <Field label="Shipping bill no.">
                  <input
                    className={fieldControlClass()}
                    value={claimForm.shippingBillNo}
                    onChange={(e) => setClaimForm({ ...claimForm, shippingBillNo: e.target.value })}
                  />
                </Field>
                <Field label="Shipping bill date">
                  <input
                    className={fieldControlClass()}
                    type="date"
                    value={claimForm.shippingBillDate}
                    onChange={(e) =>
                      setClaimForm({ ...claimForm, shippingBillDate: e.target.value })
                    }
                  />
                </Field>
                <Field label="FOB value (₹)">
                  <input
                    className={fieldControlClass(false, "text-right tabular-nums")}
                    inputMode="decimal"
                    value={claimForm.fobValueInr}
                    onChange={(e) => setClaimForm({ ...claimForm, fobValueInr: e.target.value })}
                  />
                </Field>
                <Field label="Rate %">
                  <input
                    className={fieldControlClass(false, "text-right tabular-nums")}
                    inputMode="decimal"
                    value={claimForm.ratePercent}
                    onChange={(e) => setClaimForm({ ...claimForm, ratePercent: e.target.value })}
                  />
                </Field>
                <div className="flex justify-end gap-2 md:col-span-2 lg:col-span-5">
                  <ActionPill variant="secondary" onClick={() => setShowForm(false)}>
                    Cancel
                  </ActionPill>
                  <ActionPill type="submit">Add claim</ActionPill>
                </div>
              </form>
            </Tile>
          )}

          <Toolbar
            className="!mb-0"
            filters={[
              { key: "", label: "All schemes" },
              { key: "RODTEP", label: "RoDTEP" },
              { key: "ROSCTL", label: "RoSCTL" },
              { key: "DRAWBACK", label: "Drawback" },
            ]}
            filterValue={scheme}
            onFilterChange={(k) => setScheme(k as IncentiveScheme | "")}
            filtersLabel="Scheme"
          />

          <DataTable
            columns={claimColumns}
            data={claims}
            rowKey={(c) => c.id}
            loading={loading}
            ariaLabel="Incentive claims"
            emptyMessage={scheme ? "No claims under this scheme." : "No claims yet."}
            emptyAction={scheme || showForm ? undefined : cta}
          />
        </div>
      )}

      {tab === "authorisations" && (
        <div className="flex flex-col gap-4">
          {canCreate && showForm && (
            <Tile title="New authorisation" subtitle="EPCG or Advance Authorisation from DGFT.">
              <form
                onSubmit={addAuth}
                className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5"
              >
                <Field label="Type">
                  <select
                    className={fieldControlClass()}
                    value={authForm.authType}
                    onChange={(e) => setAuthForm({ ...authForm, authType: e.target.value })}
                    aria-label="Authorisation type"
                  >
                    <option value="EPCG">EPCG</option>
                    <option value="ADVANCE_AUTHORISATION">Advance Authorisation</option>
                  </select>
                </Field>
                <Field label="Authorisation no.">
                  <input
                    className={fieldControlClass()}
                    value={authForm.authNo}
                    onChange={(e) => setAuthForm({ ...authForm, authNo: e.target.value })}
                  />
                </Field>
                <Field label="Issue date">
                  <input
                    className={fieldControlClass()}
                    type="date"
                    value={authForm.issueDate}
                    onChange={(e) => setAuthForm({ ...authForm, issueDate: e.target.value })}
                  />
                </Field>
                <Field label="Duty saved (₹)">
                  <input
                    className={fieldControlClass(false, "text-right tabular-nums")}
                    inputMode="decimal"
                    value={authForm.dutySaved}
                    onChange={(e) => setAuthForm({ ...authForm, dutySaved: e.target.value })}
                  />
                </Field>
                <Field label="Obligation (AA)">
                  <input
                    className={fieldControlClass(false, "text-right tabular-nums")}
                    inputMode="decimal"
                    value={authForm.exportObligationAmount}
                    onChange={(e) =>
                      setAuthForm({ ...authForm, exportObligationAmount: e.target.value })
                    }
                  />
                </Field>
                <div className="flex justify-end gap-2 md:col-span-2 lg:col-span-5">
                  <ActionPill variant="secondary" onClick={() => setShowForm(false)}>
                    Cancel
                  </ActionPill>
                  <ActionPill type="submit">Add authorisation</ActionPill>
                </div>
              </form>
            </Tile>
          )}

          {auths.length === 0 ? (
            <Tile>
              <EmptyState
                title="No authorisations yet."
                description="Record an EPCG or Advance Authorisation to track its export obligation."
                action={showForm ? undefined : cta}
              />
            </Tile>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {auths.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="sl-tile sl-tile-hover block w-full p-4 text-left sm:p-5"
                  onClick={() => void openDetail(a.id)}
                  aria-pressed={detail?.id === a.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Chip size="sm">{a.authType === "EPCG" ? "EPCG" : "AA"}</Chip>
                      <span className="font-semibold text-ink">{a.authNo}</span>
                    </span>
                    <Chip size="sm" tone="muted">
                      {a.status}
                    </Chip>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <div className="text-[13px] text-ink-subtle">Obligation</div>
                      <div className="text-lg font-semibold tabular-nums text-ink">
                        {inr(a.exportObligationAmount)}
                      </div>
                    </div>
                    <div className="text-right text-[13px] text-ink-subtle">
                      Due {formatDateIN(a.eoDueDate)}
                      <br />
                      <span className="tabular-nums">{a.progress.daysToDue} days</span>
                    </div>
                  </div>
                  <div
                    className="mt-3 h-2 w-full overflow-hidden rounded-full bg-card-2"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, a.progress.eoPercent)}
                    aria-label="Export obligation realised"
                  >
                    <div
                      className="h-full rounded-full bg-[color:var(--color-success)]"
                      style={{ width: `${Math.min(100, a.progress.eoPercent)}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-xs text-ink-muted">
                    {a.progress.eoPercent}% realised
                    {a.progress.block1Percent !== null &&
                      ` · block 1 (50% by ${formatDateIN(a.block1DueDate)}): ${a.progress.block1Percent}%`}
                  </div>
                </button>
              ))}
            </div>
          )}

          {detail && (
            <Tile
              padding="none"
              title={`Shipping bills against ${detail.authNo}`}
              actions={
                <button
                  type="button"
                  className="sl-icon-btn sl-icon-btn-md"
                  aria-label="Close"
                  onClick={() => setDetail(null)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              }
            >
              <DataTable
                columns={entryColumns}
                data={detail.entries ?? []}
                rowKey={(e) => e.id}
                density="compact"
                ariaLabel={`Shipping bills against ${detail.authNo}`}
                className="!rounded-none !border-0 !shadow-none"
                emptyMessage="No shipping bills booked against this authorisation yet."
              />
            </Tile>
          )}
        </div>
      )}
    </div>
  );
};

export default ExportIncentivesPage;
