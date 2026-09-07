import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { deviceService } from "../../../services/deviceService";
import type { DeviceRow } from "../../../services/platformService";

/**
 * Field devices (P1-02 B1): the phones running the Shiftline field app for this company. Revoking
 * one signs it out everywhere and makes the app wipe its local database on its next call.
 */
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const danger = `${btn} border border-rose-300 text-rose-700 hover:bg-rose-50`;
const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted";
const td = "px-3 py-1.5 text-sm text-ink";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const DevicesPage: React.FC = () => {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [showRevoked, setShowRevoked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await deviceService.list(true));
    } catch (err) {
      toast.error(message(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (d: DeviceRow, what: "revoke" | "restore") => {
    if (
      what === "revoke" &&
      !window.confirm(
        `Revoke ${d.model ?? d.deviceId} used by ${d.agentName}? The app signs out and wipes its data.`
      )
    )
      return;
    setBusy(d.id);
    try {
      await (what === "revoke" ? deviceService.revoke(d.id) : deviceService.restore(d.id));
      toast.success(what === "revoke" ? "Device revoked" : "Device restored");
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(null);
    }
  };

  const visible = rows.filter((r) => showRevoked || !r.revokedAt);
  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-ink">Field Devices</h2>
          <p className="text-sm text-ink-muted">
            Phones signed in to the field app. Revoke a lost phone: it is signed out at once and
            wipes itself the next time it connects.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={showRevoked}
            onChange={(e) => setShowRevoked(e.target.checked)}
          />
          Show revoked
        </label>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line-soft bg-card">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Device</th>
              <th className={th}>Agent</th>
              <th className={th}>App</th>
              <th className={th}>First seen</th>
              <th className={th}>Last seen</th>
              <th className={th}>Last sync</th>
              <th className={th}>State</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {visible.map((d) => (
              <tr key={d.id}>
                <td className={td}>
                  {d.model ?? "Unknown"}
                  <div className="text-xs text-ink-subtle">
                    {d.platform ?? "?"} · {d.deviceId}
                  </div>
                </td>
                <td className={td}>
                  {d.agentName} <span className="text-xs text-ink-subtle">{d.agentUsername}</span>
                </td>
                <td className={td}>{d.appVersion ?? "—"}</td>
                <td className={td}>{when(d.firstSeenAt)}</td>
                <td className={td}>{when(d.lastSeenAt)}</td>
                <td className={td}>{when(d.lastSyncAt)}</td>
                <td className={td}>
                  {d.revokedAt ? (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800">
                      REVOKED
                    </span>
                  ) : (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                      ACTIVE
                    </span>
                  )}
                </td>
                <td className={td}>
                  {d.revokedAt ? (
                    <button
                      type="button"
                      className={secondary}
                      disabled={busy === d.id}
                      onClick={() => act(d, "restore")}
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={danger}
                      disabled={busy === d.id}
                      onClick={() => act(d, "revoke")}
                    >
                      Revoke and wipe
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={8}>
                  No field devices yet. They appear when an agent signs in to the app.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DevicesPage;
