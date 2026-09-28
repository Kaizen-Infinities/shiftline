import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  tallyService,
  type TallyMappingRow,
  type TallyNameKind,
  type TallyPreview,
  type TallyRunRow,
  type TallyScope,
} from "../../../services/tallyService";
import {
  Card,
  day,
  danger,
  field,
  message,
  primary,
  secondary,
  success,
  td,
  th,
} from "../components/reportUi";

/**
 * Tally export (P1-06).
 *
 * The screen is built around the handover, not the file: which month is going to the accountant,
 * what is in it, and what has already been imported. Confirming a run is deliberately a separate
 * click, because that is the only thing that tells the next incremental export where to start —
 * and nothing here can see whether Tally actually accepted anything.
 */
type Tab = "export" | "runs" | "mapping";
const SCOPES: { value: TallyScope; label: string }[] = [
  { value: "BOTH", label: "Masters and vouchers" },
  { value: "VOUCHERS", label: "Vouchers only" },
  { value: "MASTERS", label: "Masters only" },
];
const KINDS: TallyNameKind[] = ["GROUP", "LEDGER", "UNIT", "STOCK_ITEM", "VOUCHER_TYPE"];
const STATUS_STYLE: Record<TallyRunRow["status"], string> = {
  DRAFT: "sl-chip-warning",
  CONFIRMED: "sl-chip-success",
  DISCARDED: "sl-chip-muted",
};
const COUNT_LABELS: Record<string, string> = {
  groups: "Groups",
  ledgers: "Ledgers",
  units: "Units",
  stockItems: "Stock items",
  vouchers: "Vouchers",
  cancelled: "Cancelled",
  entries: "Entries",
};
/** The month just gone, which is what an accountant asks for. */
const lastMonth = () => {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
};

const TallyExportPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<Tab>("export");
  const [range, setRange] = useState(lastMonth);
  const [scope, setScope] = useState<TallyScope>("BOTH");
  const [incremental, setIncremental] = useState(false);
  const [preview, setPreview] = useState<TallyPreview | null>(null);
  const [runs, setRuns] = useState<TallyRunRow[]>([]);
  const [mappings, setMappings] = useState<TallyMappingRow[]>([]);
  const [autoExport, setAutoExport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void tallyService
      .settings()
      .then((s) => setAutoExport(s.autoExportEnabled))
      .catch((err) => toast.error(message(err)));
  }, []);

  const toggleAutoExport = async (next: boolean) => {
    setAutoExport(next);
    try {
      await tallyService.updateSettings({ autoExportEnabled: next });
    } catch (err) {
      setAutoExport(!next);
      toast.error(message(err));
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "export") {
        setPreview(await tallyService.preview({ ...range, scope, incremental }));
      }
      if (tab === "runs") setRuns(await tallyService.runs());
      if (tab === "mapping") setMappings(await tallyService.mappings());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, range, scope, incremental]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sl-page">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="sl-h1 m-0 leading-tight">Tally Export</h1>
          <p className="sl-muted m-0 mt-1 max-w-3xl text-sm leading-snug">
            The books as an XML file your accountant imports into Tally — groups and ledgers under
            the names Tally already uses, and the month's vouchers in its own sign convention.
          </p>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" role="tablist">
        {(
          [
            ["export", "Export"],
            ["runs", "Handovers"],
            ["mapping", "Name mapping"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="sl-chip sl-chip-lg"
          >
            {label}
          </button>
        ))}
      </nav>

      {loading && (
        <div className="sl-tile space-y-3 p-5" role="status" aria-label="Loading">
          <div className="sl-skeleton h-4 w-2/5" />
          <div className="sl-skeleton h-3 w-3/4" />
          <div className="sl-skeleton h-3 w-1/2" />
        </div>
      )}

      {tab === "export" && (
        <>
          <Card title="Automatic monthly export">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={autoExport}
                disabled={!can("tally.manage")}
                onChange={(e) => void toggleAutoExport(e.target.checked)}
              />
              Prepare last month&apos;s file automatically on the 1st and notify whoever handles
              Tally
            </label>
            <p className="mt-1 text-xs text-ink-muted">
              Off by default. This only prepares a handover — the accountant still has to mark it
              imported.
            </p>
          </Card>

          <Card title="What to hand over">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-ink-muted">
                From
                <input
                  type="date"
                  className={`${field} mt-1 block`}
                  value={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                />
              </label>
              <label className="text-sm text-ink-muted">
                To
                <input
                  type="date"
                  className={`${field} mt-1 block`}
                  value={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                />
              </label>
              <label className="text-sm text-ink-muted">
                Contents
                <select
                  className={`${field} mt-1 block`}
                  value={scope}
                  onChange={(e) => setScope(e.target.value as TallyScope)}
                >
                  {SCOPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={incremental}
                  onChange={(e) => setIncremental(e.target.checked)}
                />
                Only what changed since the last handover
              </label>
            </div>
            {incremental && preview && (
              <p className="mt-2 text-xs text-ink-muted">
                {preview.sinceAt
                  ? `Picking up from ${day(preview.sinceAt)}.`
                  : "Nothing has been marked imported yet, so this is everything in the period."}
              </p>
            )}
          </Card>

          {preview && (
            <Card
              title="In this file"
              actions={
                can("tally.export") && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            scope === "MASTERS"
                              ? tallyService.downloadMasters()
                              : tallyService.downloadVouchers({ ...range, incremental }),
                          "Downloaded"
                        )
                      }
                    >
                      Download without recording
                    </button>
                    <button
                      className={primary}
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const run = await tallyService.createRun({
                            ...range,
                            scope,
                            incremental,
                          });
                          await tallyService.downloadRun(run);
                          setTab("runs");
                        }, "Handover recorded")
                      }
                    >
                      Generate and record
                    </button>
                  </div>
                )
              }
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Object.entries(preview.counts).map(([key, value]) => (
                  <div key={key} className="rounded-lg border border-line-soft bg-card-2 p-3">
                    <p className="text-xs uppercase tracking-wide text-ink-muted">
                      {COUNT_LABELS[key] ?? key}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-muted">
                Recording the handover is what lets the next export carry only new work — but it
                only counts once you mark it imported, since nothing here can see Tally.
              </p>
            </Card>
          )}
        </>
      )}

      {tab === "runs" && (
        <Card title="Handovers">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Generated</th>
                  <th className={th}>Period</th>
                  <th className={th}>Contents</th>
                  <th className={`${th} text-right`}>Records</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-line-soft">
                    <td className={td}>
                      {day(r.createdAt)}
                      {r.incremental && <div className="text-xs text-ink-muted">changes only</div>}
                    </td>
                    <td className={td}>
                      {r.fromDate ? `${day(r.fromDate)} – ${day(r.toDate)}` : "—"}
                    </td>
                    <td className={td}>{r.scope.toLowerCase()}</td>
                    <td className={`${td} text-right`}>
                      {Object.values(r.counts ?? {}).reduce((s, v) => s + Number(v), 0)}
                    </td>
                    <td className={td}>
                      <span className={`sl-chip sl-chip-sm ${STATUS_STYLE[r.status]}`}>
                        {r.status.toLowerCase()}
                      </span>
                    </td>
                    <td className={`${td} text-right`}>
                      {can("tally.export") && (
                        <>
                          <button
                            className={`${secondary} mr-2`}
                            disabled={busy}
                            onClick={() => act(() => tallyService.downloadRun(r), "Downloaded")}
                          >
                            Download
                          </button>
                          {r.status === "DRAFT" && (
                            <>
                              <button
                                className={`${success} mr-2`}
                                disabled={busy}
                                onClick={() =>
                                  act(() => tallyService.confirmRun(r.id), "Marked imported")
                                }
                              >
                                Mark imported
                              </button>
                              <button
                                className={danger}
                                disabled={busy}
                                onClick={() => {
                                  const reason = window.prompt("Why is this being dropped?");
                                  if (reason)
                                    void act(
                                      () => tallyService.discardRun(r.id, reason),
                                      "Discarded"
                                    );
                                }}
                              >
                                Discard
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={6}>
                      Nothing has been handed over yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "mapping" && (
        <>
          <Card title="What things are called in Tally">
            <p className="mb-3 text-xs text-ink-muted">
              Tally&apos;s own groups — Sundry Debtors, Cash-in-Hand, Duties &amp; Taxes — are
              matched automatically and never re-created. Add a row here only where your Tally
              company uses a different name from ours, or to keep a ledger out of the file.
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Kind</th>
                    <th className={th}>Ours</th>
                    <th className={th}>In Tally</th>
                    <th className={th}>Under</th>
                    <th className={th}>Exported</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id} className="border-t border-line-soft">
                      <td className={td}>{m.kind.replace(/_/g, " ").toLowerCase()}</td>
                      <td className={td}>{m.sourceCode}</td>
                      <td className={td}>{m.tallyName}</td>
                      <td className={td}>{m.tallyParent ?? "—"}</td>
                      <td className={td}>{m.isExported ? "Yes" : "No"}</td>
                      <td className={`${td} text-right`}>
                        {can("tally.manage") && (
                          <button
                            className={danger}
                            disabled={busy}
                            onClick={() =>
                              act(() => tallyService.deleteMapping(m.id), "Mapping removed")
                            }
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {mappings.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={6}>
                        Nothing is renamed; the defaults are being used throughout.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          {can("tally.manage") && (
            <MappingForm
              busy={busy}
              onSave={(body) => act(() => tallyService.saveMapping(body), "Mapping saved")}
            />
          )}
        </>
      )}
    </div>
  );
};

const MappingForm: React.FC<{
  busy: boolean;
  onSave: (body: {
    kind: TallyNameKind;
    sourceCode: string;
    tallyName: string;
    tallyParent?: string | null;
    isExported?: boolean;
  }) => void;
}> = ({ busy, onSave }) => {
  const [kind, setKind] = useState<TallyNameKind>("LEDGER");
  const [sourceCode, setSourceCode] = useState("");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [exported, setExported] = useState(true);

  return (
    <Card title="Add a mapping">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-ink-muted">
          Kind
          <select
            className={`${field} mt-1 block`}
            value={kind}
            onChange={(e) => setKind(e.target.value as TallyNameKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink-muted">
          Our code
          <input
            className={`${field} mt-1 block`}
            value={sourceCode}
            onChange={(e) => setSourceCode(e.target.value)}
            placeholder="SALES-001"
          />
        </label>
        <label className="text-sm text-ink-muted">
          Name in Tally
          <input
            className={`${field} mt-1 block`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="text-sm text-ink-muted">
          Under (optional)
          <input
            className={`${field} mt-1 block`}
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            placeholder="Sales Accounts"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={exported}
            onChange={(e) => setExported(e.target.checked)}
          />
          Include in the file
        </label>
        <button
          className={primary}
          disabled={busy || !sourceCode.trim() || !name.trim()}
          onClick={() =>
            onSave({
              kind,
              sourceCode: sourceCode.trim(),
              tallyName: name.trim(),
              tallyParent: parent.trim() || null,
              isExported: exported,
            })
          }
        >
          Save mapping
        </button>
      </div>
    </Card>
  );
};

export default TallyExportPage;
