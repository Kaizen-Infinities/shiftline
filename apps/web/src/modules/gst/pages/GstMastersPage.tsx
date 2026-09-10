import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  gstService,
  type GstSlab,
  type HsnCode,
  type HsnInput,
} from "../../../services/gstService";

/**
 * GST masters (P1-08): the tenant's HSN/SAC codes with their default rates, and the
 * slabs those rates come from. Codes in use by products or materials are only
 * deactivated, never removed.
 */
type Tab = "hsn" | "slabs";

const input =
  "w-full rounded-lg border border-line-soft bg-card px-3 py-2 text-sm text-ink outline-none focus:border-blue-500";
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition";
const primary = `${btn} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const pct = (v: string | number) => `${Number(v)}%`;
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const emptyHsn: HsnInput = { code: "", type: "HSN", description: "", gstRate: 18, cessRate: 0 };

const GstMastersPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<Tab>("hsn");

  // ── HSN / SAC ─────────────────────────────────────────────────────────────
  const [codes, setCodes] = useState<HsnCode[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"" | "HSN" | "SAC">("");
  const [showInactive, setShowInactive] = useState(false);
  const [loadingCodes, setLoadingCodes] = useState(true);
  const [hsnForm, setHsnForm] = useState<(HsnInput & { id?: string }) | null>(null);

  const loadCodes = useCallback(async () => {
    setLoadingCodes(true);
    try {
      setCodes(
        await gstService.listHsn({
          search: search.trim() || undefined,
          type: type || undefined,
          includeInactive: showInactive,
          limit: 500,
        })
      );
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoadingCodes(false);
    }
  }, [search, type, showInactive]);

  useEffect(() => {
    const t = setTimeout(() => void loadCodes(), 250);
    return () => clearTimeout(t);
  }, [loadCodes]);

  const saveHsn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hsnForm) return;
    try {
      const body: HsnInput = {
        code: hsnForm.code.trim(),
        type: hsnForm.type,
        description: hsnForm.description.trim(),
        gstRate: Number(hsnForm.gstRate),
        cessRate: Number(hsnForm.cessRate ?? 0),
      };
      if (hsnForm.id) {
        await gstService.updateHsn(hsnForm.id, body);
        toast.success(`${body.code} updated`);
      } else {
        await gstService.createHsn(body);
        toast.success(`${body.code} added`);
      }
      setHsnForm(null);
      await loadCodes();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const removeHsn = async (h: HsnCode) => {
    const inUse = (h._count?.products ?? 0) + (h._count?.rawMaterials ?? 0);
    const question = inUse
      ? `${h.code} is used by ${inUse} item${inUse === 1 ? "" : "s"}; it will be deactivated, not removed. Continue?`
      : `Remove ${h.code}?`;
    if (!window.confirm(question)) return;
    try {
      await gstService.removeHsn(h.id);
      toast.success(inUse > 0 ? `${h.code} deactivated` : `${h.code} removed`);
      await loadCodes();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const reactivateHsn = async (h: HsnCode) => {
    try {
      await gstService.updateHsn(h.id, { isActive: true });
      await loadCodes();
    } catch (err) {
      toast.error(message(err));
    }
  };

  // ── Slabs ─────────────────────────────────────────────────────────────────
  const [slabs, setSlabs] = useState<GstSlab[]>([]);
  const [loadingSlabs, setLoadingSlabs] = useState(true);
  const [slabForm, setSlabForm] = useState<{
    id?: string;
    name: string;
    rate: number;
    cessRate: number;
  } | null>(null);

  const loadSlabs = useCallback(async () => {
    setLoadingSlabs(true);
    try {
      setSlabs(await gstService.listRates(true));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoadingSlabs(false);
    }
  }, []);

  useEffect(() => {
    void loadSlabs();
  }, [loadSlabs]);

  const saveSlab = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slabForm) return;
    try {
      const body = {
        name: slabForm.name.trim(),
        rate: Number(slabForm.rate),
        cessRate: Number(slabForm.cessRate),
      };
      if (slabForm.id) await gstService.updateRate(slabForm.id, body);
      else await gstService.createRate(body);
      toast.success(`Slab ${body.name} saved`);
      setSlabForm(null);
      await loadSlabs();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const toggleSlab = async (s: GstSlab) => {
    try {
      if (s.isActive) await gstService.deactivateRate(s.id);
      else await gstService.updateRate(s.id, { isActive: true });
      await loadSlabs();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const activeSlabRates = useMemo(
    () => slabs.filter((s) => s.isActive).map((s) => Number(s.rate)),
    [slabs]
  );

  return (
    <div className="mx-auto max-w-6xl rounded-2xl border border-line bg-card shadow-sm">
      <div className="border-b border-line p-6">
        <h2 className="text-2xl font-bold text-ink">GST rates and HSN/SAC codes</h2>
        <p className="mt-1 text-sm text-ink-subtle">
          Every product and raw material takes its GST rate from its HSN or SAC code unless it
          carries an override. Rates here are your starting point; they change by notification.
        </p>
        <div className="mt-4 flex gap-2" role="tablist">
          {(
            [
              ["hsn", "HSN / SAC codes"],
              ["slabs", "GST slabs"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`${btn} ${tab === key ? "bg-blue-600 text-white" : "border border-line-soft text-ink hover:bg-card-2"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "hsn" && (
        <div className="p-6">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex-1 min-w-[220px] text-xs font-semibold text-ink-muted">
              Search code or description
              <input
                className={`${input} mt-1`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="3923, packaging, 9988…"
              />
            </label>
            <label className="text-xs font-semibold text-ink-muted">
              Type
              <select
                className={`${input} mt-1`}
                value={type}
                onChange={(e) => setType(e.target.value as "" | "HSN" | "SAC")}
              >
                <option value="">All</option>
                <option value="HSN">HSN (goods)</option>
                <option value="SAC">SAC (services)</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pb-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
            {can("gst_tax.create") && (
              <button type="button" className={primary} onClick={() => setHsnForm({ ...emptyHsn })}>
                + Add code
              </button>
            )}
          </div>

          {hsnForm && (
            <form
              onSubmit={saveHsn}
              className="mt-4 grid gap-3 rounded-xl border border-line-soft bg-card-2/60 p-4 md:grid-cols-6"
            >
              <label className="text-xs font-semibold text-ink-muted">
                Code
                <input
                  className={`${input} mt-1 font-mono`}
                  value={hsnForm.code}
                  onChange={(e) =>
                    setHsnForm({ ...hsnForm, code: e.target.value.replace(/\D/g, "").slice(0, 8) })
                  }
                  required
                  pattern="\d{4,8}"
                  title="4 to 8 digits"
                  disabled={Boolean(hsnForm.id)}
                  aria-label="HSN code"
                />
              </label>
              <label className="text-xs font-semibold text-ink-muted">
                Type
                <select
                  className={`${input} mt-1`}
                  value={hsnForm.type}
                  onChange={(e) =>
                    setHsnForm({ ...hsnForm, type: e.target.value as "HSN" | "SAC" })
                  }
                >
                  <option value="HSN">HSN</option>
                  <option value="SAC">SAC</option>
                </select>
              </label>
              <label className="text-xs font-semibold text-ink-muted md:col-span-2">
                Description
                <input
                  className={`${input} mt-1`}
                  value={hsnForm.description}
                  onChange={(e) => setHsnForm({ ...hsnForm, description: e.target.value })}
                  required
                  maxLength={255}
                  aria-label="HSN description"
                />
              </label>
              <label className="text-xs font-semibold text-ink-muted">
                GST %
                <select
                  className={`${input} mt-1`}
                  value={String(hsnForm.gstRate)}
                  onChange={(e) => setHsnForm({ ...hsnForm, gstRate: Number(e.target.value) })}
                >
                  {(activeSlabRates.includes(Number(hsnForm.gstRate))
                    ? activeSlabRates
                    : [...activeSlabRates, Number(hsnForm.gstRate)]
                  )
                    .sort((a, b) => a - b)
                    .map((r) => (
                      <option key={r} value={String(r)}>
                        {r}%
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-semibold text-ink-muted">
                Cess %
                <input
                  className={`${input} mt-1`}
                  type="number"
                  min={0}
                  max={300}
                  step="0.01"
                  value={hsnForm.cessRate ?? 0}
                  onChange={(e) => setHsnForm({ ...hsnForm, cessRate: Number(e.target.value) })}
                />
              </label>
              <div className="flex items-center gap-2 md:col-span-6">
                <button type="submit" className={primary}>
                  {hsnForm.id ? "Save changes" : "Add code"}
                </button>
                <button type="button" className={secondary} onClick={() => setHsnForm(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="mt-4 overflow-x-auto rounded-xl border border-line-soft">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-2 text-[11px] uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">GST</th>
                  <th className="px-3 py-2 text-right">Cess</th>
                  <th className="px-3 py-2 text-right">In use</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {loadingCodes ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-ink-subtle">
                      Loading…
                    </td>
                  </tr>
                ) : codes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-ink-subtle">
                      No codes match.
                    </td>
                  </tr>
                ) : (
                  codes.map((h) => {
                    const inUse = (h._count?.products ?? 0) + (h._count?.rawMaterials ?? 0);
                    return (
                      <tr key={h.id} className={h.isActive ? "" : "opacity-60"}>
                        <td className="px-3 py-2 font-mono font-semibold text-ink">{h.code}</td>
                        <td className="px-3 py-2 text-ink-muted">{h.type}</td>
                        <td className="px-3 py-2 text-ink">{h.description}</td>
                        <td className="px-3 py-2 text-right text-ink">{pct(h.gstRate)}</td>
                        <td className="px-3 py-2 text-right text-ink-muted">{pct(h.cessRate)}</td>
                        <td className="px-3 py-2 text-right text-ink-muted">{inUse || "—"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              h.isActive
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-slate-500/10 text-slate-500"
                            }`}
                          >
                            {h.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {can("gst_tax.edit") && (
                            <button
                              type="button"
                              className="text-xs font-semibold text-blue-600 hover:underline"
                              onClick={() =>
                                setHsnForm({
                                  id: h.id,
                                  code: h.code,
                                  type: h.type,
                                  description: h.description,
                                  gstRate: Number(h.gstRate),
                                  cessRate: Number(h.cessRate),
                                })
                              }
                            >
                              Edit
                            </button>
                          )}
                          {can("gst_tax.delete") && h.isActive && (
                            <button
                              type="button"
                              className="ml-3 text-xs font-semibold text-red-500 hover:underline"
                              onClick={() => void removeHsn(h)}
                            >
                              {inUse ? "Deactivate" : "Remove"}
                            </button>
                          )}
                          {can("gst_tax.edit") && !h.isActive && (
                            <button
                              type="button"
                              className="ml-3 text-xs font-semibold text-emerald-600 hover:underline"
                              onClick={() => void reactivateHsn(h)}
                            >
                              Reactivate
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "slabs" && (
        <div className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-muted">
              The statutory slabs (0, 0.25, 3, 5, 12, 18, 28) are seeded; add a slab only when a
              notification introduces one.
            </p>
            {can("gst_tax.create") && (
              <button
                type="button"
                className={primary}
                onClick={() => setSlabForm({ name: "", rate: 0, cessRate: 0 })}
              >
                + Add slab
              </button>
            )}
          </div>

          {slabForm && (
            <form
              onSubmit={saveSlab}
              className="mt-4 grid gap-3 rounded-xl border border-line-soft bg-card-2/60 p-4 md:grid-cols-4"
            >
              <label className="text-xs font-semibold text-ink-muted">
                Name
                <input
                  className={`${input} mt-1`}
                  value={slabForm.name}
                  onChange={(e) => setSlabForm({ ...slabForm, name: e.target.value })}
                  required
                  maxLength={40}
                  placeholder="GST 18%"
                />
              </label>
              <label className="text-xs font-semibold text-ink-muted">
                Rate %
                <input
                  className={`${input} mt-1`}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={slabForm.rate}
                  onChange={(e) => setSlabForm({ ...slabForm, rate: Number(e.target.value) })}
                  required
                />
              </label>
              <label className="text-xs font-semibold text-ink-muted">
                Cess %
                <input
                  className={`${input} mt-1`}
                  type="number"
                  min={0}
                  max={300}
                  step="0.01"
                  value={slabForm.cessRate}
                  onChange={(e) => setSlabForm({ ...slabForm, cessRate: Number(e.target.value) })}
                />
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" className={primary}>
                  Save
                </button>
                <button type="button" className={secondary} onClick={() => setSlabForm(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="mt-4 overflow-x-auto rounded-xl border border-line-soft">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-2 text-[11px] uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 text-right">Cess</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {loadingSlabs ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-ink-subtle">
                      Loading…
                    </td>
                  </tr>
                ) : (
                  slabs.map((s) => (
                    <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                      <td className="px-3 py-2 font-semibold text-ink">{s.name}</td>
                      <td className="px-3 py-2 text-right text-ink">{pct(s.rate)}</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{pct(s.cessRate)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            s.isActive
                              ? "bg-emerald-500/10 text-emerald-600"
                              : "bg-slate-500/10 text-slate-500"
                          }`}
                        >
                          {s.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {can("gst_tax.edit") && (
                          <button
                            type="button"
                            className="text-xs font-semibold text-blue-600 hover:underline"
                            onClick={() =>
                              setSlabForm({
                                id: s.id,
                                name: s.name,
                                rate: Number(s.rate),
                                cessRate: Number(s.cessRate),
                              })
                            }
                          >
                            Edit
                          </button>
                        )}
                        {can(s.isActive ? "gst_tax.delete" : "gst_tax.edit") && (
                          <button
                            type="button"
                            className={`ml-3 text-xs font-semibold hover:underline ${s.isActive ? "text-red-500" : "text-emerald-600"}`}
                            onClick={() => void toggleSlab(s)}
                          >
                            {s.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default GstMastersPage;
