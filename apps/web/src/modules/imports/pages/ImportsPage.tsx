import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { PageHeader } from "../../../components/ui/v2";
import { FileSpreadsheet } from "lucide-react";
import {
  importsService,
  type ImportReport,
  type ImportTypeDef,
} from "../../../services/importsService";

const badge: Record<string, string> = {
  ok: "bg-[color:var(--color-success)]/15 text-[color:var(--color-success)]",
  exists: "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]",
  error: "bg-[color:var(--color-danger)]/15 text-[color:var(--color-danger)]",
};

const apiMessage = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  (err as Error)?.message ??
  "Something went wrong";

/**
 * Data imports (P1-00): pick a master, download its template, upload a CSV for a
 * dry run, fix what the report flags, then import. Only the types the user may
 * run are offered (the API filters them by permission).
 */
const ImportsPage: React.FC = () => {
  const [types, setTypes] = useState<ImportTypeDef[] | null>(null);
  const [selected, setSelected] = useState<ImportTypeDef | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<"dry" | "commit" | null>(null);
  const [filter, setFilter] = useState<"all" | "error" | "exists" | "ok">("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    importsService
      .types()
      .then((t) => {
        setTypes(t);
        setSelected(t[0] ?? null);
      })
      .catch((err) => toast.error(apiMessage(err)));
  }, []);

  const choose = (t: ImportTypeDef) => {
    setSelected(t);
    setFile(null);
    setReport(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const downloadTemplate = async () => {
    if (!selected) return;
    try {
      const blob = await importsService.template(selected.key);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shiftline-${selected.key}-template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiMessage(err));
    }
  };

  const dryRun = async (f: File) => {
    if (!selected) return;
    setBusy("dry");
    setReport(null);
    try {
      setReport(await importsService.run(selected.key, f, true));
      setFilter("all");
    } catch (err) {
      toast.error(apiMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!selected || !file) return;
    setBusy("commit");
    try {
      const r = await importsService.run(selected.key, file, false);
      setReport(r);
      if (r.failed) toast.warn(`Imported ${r.imported} rows, stopped at row ${r.failed.row}`);
      else if (!r.dryRun) toast.success(`Imported ${r.imported} rows`);
    } catch (err) {
      toast.error(apiMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const rows = report?.rows.filter((r) => filter === "all" || r.status === filter) ?? [];

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 text-ink md:p-6" data-testid="imports-page">
      <PageHeader
        title="Data imports"
        icon={<FileSpreadsheet size={22} />}
        subtitle="Bring masters and opening figures in from a spreadsheet. Every file is checked first; nothing is written until the report is clean and you press Import."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "Data imports" }]}
      />

      {!types ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : types.length === 0 ? (
        <p className="text-sm text-ink-muted">You do not have permission to import any data.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            {types.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => choose(t)}
                className={`w-full rounded-lg border px-4 py-3 text-left ${
                  selected?.key === t.key
                    ? "border-accent bg-accent/10"
                    : "border-line-soft bg-card hover:bg-card-2"
                }`}
              >
                <div className="text-sm font-semibold">{t.label}</div>
                <div className="mt-0.5 text-xs text-ink-muted">{t.description}</div>
              </button>
            ))}
          </aside>

          {selected && (
            <main className="space-y-6">
              <section className="sl-tile p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{selected.label}</h2>
                    <p className="text-xs text-ink-muted">
                      Columns marked * are required. Headers may be written as "Customer Code" or
                      "customer_code".
                    </p>
                  </div>
                  <button type="button" onClick={downloadTemplate} className="sl-btn sl-pill-sm">
                    Download template
                  </button>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-ink-muted">
                      <tr>
                        <th className="py-1 pr-3 font-semibold">Column</th>
                        <th className="py-1 pr-3 font-semibold">Example</th>
                        <th className="py-1 font-semibold">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.columns.map((c) => (
                        <tr key={c.key} className="border-t border-line-soft">
                          <td className="py-1.5 pr-3 font-mono">
                            {c.key}
                            {c.required && (
                              <span className="text-[color:var(--color-danger)]">*</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-ink-muted">{c.example}</td>
                          <td className="py-1.5 text-ink-muted">{c.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="sl-tile p-4 sm:p-5">
                <label className="block text-xs font-bold uppercase tracking-wider text-ink-muted">
                  CSV file
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="mt-2 block w-full text-sm"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFile(f);
                      if (f) void dryRun(f);
                    }}
                  />
                </label>
                {busy === "dry" && (
                  <p className="mt-3 text-sm text-ink-muted">Checking the file…</p>
                )}

                {report && (
                  <div className="mt-4">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {(
                        [
                          ["all", `${report.total} rows`],
                          ["ok", `${report.ok} ready`],
                          ["exists", `${report.exists} already exist`],
                          ["error", `${report.errors} with errors`],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setFilter(key)}
                          className={`rounded-full px-3 py-1 font-semibold ${
                            filter === key
                              ? "bg-accent text-[color:var(--color-on-primary)]"
                              : (badge[key] ?? "bg-card-2 text-ink")
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      {!report.dryRun && (
                        <span className="rounded-full bg-[color:var(--color-success)]/15 px-3 py-1 font-semibold text-[color:var(--color-success)]">
                          {report.imported} imported
                        </span>
                      )}
                    </div>
                    {report.ignoredColumns.length > 0 && (
                      <p className="mt-2 text-xs text-[color:var(--color-warning)]">
                        Ignored columns: {report.ignoredColumns.join(", ")}
                      </p>
                    )}
                    {report.failed && (
                      <p className="mt-2 text-xs text-[color:var(--color-danger)]">
                        Stopped at row {report.failed.row}: {report.failed.message}. Rows before it
                        were imported; remove them from the file and run again.
                      </p>
                    )}

                    <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-line-soft">
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-card-2 text-ink-muted">
                          <tr>
                            <th className="px-3 py-2 font-semibold">Row</th>
                            <th className="px-3 py-2 font-semibold">Code</th>
                            <th className="px-3 py-2 font-semibold">Status</th>
                            <th className="px-3 py-2 font-semibold">Messages</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.row} className="border-t border-line-soft">
                              <td className="px-3 py-1.5">{r.row}</td>
                              <td className="px-3 py-1.5 font-mono">{r.code ?? "—"}</td>
                              <td className="px-3 py-1.5">
                                <span
                                  className={`rounded-full px-2 py-0.5 font-semibold ${badge[r.status]}`}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-ink-muted">
                                {r.messages.join("; ")}
                              </td>
                            </tr>
                          ))}
                          {rows.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-3 py-3 text-center text-ink-muted">
                                No rows in this view
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {report.dryRun && (
                      <div className="mt-4 flex items-center justify-between">
                        <p className="text-xs text-ink-muted">
                          {report.errors > 0
                            ? "Fix the rows with errors in your spreadsheet and choose the file again."
                            : report.ok > 0
                              ? `${report.ok} row(s) will be created; rows that already exist are skipped.`
                              : "Nothing new to import."}
                        </p>
                        <button
                          type="button"
                          onClick={commit}
                          disabled={busy !== null || report.errors > 0 || report.ok === 0}
                          className="sl-cta sl-pill-md"
                        >
                          {busy === "commit" ? "Importing…" : `Import ${report.ok} row(s)`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </main>
          )}
        </div>
      )}
    </div>
  );
};

export default ImportsPage;
