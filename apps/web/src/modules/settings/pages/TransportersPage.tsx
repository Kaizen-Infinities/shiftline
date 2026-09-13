import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { transporterService, type TransporterRow } from "../../../services/ewayBillService";

/** Transporter master (P1-12): the carriers that go on e-way bills. Retired, never deleted. */
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-accent text-white hover:brightness-110`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const field = "rounded-lg border border-line-soft bg-card-2 px-3 py-1.5 text-sm text-ink";
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-1.5 text-sm text-ink";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";
const empty = { code: "", name: "", transporterId: "", phone: "", email: "" };

const TransportersPage: React.FC = () => {
  const { can } = usePermission();
  const [rows, setRows] = useState<TransporterRow[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [showRetired, setShowRetired] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await transporterService.list(showRetired));
    } catch (err) {
      toast.error(message(err));
    }
  }, [showRetired]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const input = {
        ...form,
        transporterId: form.transporterId || null,
        phone: form.phone || null,
        email: form.email || null,
      };
      if (editing) await transporterService.update(editing, input);
      else await transporterService.create(input);
      toast.success(editing ? "Transporter updated" : "Transporter added");
      setForm(empty);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };
  const retire = async (id: string) => {
    try {
      await transporterService.retire(id);
      toast.success("Transporter retired");
      await load();
    } catch (err) {
      toast.error(message(err));
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">Transporters</h2>
        <p className="text-sm text-ink-muted">
          Carriers that appear on e-way bills. A transporter id (GSTIN or 15-character TRANSIN) lets
          the carrier fill Part B on the portal.
        </p>
      </div>
      {can(editing ? "transporters.edit" : "transporters.create") && (
        <div className="grid gap-2 rounded-lg border border-line-soft bg-card p-3 sm:grid-cols-3">
          <input
            className={field}
            placeholder="Code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
          <input
            className={field}
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className={field}
            placeholder="Transporter id (GSTIN / TRANSIN)"
            value={form.transporterId}
            onChange={(e) => setForm({ ...form, transporterId: e.target.value.toUpperCase() })}
          />
          <input
            className={field}
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className={field}
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy || !form.code || !form.name}
              onClick={save}
            >
              {editing ? "Save" : "Add transporter"}
            </button>
            {editing && (
              <button
                type="button"
                className={secondary}
                onClick={() => {
                  setEditing(null);
                  setForm(empty);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      <label className="flex items-center gap-1 text-sm text-ink">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={(e) => setShowRetired(e.target.checked)}
        />{" "}
        Show retired
      </label>
      <div className="overflow-x-auto rounded-lg border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Code</th>
              <th className={th}>Name</th>
              <th className={th}>Transporter id</th>
              <th className={th}>Phone</th>
              <th className={th}>Status</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} font-mono text-xs`}>{r.code}</td>
                <td className={td}>{r.name}</td>
                <td className={`${td} font-mono text-xs`}>{r.transporterId ?? "—"}</td>
                <td className={td}>{r.phone ?? "—"}</td>
                <td className={td}>{r.isActive ? "Active" : "Retired"}</td>
                <td className={`${td} text-right`}>
                  {r.isActive && can("transporters.edit") && (
                    <button
                      type="button"
                      className="mr-3 text-sm font-semibold text-accent hover:underline"
                      onClick={() => {
                        setEditing(r.id);
                        setForm({
                          code: r.code,
                          name: r.name,
                          transporterId: r.transporterId ?? "",
                          phone: r.phone ?? "",
                          email: r.email ?? "",
                        });
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {r.isActive && can("transporters.delete") && (
                    <button
                      type="button"
                      className="text-sm font-semibold text-[color:var(--color-danger)] hover:underline"
                      onClick={() => retire(r.id)}
                    >
                      Retire
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={6}>
                  No transporters yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TransportersPage;
