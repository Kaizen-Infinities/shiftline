import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Chip, EmptyState, LoadError, PageHeader, StaleNotice } from "../../../components/ui/v2";
import { Smartphone } from "lucide-react";

import CommonConfirmModal from "../../../components/ui/CommonConfirmModal/CommonConfirmModal";
import { deviceService } from "../../../services/deviceService";
import type { DeviceRow } from "../../../services/platformService";

/**
 * Field devices (P1-02 B1): the phones running the Shiftline field app for this company. Revoking
 * one signs it out everywhere and makes the app wipe its local database on its next call.
 */
const secondary = "sl-btn sl-pill-sm";
const danger = "sl-btn-soft-danger sl-pill-sm";
const th = "sl-th bg-card-2 px-3 py-2.5 text-left first:rounded-l-xl last:rounded-r-xl";
const td = "px-3 py-2.5 text-sm text-ink";
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const DevicesPage: React.FC = () => {
  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const [showRevokeModal, setShowRevokeModal] = useState(false);
  const [deviceToRevoke, setDeviceToRevoke] = useState<DeviceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await deviceService.list(true));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (d: DeviceRow, what: "revoke" | "restore") => {
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

  const triggerRevoke = (d: DeviceRow) => {
    setDeviceToRevoke(d);
    setShowRevokeModal(true);
  };

  const handleRevokeConfirm = async () => {
    if (deviceToRevoke) {
      await act(deviceToRevoke, "revoke");
      setShowRevokeModal(false);
      setDeviceToRevoke(null);
    }
  };

  const visible = rows.filter((r) => showRevoked || !r.revokedAt);
  return (
    <div className="sl-page">
      <PageHeader
        title="Field devices"
        icon={<Smartphone size={22} />}
        subtitle="Phones signed in to the field app. Revoke a lost phone: it is signed out at once and wipes itself the next time it connects."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "Field devices" }]}
        actions={
          <>
            <label className="sl-btn sl-pill-sm cursor-pointer">
              <input
                type="checkbox"
                className="sl-check"
                checked={showRevoked}
                onChange={(e) => setShowRevoked(e.target.checked)}
              />
              Show revoked
            </label>
          </>
        }
      />
      {loadFailed && rows.length > 0 && <StaleNotice onRetry={load} retrying={loading} />}
      <div className="sl-tile overflow-x-auto p-2 sm:p-3">
        {loadFailed && rows.length === 0 ? (
          <LoadError
            compact
            title="Couldn't load field devices"
            onRetry={load}
            retrying={loading}
          />
        ) : loading && rows.length === 0 ? (
          <div className="space-y-3 p-3" role="status" aria-label="Loading">
            <div className="sl-skeleton h-4 w-2/5" />
            <div className="sl-skeleton h-3 w-3/4" />
            <div className="sl-skeleton h-3 w-1/2" />
          </div>
        ) : (
          <table className="min-w-full">
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
            <tbody>
              {visible.map((d) => (
                <tr key={d.id} className="border-t border-line-soft">
                  <td className={td}>
                    {d.model ?? "Unknown"}
                    <div className="text-xs text-ink-muted">
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
                      <Chip tone="danger" size="sm" dot>
                        Revoked
                      </Chip>
                    ) : (
                      <Chip tone="success" size="sm" dot>
                        Active
                      </Chip>
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
                        onClick={() => triggerRevoke(d)}
                      >
                        Revoke and wipe
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      compact
                      icon={<Smartphone size={22} />}
                      title="No field devices yet."
                      description="They appear when an agent signs in to the app."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <CommonConfirmModal
        show={showRevokeModal}
        onHide={() => setShowRevokeModal(false)}
        onConfirm={handleRevokeConfirm}
        title="Revoke Device"
        message={
          deviceToRevoke
            ? `Revoke ${deviceToRevoke.model ?? deviceToRevoke.deviceId} used by ${deviceToRevoke.agentName}? The app signs out and wipes its data.`
            : ""
        }
        confirmText={busy === deviceToRevoke?.id ? "Revoking..." : "Revoke"}
        confirmVariant="danger"
        isDangerous={true}
      />
    </div>
  );
};

export default DevicesPage;
