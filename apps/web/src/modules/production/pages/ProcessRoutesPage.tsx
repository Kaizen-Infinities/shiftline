import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Pencil,
  Plus,
  Route as RouteIcon,
  Trash2,
  X,
} from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  processRoutesService,
  type ProcessRoute,
  type RouteOptions,
  type StepInput,
  type StepMode,
} from "../../../services/processRoutesService";
import { message } from "../../compliance/components/gstUi";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tile,
  Toolbar,
  type ToolbarFilter,
} from "../../../components/ui/v2";
import { PageBody } from "../ui";
import { ModeChip } from "./processRoutesUi";
import { pct, stepLabel } from "./processRoutesFormat";

/**
 * Process routes (TN-06): the ordered chain a product travels (knitting → dyeing → printing →
 * stitching; casting → fettling → machining), each step in-house or at a job worker, with a loss
 * norm and a unit change. A route with lots on it keeps its steps; it can only be deactivated.
 */
type Filter = "ACTIVE" | "INACTIVE" | "ALL";

interface StepRow {
  key: string;
  name: string;
  mode: StepMode;
  defaultJobWorkerId: string;
  lossNormPct: string;
  uomIn: string;
  uomOut: string;
  conversionFactor: string;
}

interface Draft {
  id: string | null;
  locked: boolean;
  routeCode: string;
  name: string;
  productId: string;
  steps: StepRow[];
}

const field = "sl-input h-11";
const cell = "sl-input h-10 text-sm";
let seqKey = 0;
const newKey = () => `s${++seqKey}`;

const blankStep = (uomIn = "KG"): StepRow => ({
  key: newKey(),
  name: "",
  mode: "JOB_WORK",
  defaultJobWorkerId: "",
  lossNormPct: "0",
  uomIn,
  uomOut: uomIn,
  conversionFactor: "",
});

const emptyDraft = (): Draft => ({
  id: null,
  locked: false,
  routeCode: "",
  name: "",
  productId: "",
  steps: [blankStep()],
});

const toInput = (s: StepRow): StepInput => ({
  name: s.name.trim(),
  mode: s.mode,
  defaultJobWorkerId: s.mode === "JOB_WORK" && s.defaultJobWorkerId ? s.defaultJobWorkerId : null,
  lossNormPct: Number(s.lossNormPct || 0),
  uomIn: s.uomIn.trim(),
  uomOut: s.uomOut.trim(),
  conversionFactor:
    s.conversionFactor.trim() && s.uomIn.trim().toUpperCase() !== s.uomOut.trim().toUpperCase()
      ? Number(s.conversionFactor)
      : null,
});

const Label: React.FC<{ htmlFor: string; children: React.ReactNode; required?: boolean }> = ({
  htmlFor,
  children,
  required,
}) => (
  <label htmlFor={htmlFor} className="sl-label">
    {children}
    {required && (
      <span className="sl-required" aria-hidden="true">
        *
      </span>
    )}
  </label>
);

const ProcessRoutesPage: React.FC = () => {
  const { can } = usePermission();
  const [rows, setRows] = useState<ProcessRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<RouteOptions | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await processRoutesService.listRoutes());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    processRoutesService
      .options()
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [load]);

  const filters: ToolbarFilter<Filter>[] = [
    { key: "ACTIVE", label: "Active", count: rows.filter((r) => r.active).length },
    { key: "INACTIVE", label: "Inactive", count: rows.filter((r) => !r.active).length },
    { key: "ALL", label: "All", count: rows.length },
  ];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "ACTIVE" && !r.active) return false;
      if (filter === "INACTIVE" && r.active) return false;
      if (!q) return true;
      return [r.routeCode, r.name, r.product?.name, ...r.steps.map((s) => s.name)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const edit = (r: ProcessRoute) =>
    setDraft({
      id: r.id,
      locked: r.locked,
      routeCode: r.routeCode,
      name: r.name,
      productId: r.product?.id ?? "",
      steps: r.steps.map((s) => ({
        key: newKey(),
        name: s.name,
        mode: s.mode,
        defaultJobWorkerId: s.defaultJobWorker?.id ?? "",
        lossNormPct: String(s.lossNormPct),
        uomIn: s.uomIn,
        uomOut: s.uomOut,
        conversionFactor: s.conversionFactor == null ? "" : String(s.conversionFactor),
      })),
    });

  const applyTemplate = (key: string) => {
    const t = options?.templates.find((x) => x.key === key);
    if (!t || !draft) return;
    setDraft({
      ...draft,
      name: draft.name || t.name,
      steps: t.steps.map((s) => ({
        key: newKey(),
        name: s.name,
        mode: s.mode,
        defaultJobWorkerId: "",
        lossNormPct: String(s.lossNormPct),
        uomIn: s.uomIn,
        uomOut: s.uomOut,
        conversionFactor: s.conversionFactor == null ? "" : String(s.conversionFactor),
      })),
    });
  };

  const setStep = (i: number, patch: Partial<StepRow>) =>
    setDraft((d) => {
      if (!d) return d;
      const steps = d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s));
      // Keep the unit chain: what leaves a step is what the next one takes in.
      if (patch.uomOut !== undefined && steps[i + 1]) {
        steps[i + 1] = { ...steps[i + 1], uomIn: patch.uomOut };
      }
      if (patch.mode === "IN_HOUSE") steps[i] = { ...steps[i], defaultJobWorkerId: "" };
      return { ...d, steps };
    });

  const moveStep = (i: number, by: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d;
      const steps = [...d.steps];
      const j = i + by;
      if (j < 0 || j >= steps.length) return d;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const steps = draft.steps.map(toInput);
      if (draft.id) {
        await processRoutesService.updateRoute(draft.id, {
          name: draft.name.trim(),
          productId: draft.productId || null,
        });
        if (!draft.locked) await processRoutesService.replaceSteps(draft.id, steps);
        toast.success("Route saved");
      } else {
        await processRoutesService.createRoute({
          routeCode: draft.routeCode.trim(),
          name: draft.name.trim(),
          productId: draft.productId || undefined,
          steps,
        });
        toast.success("Route created");
      }
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r: ProcessRoute) => {
    try {
      await processRoutesService.updateRoute(r.id, { active: !r.active });
      toast.success(r.active ? "Route deactivated" : "Route activated");
      await load();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const remove = async (r: ProcessRoute) => {
    if (!window.confirm(`Delete route ${r.routeCode}? It has never been used.`)) return;
    try {
      await processRoutesService.removeRoute(r.id);
      toast.success("Route deleted");
      await load();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const workers = options?.jobWorkers ?? [];

  return (
    <PageBody>
      <PageHeader
        title="Process routes"
        icon={<RouteIcon size={22} />}
        subtitle="The chain of processes each lot travels, in-house or at job workers, with a loss norm per step."
        actions={
          <Link to="/production/lots" className="sl-btn sl-pill-md">
            Lot board <ChevronRight size={16} />
          </Link>
        }
        primaryAction={
          can("process-routes.create") ? (
            draft ? (
              <ActionPill variant="secondary" icon={<X size={17} />} onClick={() => setDraft(null)}>
                Close
              </ActionPill>
            ) : (
              <ActionPill icon={<Plus size={18} />} onClick={() => setDraft(emptyDraft())}>
                New route
              </ActionPill>
            )
          ) : undefined
        }
      />

      {draft && (
        <Tile
          title={draft.id ? `Edit ${draft.routeCode}` : "New route"}
          subtitle={
            draft.locked
              ? "Lots already run on this route, so its steps are fixed. Create a new route to change them."
              : "Steps run in this order. The unit a step gives is the unit the next step takes."
          }
        >
          <form onSubmit={save} className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4">
              <div>
                <Label htmlFor="route-code" required>
                  Route code
                </Label>
                <input
                  id="route-code"
                  className={field}
                  value={draft.routeCode}
                  onChange={(e) => setDraft({ ...draft, routeCode: e.target.value })}
                  maxLength={30}
                  placeholder="KNIT-TEE"
                  disabled={!!draft.id}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="route-name" required>
                  Name
                </Label>
                <input
                  id="route-name"
                  className={field}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  maxLength={120}
                  placeholder="Knit tee: knitting → dyeing → printing → stitching"
                  required
                />
              </div>
              <div>
                <Label htmlFor="route-product">Product</Label>
                <select
                  id="route-product"
                  className={field}
                  value={draft.productId}
                  onChange={(e) => setDraft({ ...draft, productId: e.target.value })}
                >
                  <option value="">Any product</option>
                  {options?.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!draft.locked && (options?.templates.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="sl-section-label m-0">Start from</span>
                {options?.templates.map((t) => (
                  <Chip key={t.key} size="sm" onClick={() => applyTemplate(t.key)}>
                    {t.name}
                  </Chip>
                ))}
              </div>
            )}

            <datalist id="step-names">
              {options?.stepNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            <ol className="flex flex-col gap-3" aria-label="Route steps">
              {draft.steps.map((s, i) => {
                const unitChange = s.uomIn.trim().toUpperCase() !== s.uomOut.trim().toUpperCase();
                const id = (f: string) => `step-${s.key}-${f}`;
                return (
                  <li
                    key={s.key}
                    className="rounded-2xl border border-line-soft bg-card-2 p-3 sm:p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">Step {i + 1}</span>
                      {!draft.locked && (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            className="sl-btn-ghost sl-pill-sm"
                            aria-label={`Move step ${i + 1} up`}
                            disabled={i === 0}
                            onClick={() => moveStep(i, -1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            className="sl-btn-ghost sl-pill-sm"
                            aria-label={`Move step ${i + 1} down`}
                            disabled={i === draft.steps.length - 1}
                            onClick={() => moveStep(i, 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            type="button"
                            className="sl-btn-ghost sl-pill-sm"
                            aria-label={`Remove step ${i + 1}`}
                            disabled={draft.steps.length === 1}
                            onClick={() =>
                              setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </span>
                      )}
                    </div>
                    <fieldset
                      disabled={draft.locked}
                      className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-7"
                    >
                      <div className="col-span-2 md:col-span-2">
                        <Label htmlFor={id("name")} required>
                          Process
                        </Label>
                        <input
                          id={id("name")}
                          className={cell}
                          list="step-names"
                          value={s.name}
                          onChange={(e) => setStep(i, { name: e.target.value })}
                          maxLength={60}
                          placeholder="DYEING"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor={id("mode")}>Where</Label>
                        <select
                          id={id("mode")}
                          className={cell}
                          value={s.mode}
                          onChange={(e) => setStep(i, { mode: e.target.value as StepMode })}
                        >
                          <option value="JOB_WORK">Job worker</option>
                          <option value="IN_HOUSE">In-house</option>
                        </select>
                      </div>
                      <div className="col-span-1 md:col-span-2">
                        <Label htmlFor={id("worker")}>Default job worker</Label>
                        <select
                          id={id("worker")}
                          className={cell}
                          value={s.defaultJobWorkerId}
                          disabled={s.mode === "IN_HOUSE"}
                          onChange={(e) => setStep(i, { defaultJobWorkerId: e.target.value })}
                        >
                          <option value="">
                            {s.mode === "IN_HOUSE" ? "—" : "Pick when sending"}
                          </option>
                          {workers.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                              {w.processType ? ` · ${w.processType}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2 md:col-span-2">
                        <Label htmlFor={id("norm")}>Loss norm %</Label>
                        <input
                          id={id("norm")}
                          className={`${cell} tabular-nums`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="99.99"
                          step="any"
                          value={s.lossNormPct}
                          onChange={(e) => setStep(i, { lossNormPct: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor={id("in")} required>
                          Unit in
                        </Label>
                        <input
                          id={id("in")}
                          className={cell}
                          value={s.uomIn}
                          onChange={(e) => setStep(i, { uomIn: e.target.value.toUpperCase() })}
                          maxLength={20}
                          required
                          readOnly={i > 0}
                          title={i > 0 ? "Set by the previous step's unit out" : undefined}
                        />
                      </div>
                      <div>
                        <Label htmlFor={id("out")} required>
                          Unit out
                        </Label>
                        <input
                          id={id("out")}
                          className={cell}
                          value={s.uomOut}
                          onChange={(e) => setStep(i, { uomOut: e.target.value.toUpperCase() })}
                          maxLength={20}
                          required
                        />
                      </div>
                      <div className="col-span-2 md:col-span-2">
                        <Label htmlFor={id("factor")}>
                          {unitChange
                            ? `${s.uomOut || "Out"} per ${s.uomIn || "in"}`
                            : "Conversion"}
                        </Label>
                        <input
                          id={id("factor")}
                          className={`${cell} tabular-nums`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={unitChange ? s.conversionFactor : ""}
                          placeholder={unitChange ? "e.g. 4" : "Same unit"}
                          disabled={!unitChange}
                          onChange={(e) => setStep(i, { conversionFactor: e.target.value })}
                        />
                      </div>
                    </fieldset>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {!draft.locked ? (
                <ActionPill
                  variant="secondary"
                  icon={<Plus size={16} />}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      steps: [...draft.steps, blankStep(draft.steps.at(-1)?.uomOut || "KG")],
                    })
                  }
                  disabled={draft.steps.length >= 20}
                >
                  Add step
                </ActionPill>
              ) : (
                <span />
              )}
              <span className="flex gap-2.5">
                <ActionPill variant="secondary" onClick={() => setDraft(null)}>
                  Cancel
                </ActionPill>
                <ActionPill type="submit" icon={<Check size={17} />} disabled={saving}>
                  {draft.id ? "Save route" : "Create route"}
                </ActionPill>
              </span>
            </div>
          </form>
        </Tile>
      )}

      <Toolbar<Filter>
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search route, product or process…"
        searchLabel="Search routes"
        filters={filters}
        filterValue={filter}
        onFilterChange={setFilter}
        filtersLabel="Route status"
      />

      {loading ? (
        <Tile padding="none">
          <SkeletonRows rows={4} columns={4} />
        </Tile>
      ) : visible.length === 0 ? (
        <Tile>
          <EmptyState
            icon={<RouteIcon size={22} />}
            title={rows.length === 0 ? "No process routes yet." : "No routes match this filter."}
            description={
              rows.length === 0
                ? "Set up the chain once (knitting → dyeing → printing → stitching) and every lot follows it."
                : undefined
            }
            action={
              rows.length === 0 && can("process-routes.create") ? (
                <ActionPill icon={<Plus size={18} />} onClick={() => setDraft(emptyDraft())}>
                  New route
                </ActionPill>
              ) : undefined
            }
          />
        </Tile>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visible.map((r) => (
            <Tile
              key={r.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] text-accent">{r.routeCode}</span>
                  <span>{r.name}</span>
                </span>
              }
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" dot tone={r.active ? "success" : "muted"}>
                    {r.active ? "Active" : "Inactive"}
                  </Chip>
                  <span>
                    {r.lotCount} {r.lotCount === 1 ? "lot" : "lots"}
                  </span>
                  {r.product && <span>· {r.product.name}</span>}
                </span>
              }
              actions={
                <span className="flex gap-1.5">
                  {can("process-routes.edit") && (
                    <>
                      <ActionPill
                        variant="ghost"
                        size="sm"
                        icon={<Pencil size={14} />}
                        onClick={() => edit(r)}
                      >
                        Edit
                      </ActionPill>
                      <ActionPill variant="ghost" size="sm" onClick={() => void toggleActive(r)}>
                        {r.active ? "Deactivate" : "Activate"}
                      </ActionPill>
                    </>
                  )}
                  {can("process-routes.delete") && !r.locked && (
                    <ActionPill
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      aria-label={`Delete ${r.routeCode}`}
                      onClick={() => void remove(r)}
                    />
                  )}
                </span>
              }
            >
              <ol className="flex flex-col gap-2" aria-label={`${r.routeCode} steps`}>
                {r.steps.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-2 first:border-0 first:pt-0"
                  >
                    <span className="w-6 text-sm font-semibold tabular-nums text-ink-muted">
                      {s.seq}
                    </span>
                    <span className="min-w-[110px] font-medium text-ink">{stepLabel(s.name)}</span>
                    <ModeChip mode={s.mode} />
                    <span className="text-[13px] tabular-nums text-ink-muted">
                      {s.uomIn}
                      {s.uomOut !== s.uomIn
                        ? ` → ${s.uomOut}${s.conversionFactor ? ` ×${s.conversionFactor}` : ""}`
                        : ""}
                    </span>
                    <Chip size="sm" tone="muted">
                      Norm {pct(s.lossNormPct)}
                    </Chip>
                    {s.defaultJobWorker && (
                      <span className="text-[13px] text-ink-muted">{s.defaultJobWorker.name}</span>
                    )}
                  </li>
                ))}
              </ol>
            </Tile>
          ))}
        </div>
      )}
    </PageBody>
  );
};

export default ProcessRoutesPage;
