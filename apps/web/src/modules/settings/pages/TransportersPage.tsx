import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Chip, EmptyState, PageHeader, Tile } from "../../../components/ui/v2";
import { Truck } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import { transporterService, type TransporterRow } from "../../../services/ewayBillService";

/** Transporter master (P1-12): the carriers that go on e-way bills. Retired, never deleted. */
const secondary = "sl-btn sl-pill-sm";
const th = "sl-th bg-card-2 px-3 py-2.5 text-left first:rounded-l-xl last:rounded-r-xl";
const td = "px-3 py-2.5 text-sm text-ink";
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
    <div className="sl-page">
      <PageHeader
        title="Transporters"
        icon={<Truck size={22} />}
        subtitle="Carriers that appear on e-way bills. A transporter id (GSTIN or 15-character TRANSIN) lets the carrier fill Part B on the portal."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "Transporters" }]}
      />
      {can(editing ? "transporters.edit" : "transporters.create") && (
        <Tile title={editing ? "Edit transporter" : "Add a transporter"} icon={<Truck size={18} />}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="sl-label">Code</span>
              <input
                className="sl-input h-11 py-0 text-sm"
                placeholder="Code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="block">
              <span className="sl-label">Name</span>
              <input
                className="sl-input h-11 py-0 text-sm"
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="sl-label">Transporter id</span>
              <input
                className="sl-input h-11 py-0 text-sm"
                placeholder="Transporter id (GSTIN / TRANSIN)"
                value={form.transporterId}
                onChange={(e) => setForm({ ...form, transporterId: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="block">
              <span className="sl-label">Phone</span>
              <input
                className="sl-input h-11 py-0 text-sm"
                placeholder="Phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="sl-label">Email</span>
              <input
                className="sl-input h-11 py-0 text-sm"
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                className="sl-cta sl-pill-md"
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
        </Tile>
      )}
      <label className="sl-btn sl-pill-sm w-fit cursor-pointer">
        <input
          type="checkbox"
          className="sl-check"
          checked={showRetired}
          onChange={(e) => setShowRetired(e.target.checked)}
        />{" "}
        Show retired
      </label>
      <div className="sl-tile overflow-x-auto p-2 sm:p-3">
        <table className="min-w-full">
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
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line-soft">
                <td className={`${td} font-mono text-xs`}>{r.code}</td>
                <td className={td}>{r.name}</td>
                <td className={`${td} font-mono text-xs`}>{r.transporterId ?? "—"}</td>
                <td className={td}>{r.phone ?? "—"}</td>
                <td className={td}>
                  <Chip tone={r.isActive ? "success" : "muted"} size="sm" dot>
                    {r.isActive ? "Active" : "Retired"}
                  </Chip>
                </td>
                <td className={`${td} text-right`}>
                  {r.isActive && can("transporters.edit") && (
                    <button
                      type="button"
                      className="sl-btn sl-pill-sm mr-2"
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
                      className="sl-btn-soft-danger sl-pill-sm"
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
                <td colSpan={6}>
                  <EmptyState compact icon={<Truck size={22} />} title="No transporters yet." />
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
