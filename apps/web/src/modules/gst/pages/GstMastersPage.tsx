import { Percent } from "lucide-react";
import { ChipTabs, PageHeader } from "../../../components/ui/v2";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
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

const input = "sl-input h-11 py-0 text-sm";
const primary = "sl-btn-blue sl-pill-sm";
const secondary = "sl-btn sl-pill-sm";
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<HsnCode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const triggerRemoveHsn = (h: HsnCode) => {
    setItemToDelete(h);
    setShowDeleteModal(true);
  };

  const handleRemoveConfirm = async () => {
    if (!itemToDelete || isDeleting) return;
    const h = itemToDelete;
    const inUse = (h._count?.products ?? 0) + (h._count?.rawMaterials ?? 0);
    setIsDeleting(true);
    try {
      await gstService.removeHsn(h.id);
      toast.success(inUse > 0 ? `${h.code} deactivated` : `${h.code} removed`);
      await loadCodes();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setShowDeleteModal(false);
      setItemToDelete(null);
      setIsDeleting(false);
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

  const itemToDeleteInUse = itemToDelete
    ? (itemToDelete._count?.products ?? 0) + (itemToDelete._count?.rawMaterials ?? 0)
    : 0;

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <PageHeader
          title="GST rates and HSN/SAC codes"
          icon={<Percent size={22} />}
          subtitle="Every product and raw material takes its GST rate from its HSN or SAC code unless it carries an override. Rates here are your starting point; they change by notification."
          breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "GST masters" }]}
        >
          <ChipTabs<Tab>
            ariaLabel="GST masters"
            value={tab}
            onChange={setTab}
            size="lg"
            items={[
              { key: "hsn", label: "HSN / SAC codes" },
              { key: "slabs", label: "GST slabs" },
            ]}
          />
        </PageHeader>
        <div className="sl-tile">
          {tab === "hsn" && (
            <div className="p-4 sm:p-6">
              <div className="flex flex-wrap items-end gap-3">
                <label className="block flex-1 min-w-[220px] ">
                  <span className="sl-label">Search code or description</span>
                  <input
                    className={input}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="3923, packaging, 9988…"
                  />
                </label>
                <label className="block ">
                  <span className="sl-label">Type</span>
                  <select
                    className={input}
                    value={type}
                    onChange={(e) => setType(e.target.value as "" | "HSN" | "SAC")}
                  >
                    <option value="">All</option>
                    <option value="HSN">HSN (goods)</option>
                    <option value="SAC">SAC (services)</option>
                  </select>
                </label>
                <label className="sl-btn sl-pill-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="sl-check"
                    checked={showInactive}
                    onChange={(e) => setShowInactive(e.target.checked)}
                  />
                  Show inactive
                </label>
                {can("gst_tax.create") && (
                  <button
                    type="button"
                    className="sl-cta sl-pill-md"
                    onClick={() => setHsnForm({ ...emptyHsn })}
                  >
                    Add code
                  </button>
                )}
              </div>

              {hsnForm && (
                <form
                  onSubmit={saveHsn}
                  className="mt-4 grid gap-3 rounded-[16px] bg-card-2 p-4 md:grid-cols-6"
                >
                  <label className="block ">
                    <span className="sl-label">Code</span>
                    <input
                      className={`${input} font-mono`}
                      value={hsnForm.code}
                      onChange={(e) =>
                        setHsnForm({
                          ...hsnForm,
                          code: e.target.value.replace(/\D/g, "").slice(0, 8),
                        })
                      }
                      required
                      pattern="\d{4,8}"
                      title="4 to 8 digits"
                      disabled={Boolean(hsnForm.id)}
                      aria-label="HSN code"
                    />
                  </label>
                  <label className="block ">
                    <span className="sl-label">Type</span>
                    <select
                      className={input}
                      value={hsnForm.type}
                      onChange={(e) =>
                        setHsnForm({ ...hsnForm, type: e.target.value as "HSN" | "SAC" })
                      }
                    >
                      <option value="HSN">HSN</option>
                      <option value="SAC">SAC</option>
                    </select>
                  </label>
                  <label className="block md:col-span-2">
                    <span className="sl-label">Description</span>
                    <input
                      className={input}
                      value={hsnForm.description}
                      onChange={(e) => setHsnForm({ ...hsnForm, description: e.target.value })}
                      required
                      maxLength={255}
                      aria-label="HSN description"
                    />
                  </label>
                  <label className="block ">
                    <span className="sl-label">GST %</span>
                    <select
                      className={input}
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
                  <label className="block ">
                    <span className="sl-label">Cess %</span>
                    <input
                      className={input}
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

              <div className="mt-4 overflow-x-auto rounded-[14px] border border-line-soft">
                <table className="w-full text-left text-sm">
                  <thead className="bg-card-2">
                    <tr>
                      <th className="sl-th px-3 py-2.5">Code</th>
                      <th className="sl-th px-3 py-2.5">Type</th>
                      <th className="sl-th px-3 py-2.5">Description</th>
                      <th className="sl-th px-3 py-2.5 text-right">GST</th>
                      <th className="sl-th px-3 py-2.5 text-right">Cess</th>
                      <th className="sl-th px-3 py-2.5 text-right">In use</th>
                      <th className="sl-th px-3 py-2.5">Status</th>
                      <th className="sl-th px-3 py-2.5 text-right">Actions</th>
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
                            <td className="px-3 py-2.5 font-mono font-semibold text-ink">
                              {h.code}
                            </td>
                            <td className="px-3 py-2.5 text-ink-muted">{h.type}</td>
                            <td className="px-3 py-2.5 text-ink">{h.description}</td>
                            <td className="px-3 py-2.5 text-right text-ink">{pct(h.gstRate)}</td>
                            <td className="px-3 py-2.5 text-right text-ink-muted">
                              {pct(h.cessRate)}
                            </td>
                            <td className="px-3 py-2.5 text-right text-ink-muted">
                              {inUse || "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                  h.isActive
                                    ? "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]"
                                    : "bg-card-2 text-ink-subtle"
                                }`}
                              >
                                {h.isActive ? "Active" : "Inactive"}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              {can("gst_tax.edit") && (
                                <button
                                  type="button"
                                  className="sl-btn sl-pill-sm"
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
                                  className="sl-btn-soft-danger sl-pill-sm ml-2"
                                  onClick={() => triggerRemoveHsn(h)}
                                >
                                  {inUse ? "Deactivate" : "Remove"}
                                </button>
                              )}
                              {can("gst_tax.edit") && !h.isActive && (
                                <button
                                  type="button"
                                  className="sl-btn sl-pill-sm ml-2"
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
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-ink-muted">
                  The statutory slabs (0, 0.25, 3, 5, 12, 18, 28) are seeded; add a slab only when a
                  notification introduces one.
                </p>
                {can("gst_tax.create") && (
                  <button
                    type="button"
                    className="sl-cta sl-pill-md"
                    onClick={() => setSlabForm({ name: "", rate: 0, cessRate: 0 })}
                  >
                    Add slab
                  </button>
                )}
              </div>

              {slabForm && (
                <form
                  onSubmit={saveSlab}
                  className="mt-4 grid gap-3 rounded-[16px] bg-card-2 p-4 md:grid-cols-4"
                >
                  <label className="block ">
                    <span className="sl-label">Name</span>
                    <input
                      className={input}
                      value={slabForm.name}
                      onChange={(e) => setSlabForm({ ...slabForm, name: e.target.value })}
                      required
                      maxLength={40}
                      placeholder="GST 18%"
                    />
                  </label>
                  <label className="block ">
                    <span className="sl-label">Rate %</span>
                    <input
                      className={input}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={slabForm.rate}
                      onChange={(e) => setSlabForm({ ...slabForm, rate: Number(e.target.value) })}
                      required
                    />
                  </label>
                  <label className="block ">
                    <span className="sl-label">Cess %</span>
                    <input
                      className={input}
                      type="number"
                      min={0}
                      max={300}
                      step="0.01"
                      value={slabForm.cessRate}
                      onChange={(e) =>
                        setSlabForm({ ...slabForm, cessRate: Number(e.target.value) })
                      }
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

              <div className="mt-4 overflow-x-auto rounded-[14px] border border-line-soft">
                <table className="w-full text-left text-sm">
                  <thead className="bg-card-2">
                    <tr>
                      <th className="sl-th px-3 py-2.5">Name</th>
                      <th className="sl-th px-3 py-2.5 text-right">Rate</th>
                      <th className="sl-th px-3 py-2.5 text-right">Cess</th>
                      <th className="sl-th px-3 py-2.5">Status</th>
                      <th className="sl-th px-3 py-2.5 text-right">Actions</th>
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
                          <td className="px-3 py-2.5 font-semibold text-ink">{s.name}</td>
                          <td className="px-3 py-2.5 text-right text-ink">{pct(s.rate)}</td>
                          <td className="px-3 py-2.5 text-right text-ink-muted">
                            {pct(s.cessRate)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                s.isActive
                                  ? "bg-[color:var(--color-success)]/10 text-[color:var(--color-success)]"
                                  : "bg-card-2 text-ink-subtle"
                              }`}
                            >
                              {s.isActive ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {can("gst_tax.edit") && (
                              <button
                                type="button"
                                className="sl-btn sl-pill-sm"
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
                                className={`${s.isActive ? "sl-btn-soft-danger" : "sl-btn"} sl-pill-sm ml-2`}
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
      </div>

      <CommonConfirmModal
        show={showDeleteModal}
        onHide={() => {
          setShowDeleteModal(false);
          setItemToDelete(null);
        }}
        onConfirm={handleRemoveConfirm}
        title={itemToDeleteInUse ? "Confirm Deactivate" : "Confirm Remove"}
        message={
          itemToDelete
            ? itemToDeleteInUse
              ? `${itemToDelete.code} is used by ${itemToDeleteInUse} item${itemToDeleteInUse === 1 ? "" : "s"}; it will be deactivated, not removed.`
              : `Are you sure you want to remove ${itemToDelete.code}? This action cannot be undone.`
            : ""
        }
        confirmText={isDeleting ? "Processing..." : itemToDeleteInUse ? "Deactivate" : "Remove"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </>
  );
};

export default GstMastersPage;
