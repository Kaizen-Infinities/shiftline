import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  exportIncentivesService as svc,
  type Authorisation,
  type IncentiveClaim,
  type IncentiveScheme,
  type IncentiveSummary,
} from "../../../services/exportIncentivesService";
import {
  Card,
  field,
  message,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/** Export incentives (TN-01): drawback / RoDTEP / RoSCTL claims and EPCG / AA obligations. */
const inr = (v: unknown) =>
  Number(v ?? 0).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "INR",
  });
const d10 = (v: string | null | undefined) => (v ? v.slice(0, 10) : "—");

const STATUS_TONE: Record<string, string> = {
  DECLARED: "bg-slate-100 text-slate-700",
  SCROLLED: "bg-sky-100 text-sky-800",
  SCRIP_GENERATED: "bg-indigo-100 text-indigo-800",
  UTILISED: "bg-violet-100 text-violet-800",
  TRANSFERRED: "bg-amber-100 text-amber-800",
  CREDITED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
};

const Chip: React.FC<{ status: string }> = ({ status }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status] ?? ""}`}>
    {status.replace(/_/g, " ")}
  </span>
);

const Tile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-line-soft bg-card p-4">
    <div className="text-xs text-ink-muted">{label}</div>
    <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
  </div>
);

const ExportIncentivesPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<"claims" | "authorisations">("claims");
  const [scheme, setScheme] = useState<IncentiveScheme | "">("");
  const [claims, setClaims] = useState<IncentiveClaim[]>([]);
  const [summary, setSummary] = useState<IncentiveSummary | null>(null);
  const [auths, setAuths] = useState<Authorisation[]>([]);
  const [detail, setDetail] = useState<Authorisation | null>(null);
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
      toast.error(message(err));
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
      toast.error(message(err));
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
      toast.error(message(err));
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await svc.getAuthorisation(id));
    } catch (err) {
      toast.error(message(err));
    }
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Export incentives</h1>
          <p className="text-sm text-ink-muted">
            Drawback, RoDTEP and RoSCTL claims per shipping bill, and EPCG / Advance Authorisation
            export obligations.
          </p>
        </div>
        <nav className="flex gap-2">
          <button
            className={tab === "claims" ? primary : secondary}
            onClick={() => setTab("claims")}
          >
            Claims
          </button>
          <button
            className={tab === "authorisations" ? primary : secondary}
            onClick={() => setTab("authorisations")}
          >
            Authorisations
          </button>
        </nav>
      </header>

      {summary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label="Pending receivable" value={inr(summary.pendingReceivable)} />
          <Tile label="Scrips expiring in 60 days" value={String(summary.expiringScrips.length)} />
          <Tile label="Credited this financial year" value={inr(summary.creditedThisFy)} />
        </div>
      )}

      {tab === "claims" && (
        <Card
          title="Claims"
          actions={
            <select
              className={field}
              value={scheme}
              onChange={(e) => setScheme(e.target.value as IncentiveScheme | "")}
              aria-label="Scheme"
            >
              <option value="">All schemes</option>
              <option value="RODTEP">RoDTEP</option>
              <option value="ROSCTL">RoSCTL</option>
              <option value="DRAWBACK">Drawback</option>
            </select>
          }
        >
          {can("export-incentives.create") && (
            <form
              onSubmit={addClaim}
              className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line-soft p-3 sm:grid-cols-6"
            >
              <select
                className={field}
                value={claimForm.scheme}
                onChange={(e) => setClaimForm({ ...claimForm, scheme: e.target.value })}
                aria-label="Claim scheme"
              >
                <option value="RODTEP">RoDTEP</option>
                <option value="ROSCTL">RoSCTL</option>
                <option value="DRAWBACK">Drawback</option>
              </select>
              <input
                className={field}
                placeholder="Shipping bill no."
                value={claimForm.shippingBillNo}
                onChange={(e) => setClaimForm({ ...claimForm, shippingBillNo: e.target.value })}
              />
              <input
                className={field}
                type="date"
                aria-label="Shipping bill date"
                value={claimForm.shippingBillDate}
                onChange={(e) => setClaimForm({ ...claimForm, shippingBillDate: e.target.value })}
              />
              <input
                className={field}
                placeholder="FOB value (INR)"
                inputMode="decimal"
                value={claimForm.fobValueInr}
                onChange={(e) => setClaimForm({ ...claimForm, fobValueInr: e.target.value })}
              />
              <input
                className={field}
                placeholder="Rate %"
                inputMode="decimal"
                value={claimForm.ratePercent}
                onChange={(e) => setClaimForm({ ...claimForm, ratePercent: e.target.value })}
              />
              <button className={primary} type="submit">
                Add claim
              </button>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className={th}>Scheme</th>
                  <th className={th}>Shipping bill</th>
                  <th className={th}>Date</th>
                  <th className={th}>FOB</th>
                  <th className={th}>Expected</th>
                  <th className={th}>Scrip expires</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft">
                    <td className={td}>{c.scheme}</td>
                    <td className={td}>{c.shippingBillNo}</td>
                    <td className={td}>{d10(c.shippingBillDate)}</td>
                    <td className={td}>{inr(c.fobValueInr)}</td>
                    <td className={td}>{inr(c.expectedAmount)}</td>
                    <td className={td}>{d10(c.scripExpiresOn)}</td>
                    <td className={td}>
                      <Chip status={c.status} />
                    </td>
                  </tr>
                ))}
                {claims.length === 0 && (
                  <tr>
                    <td className={td} colSpan={7}>
                      No claims yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "authorisations" && (
        <Card title="EPCG and Advance Authorisations">
          {can("export-incentives.create") && (
            <form
              onSubmit={addAuth}
              className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-line-soft p-3 sm:grid-cols-6"
            >
              <select
                className={field}
                value={authForm.authType}
                onChange={(e) => setAuthForm({ ...authForm, authType: e.target.value })}
                aria-label="Authorisation type"
              >
                <option value="EPCG">EPCG</option>
                <option value="ADVANCE_AUTHORISATION">Advance Authorisation</option>
              </select>
              <input
                className={field}
                placeholder="Authorisation no."
                value={authForm.authNo}
                onChange={(e) => setAuthForm({ ...authForm, authNo: e.target.value })}
              />
              <input
                className={field}
                type="date"
                aria-label="Issue date"
                value={authForm.issueDate}
                onChange={(e) => setAuthForm({ ...authForm, issueDate: e.target.value })}
              />
              <input
                className={field}
                placeholder="Duty saved (INR)"
                inputMode="decimal"
                value={authForm.dutySaved}
                onChange={(e) => setAuthForm({ ...authForm, dutySaved: e.target.value })}
              />
              <input
                className={field}
                placeholder="Obligation (AA)"
                inputMode="decimal"
                value={authForm.exportObligationAmount}
                onChange={(e) =>
                  setAuthForm({ ...authForm, exportObligationAmount: e.target.value })
                }
              />
              <button className={primary} type="submit">
                Add authorisation
              </button>
            </form>
          )}
          <ul className="space-y-3">
            {auths.map((a) => (
              <li key={a.id} className="rounded-lg border border-line-soft p-3">
                <button
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  onClick={() => void openDetail(a.id)}
                >
                  <span className="font-medium text-ink">
                    {a.authType === "EPCG" ? "EPCG" : "AA"} {a.authNo}
                  </span>
                  <span className="text-xs text-ink-muted">
                    Obligation {inr(a.exportObligationAmount)} · due {d10(a.eoDueDate)} (
                    {a.progress.daysToDue} days) · {a.status}
                  </span>
                </button>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, a.progress.eoPercent)}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-ink-muted">
                  {a.progress.eoPercent}% realised
                  {a.progress.block1Percent !== null &&
                    ` · block 1 (50% by ${d10(a.block1DueDate)}): ${a.progress.block1Percent}%`}
                </div>
              </li>
            ))}
            {auths.length === 0 && (
              <li className="text-sm text-ink-muted">No authorisations yet.</li>
            )}
          </ul>
          {detail && (
            <aside className="mt-4 rounded-lg border border-line-soft p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-ink">Shipping bills against {detail.authNo}</h2>
                <button className={secondary} onClick={() => setDetail(null)}>
                  Close
                </button>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th className={th}>Shipping bill</th>
                    <th className={th}>Date</th>
                    <th className={th}>FOB</th>
                    <th className={th}>Realised on</th>
                    <th className={th}>BRC</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.entries ?? []).map((e) => (
                    <tr key={e.id} className="border-b border-line-soft">
                      <td className={td}>{e.shippingBillNo}</td>
                      <td className={td}>{d10(e.shippingBillDate)}</td>
                      <td className={td}>{inr(e.fobValueInr)}</td>
                      <td className={td}>{d10(e.realisedOn)}</td>
                      <td className={td}>{e.brcNo ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </aside>
          )}
        </Card>
      )}
    </div>
  );
};

export default ExportIncentivesPage;
