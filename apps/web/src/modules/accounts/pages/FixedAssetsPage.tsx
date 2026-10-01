import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  assetService,
  type AssetClassRow,
  type AssetRegister,
  type AssetRow,
  type DepreciationMethod,
  type DepreciationPreview,
  type DepreciationRunDetail,
  type DepreciationRunRow,
  type ItBlocks,
  type OpeningRowError,
} from "../../../services/assetService";
import { PageHeader } from "../../../components/ui/v2";
import {
  Card,
  day,
  field,
  fyOptions,
  message,
  money,
  monthOptions,
  primary,
  secondary,
  success,
  td,
  th,
} from "../components/reportUi";

/**
 * Fixed assets (P1-18).
 *
 * The register and the depreciation run share a screen because they are the same fact seen twice:
 * what the company owns, and what this month says it is worth. The two year-end reports sit
 * behind their own tabs and are deliberately not shown side by side — the Companies Act number
 * and the income-tax number are about different things, and inviting a reader to reconcile them
 * is inviting a mistake.
 */
type Tab = "register" | "depreciation" | "yearEnd" | "tax" | "classes";
const STATUS_STYLE: Record<AssetRow["status"], string> = {
  ACTIVE: "sl-chip-success",
  DISPOSED: "sl-chip-muted",
  WRITTEN_OFF: "sl-chip-warning",
};

const FixedAssetsPage: React.FC = () => {
  const { can } = usePermission();
  const years = useMemo(() => fyOptions(3), []);
  const months = useMemo(() => monthOptions(12), []);
  const [tab, setTab] = useState<Tab>("register");
  const [fyCode, setFyCode] = useState(years[0].value);
  const [periodKey, setPeriodKey] = useState(months[1]?.value ?? months[0].value);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [classes, setClasses] = useState<AssetClassRow[]>([]);
  const [preview, setPreview] = useState<DepreciationPreview | null>(null);
  const [runs, setRuns] = useState<DepreciationRunRow[]>([]);
  const [register, setRegister] = useState<AssetRegister | null>(null);
  const [blocks, setBlocks] = useState<ItBlocks | null>(null);
  const [adding, setAdding] = useState(false);
  const [disposing, setDisposing] = useState<AssetRow | null>(null);
  const [importingOpening, setImportingOpening] = useState(false);
  const [editingClass, setEditingClass] = useState<AssetClassRow | "new" | null>(null);
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "register") setAssets(await assetService.list());
      if (tab === "classes") setClasses(await assetService.classes(true));
      if (tab === "depreciation") {
        setPreview(await assetService.preview(periodKey));
        setRuns(await assetService.runs());
      }
      if (tab === "yearEnd") setRegister(await assetService.register(fyCode));
      if (tab === "tax") setBlocks(await assetService.itBlocks(fyCode));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, periodKey, fyCode]);
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
  const runFor = runs.find((r) => r.periodKey === periodKey);

  return (
    <div className="sl-page">
      <PageHeader
        title="Fixed assets"
        subtitle="The register, the monthly charge under Schedule II, and the income-tax block depreciation that goes on the return. The two are separate calculations and are not meant to agree."
        actions={
          <>
            {tab === "depreciation" && (
              <select
                className={field}
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                aria-label="Month"
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
            {(tab === "yearEnd" || tab === "tax") && (
              <select
                className={field}
                value={fyCode}
                onChange={(e) => setFyCode(e.target.value)}
                aria-label="Financial year"
              >
                {years.map((y) => (
                  <option key={y.value} value={y.value}>
                    {y.label}
                  </option>
                ))}
              </select>
            )}
            {tab === "register" && can("assets.manage") && (
              <button className={secondary} onClick={() => setImportingOpening(true)}>
                Import opening balances
              </button>
            )}
            {tab === "register" && can("assets.create") && (
              <button className={primary} onClick={() => setAdding(true)}>
                Add an asset
              </button>
            )}
            {tab === "classes" && can("assets.manage") && (
              <button className={primary} onClick={() => setEditingClass("new")}>
                Add a class
              </button>
            )}
          </>
        }
      />

      <nav className="flex flex-wrap gap-2" role="tablist">
        {(
          [
            ["register", "Register"],
            ["depreciation", "Monthly charge"],
            ["yearEnd", "Schedule II"],
            ["tax", "Income tax"],
            ["classes", "Classes"],
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

      {tab === "register" && (
        <Card title="Assets">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Asset</th>
                  <th className={th}>Class</th>
                  <th className={th}>In use since</th>
                  <th className={`${th} text-right`}>Cost</th>
                  <th className={`${th} text-right`}>Depreciation</th>
                  <th className={`${th} text-right`}>Written down</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id} className="border-t border-line-soft">
                    <td className={td}>{a.code}</td>
                    <td className={td}>
                      {a.name}
                      {a.location && <div className="text-xs text-ink-muted">{a.location}</div>}
                    </td>
                    <td className={td}>
                      {a.assetClass.name}
                      <div className="text-xs text-ink-muted">{a.method}</div>
                    </td>
                    <td className={td}>{day(a.capitalisedOn)}</td>
                    <td className={`${td} text-right`}>{money(a.cost)}</td>
                    <td className={`${td} text-right`}>{money(a.accumulatedDepreciation)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(a.wdv)}</td>
                    <td className={td}>
                      <span className={`sl-chip sl-chip-sm ${STATUS_STYLE[a.status]}`}>
                        {a.status.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </td>
                    <td className={`${td} text-right`}>
                      {a.status === "ACTIVE" && can("assets.dispose") && (
                        <button className={secondary} onClick={() => setDisposing(a)}>
                          Dispose
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {assets.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={9}>
                      Nothing on the register yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "depreciation" && preview && (
        <>
          <Card
            title={`Depreciation for ${preview.from} to ${preview.to}`}
            actions={
              can("assets.depreciate") && (
                <div className="flex gap-2">
                  {!runFor && (
                    <button
                      className={primary}
                      disabled={busy || preview.lines.length === 0}
                      onClick={() => act(() => assetService.prepare(periodKey), "Prepared")}
                    >
                      Prepare the month
                    </button>
                  )}
                  {runFor?.status === "DRAFT" && (
                    <button
                      className={success}
                      disabled={busy}
                      onClick={() => act(() => assetService.post(runFor.id), "Posted")}
                    >
                      Post to the books
                    </button>
                  )}
                </div>
              )
            }
          >
            <p className="mb-3 text-sm text-ink">
              {runFor
                ? `This month is ${runFor.status.toLowerCase()} — ${money(runFor.totalAmount)} across ${runFor.assetCount} asset(s).`
                : `${money(preview.total)} across ${preview.lines.length} asset(s), charged by days in use.`}
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Asset</th>
                    <th className={th}>Class</th>
                    <th className={`${th} text-right`}>Days</th>
                    <th className={`${th} text-right`}>Opening</th>
                    <th className={`${th} text-right`}>Charge</th>
                    <th className={`${th} text-right`}>Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <tr key={l.assetId} className="border-t border-line-soft">
                      <td className={td}>
                        {l.name}
                        <div className="text-xs text-ink-muted">{l.code}</div>
                      </td>
                      <td className={td}>{l.className}</td>
                      <td className={`${td} text-right`}>{l.daysInUse}</td>
                      <td className={`${td} text-right`}>{money(l.openingWdv)}</td>
                      <td className={`${td} text-right font-semibold`}>{money(l.amount)}</td>
                      <td className={`${td} text-right`}>{money(l.closingWdv)}</td>
                    </tr>
                  ))}
                  {preview.lines.length === 0 && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={6}>
                        Nothing left to charge for this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Past runs">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Month</th>
                    <th className={`${th} text-right`}>Assets</th>
                    <th className={`${th} text-right`}>Charge</th>
                    <th className={th}>Status</th>
                    <th className={th}>Posted</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t border-line-soft">
                      <td className={td}>{r.periodKey}</td>
                      <td className={`${td} text-right`}>{r.assetCount}</td>
                      <td className={`${td} text-right`}>{money(r.totalAmount)}</td>
                      <td className={td}>{r.status.toLowerCase()}</td>
                      <td className={td}>{r.postedAt ? day(r.postedAt) : "—"}</td>
                      <td className={`${td} text-right space-x-2`}>
                        {r.status === "REVERSED" && (
                          <button className={secondary} onClick={() => setViewingRunId(r.id)}>
                            View
                          </button>
                        )}
                        {r.status === "POSTED" && can("assets.depreciate") && (
                          <button
                            className={secondary}
                            disabled={busy}
                            onClick={() =>
                              act(() => assetService.reverseRun(r.id), `${r.periodKey} reversed`)
                            }
                          >
                            Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && !loading && (
                    <tr>
                      <td className={`${td} text-ink-muted`} colSpan={6}>
                        No month has been run yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "yearEnd" && register && (
        <Card title={`Fixed asset register · ${register.fyStart} to ${register.fyEnd}`}>
          <p className="mb-3 text-xs text-ink-muted">
            The Schedule II movement the notes to the accounts print. Depreciation is summed from
            what was actually posted, so this ties to the ledgers rather than being recomputed.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Class</th>
                  <th className={`${th} text-right`}>Opening cost</th>
                  <th className={`${th} text-right`}>Additions</th>
                  <th className={`${th} text-right`}>Disposals</th>
                  <th className={`${th} text-right`}>Closing cost</th>
                  <th className={`${th} text-right`}>Charge</th>
                  <th className={`${th} text-right`}>Closing depreciation</th>
                  <th className={`${th} text-right`}>Written down</th>
                </tr>
              </thead>
              <tbody>
                {register.rows.map((r) => (
                  <tr key={r.classCode} className="border-t border-line-soft">
                    <td className={td}>
                      {r.className}
                      <div className="text-xs text-ink-muted">{r.scheduleIiHead ?? "—"}</div>
                    </td>
                    <td className={`${td} text-right`}>{money(r.openingCost)}</td>
                    <td className={`${td} text-right`}>{money(r.additions)}</td>
                    <td className={`${td} text-right`}>{money(r.disposalsCost)}</td>
                    <td className={`${td} text-right`}>{money(r.closingCost)}</td>
                    <td className={`${td} text-right`}>{money(r.chargeForYear)}</td>
                    <td className={`${td} text-right`}>{money(r.closingDep)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(r.closingWdv)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line-soft font-semibold">
                  <td className={td}>Total</td>
                  <td className={`${td} text-right`}>{money(register.totals.openingCost)}</td>
                  <td className={`${td} text-right`}>{money(register.totals.additions)}</td>
                  <td className={`${td} text-right`}>{money(register.totals.disposalsCost)}</td>
                  <td className={`${td} text-right`}>{money(register.totals.closingCost)}</td>
                  <td className={`${td} text-right`}>{money(register.totals.chargeForYear)}</td>
                  <td className={`${td} text-right`}>{money(register.totals.closingDep)}</td>
                  <td className={`${td} text-right`}>{money(register.totals.closingWdv)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "tax" && blocks && (
        <Card title={`Income-tax depreciation · FY ${blocks.fyCode}`}>
          <div className="mb-3 rounded-lg border border-[color:var(--color-warning)]/40 bg-[color:var(--color-warning)]/10 p-3 text-sm text-[color:var(--color-warning)]">
            {blocks.note} A block is a pool, the rate is the Act&apos;s, an asset used for under 180
            days gets half of it, and sale proceeds come off the block instead of producing a
            profit. This figure goes on the return; the Schedule II tab goes in the accounts.
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Block</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={`${th} text-right`}>Opening</th>
                  <th className={`${th} text-right`}>Additions (full)</th>
                  <th className={`${th} text-right`}>Additions (half)</th>
                  <th className={`${th} text-right`}>Deletions</th>
                  <th className={`${th} text-right`}>Depreciation</th>
                  <th className={`${th} text-right`}>Closing</th>
                </tr>
              </thead>
              <tbody>
                {blocks.rows.map((r) => (
                  <tr key={r.block} className="border-t border-line-soft">
                    <td className={td}>{r.block}</td>
                    <td className={`${td} text-right`}>{r.rate}%</td>
                    <td className={`${td} text-right`}>{money(r.openingWdv)}</td>
                    <td className={`${td} text-right`}>{money(r.additionsFullRate)}</td>
                    <td className={`${td} text-right`}>{money(r.additionsHalfRate)}</td>
                    <td className={`${td} text-right`}>{money(r.deletions)}</td>
                    <td className={`${td} text-right font-semibold`}>{money(r.depreciation)}</td>
                    <td className={`${td} text-right`}>{money(r.closingWdv)}</td>
                  </tr>
                ))}
                {blocks.rows.length === 0 && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={8}>
                      No blocks for this year.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "classes" && (
        <Card title="Asset classes">
          <p className="mb-3 text-xs text-ink-muted">
            Each class carries both regimes: the Schedule II life and method for the accounts, and
            the income-tax block and rate for the return. They are edited together because they
            describe the same machine, and used apart because they answer different questions.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Class</th>
                  <th className={`${th} text-right`}>Life</th>
                  <th className={th}>Method</th>
                  <th className={`${th} text-right`}>Residual</th>
                  <th className={th}>Schedule III head</th>
                  <th className={th}>Income-tax block</th>
                  <th className={`${th} text-right`}>Rate</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id} className="border-t border-line-soft">
                    <td className={td}>{c.code}</td>
                    <td className={td}>{c.name}</td>
                    <td className={`${td} text-right`}>{c.usefulLifeYears} yrs</td>
                    <td className={td}>{c.method}</td>
                    <td className={`${td} text-right`}>{Number(c.residualPercent)}%</td>
                    <td className={td}>{c.scheduleIiHead ?? "—"}</td>
                    <td className={td}>{c.itBlockName ?? "—"}</td>
                    <td className={`${td} text-right`}>{Number(c.itBlockRate)}%</td>
                    <td className={`${td} text-right`}>
                      {can("assets.manage") && (
                        <button className={secondary} onClick={() => setEditingClass(c)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {adding && (
        <AddAssetDialog
          classes={classes.length > 0 ? classes : undefined}
          busy={busy}
          onCancel={() => setAdding(false)}
          onDone={(body) =>
            act(async () => {
              await assetService.create(body);
              setAdding(false);
            }, "Added to the register")
          }
        />
      )}

      {disposing && (
        <DisposeDialog
          asset={disposing}
          busy={busy}
          onCancel={() => setDisposing(null)}
          onDone={(body) =>
            act(async () => {
              await assetService.dispose(disposing.id, body);
              setDisposing(null);
            }, "Disposed")
          }
        />
      )}

      {importingOpening && (
        <OpeningImportDialog
          onCancel={() => setImportingOpening(false)}
          onImported={(result) => {
            setImportingOpening(false);
            toast.success(
              `Imported ${result.imported} asset(s), ${result.vouchers} opening voucher(s) posted`
            );
            void load();
          }}
        />
      )}

      {editingClass && (
        <ClassEditDialog
          value={editingClass === "new" ? null : editingClass}
          busy={busy}
          onCancel={() => setEditingClass(null)}
          onDone={(body) =>
            act(async () => {
              await assetService.upsertClass(body);
              setEditingClass(null);
            }, "Class saved")
          }
        />
      )}

      {viewingRunId && (
        <RunDetailDialog runId={viewingRunId} onClose={() => setViewingRunId(null)} />
      )}
    </div>
  );
};

/**
 * A reversed run's restored figures against each asset (P2-19), in one place: what this run
 * charged, and what the asset's accumulated depreciation was before and after the reversal put it
 * back — instead of checking the asset row and the run separately.
 */
const RunDetailDialog: React.FC<{ runId: string; onClose: () => void }> = ({ runId, onClose }) => {
  const [detail, setDetail] = useState<DepreciationRunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    assetService
      .runDetail(runId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => toast.error(message(err)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sl-tile p-4">
        <h2 className="text-lg font-semibold text-ink">
          Depreciation run {detail?.periodKey ?? ""}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Reversed. What each asset&apos;s accumulated depreciation was before the reversal (with
          this run&apos;s charge still on it) and after (restored).
        </p>
        {loading && <p className="mt-3 text-sm text-ink-muted">Loading…</p>}
        {detail && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Asset</th>
                  <th className={`${th} text-right`}>This run&apos;s charge</th>
                  <th className={`${th} text-right`}>Accum. dep. before</th>
                  <th className={`${th} text-right`}>Accum. dep. after</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => (
                  <tr key={l.assetId} className="border-t border-line-soft">
                    <td className={td}>
                      {l.name}
                      <div className="text-xs text-ink-muted">{l.code}</div>
                    </td>
                    <td className={`${td} text-right`}>{money(l.amount)}</td>
                    <td className={`${td} text-right`}>{money(l.accumulatedDepreciationBefore)}</td>
                    <td className={`${td} text-right font-semibold`}>
                      {money(l.accumulatedDepreciationAfter)}
                    </td>
                  </tr>
                ))}
                {detail.lines.length === 0 && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={4}>
                      No lines on this run.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button className={secondary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const AddAssetDialog: React.FC<{
  classes?: AssetClassRow[];
  busy: boolean;
  onCancel: () => void;
  onDone: (body: {
    code: string;
    name: string;
    classCode: string;
    cost: number;
    acquiredOn: string;
    capitalisedOn?: string;
    location?: string | null;
  }) => void;
}> = ({ classes, busy, onCancel, onDone }) => {
  const [list, setList] = useState<AssetClassRow[]>(classes ?? []);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [classCode, setClassCode] = useState(classes?.[0]?.code ?? "PM");
  const [cost, setCost] = useState("");
  const [acquiredOn, setAcquiredOn] = useState(new Date().toISOString().slice(0, 10));
  const [capitalisedOn, setCapitalisedOn] = useState(new Date().toISOString().slice(0, 10));
  const [location, setLocation] = useState("");

  useEffect(() => {
    if (list.length === 0) {
      void assetService
        .classes()
        .then((rows) => {
          setList(rows);
          if (rows[0]) setClassCode(rows[0].code);
        })
        .catch(() => undefined);
    }
  }, [list.length]);

  return (
    <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-lg sl-tile p-4">
        <h2 className="text-lg font-semibold text-ink">Add an asset</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Depreciation runs from the day it was put to use, not the day it was bought.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-muted">
            Code
            <input
              className={`${field} mt-1 w-full`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="FA-0001"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Name
            <input
              className={`${field} mt-1 w-full`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Class
            <select
              className={`${field} mt-1 w-full`}
              value={classCode}
              onChange={(e) => setClassCode(e.target.value)}
            >
              {list.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.usefulLifeYears} yrs, {c.method})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink-muted">
            Cost
            <input
              className={`${field} mt-1 w-full`}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Everything it cost to bring into use"
            />
          </label>
          <label className="text-sm text-ink-muted">
            Bought on
            <input
              type="date"
              className={`${field} mt-1 w-full`}
              value={acquiredOn}
              onChange={(e) => setAcquiredOn(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Put to use on
            <input
              type="date"
              className={`${field} mt-1 w-full`}
              value={capitalisedOn}
              onChange={(e) => setCapitalisedOn(e.target.value)}
            />
          </label>
          <label className="col-span-2 text-sm text-ink-muted">
            Where it is
            <input
              className={`${field} mt-1 w-full`}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className={secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={primary}
            disabled={busy || !code.trim() || !name.trim() || !(Number(cost) > 0)}
            onClick={() =>
              onDone({
                code: code.trim(),
                name: name.trim(),
                classCode,
                cost: Number(cost),
                acquiredOn,
                capitalisedOn,
                location: location.trim() || null,
              })
            }
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
};

const DisposeDialog: React.FC<{
  asset: AssetRow;
  busy: boolean;
  onCancel: () => void;
  onDone: (body: { disposedOn: string; proceeds?: number }) => void;
}> = ({ asset, busy, onCancel, onDone }) => {
  const [disposedOn, setDisposedOn] = useState(new Date().toISOString().slice(0, 10));
  const [proceeds, setProceeds] = useState("0");
  const result = Number(proceeds || 0) - asset.wdv;

  return (
    <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-md sl-tile p-4">
        <h2 className="text-lg font-semibold text-ink">Dispose of {asset.name}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Written down to {money(asset.wdv)}. The profit or loss is measured against that, not
          against cost.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-muted">
            Gone on
            <input
              type="date"
              className={`${field} mt-1 w-full`}
              value={disposedOn}
              onChange={(e) => setDisposedOn(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Proceeds
            <input
              className={`${field} mt-1 w-full`}
              value={proceeds}
              onChange={(e) => setProceeds(e.target.value)}
            />
          </label>
        </div>
        <p
          className={`mt-3 text-sm font-semibold ${result >= 0 ? "text-[color:var(--color-success)]" : "text-[color:var(--color-danger)]"}`}
        >
          {result >= 0 ? "Profit" : "Loss"} on sale: {money(Math.abs(result))}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className={secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={primary}
            disabled={busy}
            onClick={() => onDone({ disposedOn, proceeds: Number(proceeds || 0) })}
          >
            Take it off the register
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Opening balances (P2-07): a file or a pasted sheet, one row per asset already part-depreciated.
 * Every row is validated before anything is written, so a bad row shows its own line here and
 * nothing else in the sheet is touched — the same all-or-nothing guarantee the API gives.
 */
const OPENING_TEMPLATE =
  "classCode,code,name,businessPlaceCode,capitalisedOn,cost,accumulatedDepreciation,method,remainingLifeMonths,wdvRatePercent,quantity,location\n" +
  "PM,FA-0101,Injection Moulding Machine,,2023-06-15,850000,212500,SLM,84,,1,Shed 2\n";

const OpeningImportDialog: React.FC<{
  onCancel: () => void;
  onImported: (result: { imported: number; vouchers: number }) => void;
}> = ({ onCancel, onImported }) => {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState<OpeningRowError[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const downloadTemplate = async () => {
    try {
      const blob = await assetService.openingTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "shiftline-asset-opening-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(message(err));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    setRowErrors([]);
    try {
      const result = await assetService.importOpeningCsv(csv);
      onImported(result);
    } catch (err) {
      const details = (
        err as { response?: { data?: { code?: string; details?: { errors?: OpeningRowError[] } } } }
      )?.response?.data;
      if (details?.code === "OPENING_IMPORT_INVALID" && details.details?.errors) {
        setRowErrors(details.details.errors);
      } else {
        setError(message(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto sl-tile p-4">
        <h2 className="text-lg font-semibold text-ink">Import opening balances</h2>
        <p className="mt-1 text-sm text-ink-muted">
          One row per asset already part-depreciated: class code, asset code, name, business place
          (optional), put-to-use date, cost, accumulated depreciation to date, method, and either
          the remaining life in months (SLM) or a WDV rate percent. Every row is checked before
          anything is written.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="text-sm text-ink-muted"
          />
          <button className={secondary} onClick={downloadTemplate}>
            Download the template
          </button>
        </div>
        <textarea
          className={`${field} mt-3 h-40 w-full tabular-nums text-xs`}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={OPENING_TEMPLATE}
        />
        {error && <p className="mt-2 text-sm text-[color:var(--color-danger)]">{error}</p>}
        {rowErrors.length > 0 && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-[color:var(--color-danger)]/40">
            <table className="min-w-full text-sm">
              <thead className="bg-[color:var(--color-danger)]/10">
                <tr>
                  <th className={th}>Row</th>
                  <th className={th}>Problem</th>
                </tr>
              </thead>
              <tbody>
                {rowErrors.map((e, i) => (
                  <tr key={i} className="border-t border-[color:var(--color-danger)]/40">
                    <td className={td}>{e.row}</td>
                    <td className={`${td} text-[color:var(--color-danger)]`}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className={secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={primary} disabled={busy || !csv.trim()} onClick={submit}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

/** Both regimes on one class, editable together (P2-07): the endpoint has always allowed it. */
const ClassEditDialog: React.FC<{
  value: AssetClassRow | null;
  busy: boolean;
  onCancel: () => void;
  onDone: (body: {
    id?: string;
    code: string;
    name: string;
    usefulLifeYears: number;
    method: DepreciationMethod;
    residualPercent: number;
    scheduleIiHead: string | null;
    itBlockName: string | null;
    itBlockRate: number;
    isActive: boolean;
  }) => void;
}> = ({ value, busy, onCancel, onDone }) => {
  const [code, setCode] = useState(value?.code ?? "");
  const [name, setName] = useState(value?.name ?? "");
  const [usefulLifeYears, setUsefulLifeYears] = useState(String(value?.usefulLifeYears ?? 10));
  const [method, setMethod] = useState<DepreciationMethod>(value?.method ?? "SLM");
  const [residualPercent, setResidualPercent] = useState(String(value?.residualPercent ?? 5));
  const [scheduleIiHead, setScheduleIiHead] = useState(value?.scheduleIiHead ?? "");
  const [itBlockName, setItBlockName] = useState(value?.itBlockName ?? "");
  const [itBlockRate, setItBlockRate] = useState(String(value?.itBlockRate ?? 15));
  const [isActive, setIsActive] = useState(value?.isActive ?? true);

  return (
    <div className="sl-backdrop z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-lg sl-tile p-4">
        <h2 className="text-lg font-semibold text-ink">{value ? "Edit class" : "Add a class"}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          The Schedule II life and method for the accounts, and the income-tax block and rate for
          the return — the same class, both regimes.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm text-ink-muted">
            Code
            <input
              className={`${field} mt-1 w-full`}
              value={code}
              disabled={!!value}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Name
            <input
              className={`${field} mt-1 w-full`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Useful life (years)
            <input
              className={`${field} mt-1 w-full`}
              value={usefulLifeYears}
              onChange={(e) => setUsefulLifeYears(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Method
            <select
              className={`${field} mt-1 w-full`}
              value={method}
              onChange={(e) => setMethod(e.target.value as DepreciationMethod)}
            >
              <option value="SLM">Straight line</option>
              <option value="WDV">Written down value</option>
            </select>
          </label>
          <label className="text-sm text-ink-muted">
            Residual (%)
            <input
              className={`${field} mt-1 w-full`}
              value={residualPercent}
              onChange={(e) => setResidualPercent(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Schedule II head
            <input
              className={`${field} mt-1 w-full`}
              value={scheduleIiHead}
              onChange={(e) => setScheduleIiHead(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Income-tax block
            <input
              className={`${field} mt-1 w-full`}
              value={itBlockName}
              onChange={(e) => setItBlockName(e.target.value)}
            />
          </label>
          <label className="text-sm text-ink-muted">
            Block rate (%)
            <input
              className={`${field} mt-1 w-full`}
              value={itBlockRate}
              onChange={(e) => setItBlockRate(e.target.value)}
            />
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className={secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={primary}
            disabled={busy || !code.trim() || !name.trim()}
            onClick={() =>
              onDone({
                id: value?.id,
                code: code.trim(),
                name: name.trim(),
                usefulLifeYears: Number(usefulLifeYears),
                method,
                residualPercent: Number(residualPercent),
                scheduleIiHead: scheduleIiHead.trim() || null,
                itBlockName: itBlockName.trim() || null,
                itBlockRate: Number(itBlockRate),
                isActive,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

export default FixedAssetsPage;
