import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { PageHeader } from "../../../components/ui/v2";
import { Cpu } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import { machineService } from "../../../services/machineService";
import {
  machineGatewayService,
  machineTelemetryReadService,
  type CanonicalSignalRef,
  type GatewayAdapterKind,
  type MachineGatewayRow,
  type SignalMapRow,
} from "../../../services/machineTelemetryService";

/**
 * Machine gateways (P2-01): the gateway list, a live test-connection panel and the per-gateway
 * signal-map editor. Every gateway here can be pointed at SIMULATOR -- the only adapter that has
 * ever met a real device -- so a tenant can configure and rehearse the whole flow before a press
 * is connected. OPCUA_EUROMAP77, EUROMAP63_FILE and MODBUS_MQTT are written but unpinned; picking
 * one is allowed, but "Test connection" will honestly refuse until that adapter is.
 */
const primary = "sl-btn-blue sl-pill-sm";
const secondary = "sl-btn sl-pill-sm";
const danger = "sl-btn-soft-danger sl-pill-sm";
const field = "sl-input h-10 w-auto max-w-full py-0 text-sm";
const th = "sl-th bg-card-2 px-3 py-2.5 text-left first:rounded-l-xl last:rounded-r-xl";
const td = "px-3 py-2.5 text-sm text-ink align-top";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

const ADAPTER_KINDS: GatewayAdapterKind[] = [
  "SIMULATOR",
  "OPCUA_EUROMAP77",
  "EUROMAP63_FILE",
  "MODBUS_MQTT",
];

interface FormState {
  code: string;
  machineId: string;
  adapterKind: GatewayAdapterKind;
  connectionSettingsText: string;
  credentialsText: string;
  pollIntervalSeconds: string;
}
const emptyForm: FormState = {
  code: "",
  machineId: "",
  adapterKind: "SIMULATOR",
  connectionSettingsText: "{}",
  credentialsText: "",
  pollIntervalSeconds: "30",
};

const relativeAge = (iso: string | null): string => {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};

const MachineGatewaysPage: React.FC = () => {
  const { can } = usePermission();
  const [rows, setRows] = useState<MachineGatewayRow[]>([]);
  const [machines, setMachines] = useState<{ machineId: string; machineName: string }[]>([]);
  const [canonicalSignals, setCanonicalSignals] = useState<CanonicalSignalRef[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<
    Record<string, { ok: boolean; detail: string } | undefined>
  >({});
  const [testingInFlight, setTestingInFlight] = useState<Set<string>>(new Set());
  const [signalMapFor, setSignalMapFor] = useState<string | null>(null);
  const [signalMapRows, setSignalMapRows] = useState<SignalMapRow[]>([]);
  const [newRow, setNewRow] = useState({ vendorTag: "", canonicalSignal: "" });

  const load = useCallback(async () => {
    try {
      setRows(await machineGatewayService.list());
    } catch (err) {
      toast.error(message(err));
    }
  }, []);
  useEffect(() => {
    void load();
    void machineService
      .getAll({ limit: 200 })
      .then((r) => setMachines(r?.machines ?? r?.data?.machines ?? []))
      .catch(() => setMachines([]));
    void machineTelemetryReadService
      .canonicalSignals()
      .then(setCanonicalSignals)
      .catch(() => setCanonicalSignals([]));
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      let connectionSettings: Record<string, unknown> = {};
      if (form.connectionSettingsText.trim()) {
        connectionSettings = JSON.parse(form.connectionSettingsText);
      }
      const credentials = form.credentialsText.trim()
        ? JSON.parse(form.credentialsText)
        : undefined;
      const pollIntervalSeconds = Number(form.pollIntervalSeconds) || 30;
      if (editing) {
        await machineGatewayService.update(editing, {
          connectionSettings,
          ...(credentials !== undefined ? { credentials } : {}),
          pollIntervalSeconds,
        });
        toast.success("Gateway updated");
      } else {
        await machineGatewayService.create({
          code: form.code,
          machineId: form.machineId,
          adapterKind: form.adapterKind,
          connectionSettings,
          credentials,
          pollIntervalSeconds,
        });
        toast.success("Gateway created");
      }
      setForm(emptyForm);
      setEditing(null);
      await load();
    } catch (err) {
      if (err instanceof SyntaxError)
        toast.error("Connection settings / credentials must be valid JSON");
      else toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (row: MachineGatewayRow) => {
    setEditing(row.id);
    setForm({
      code: row.code,
      machineId: row.machineId,
      adapterKind: row.adapterKind,
      connectionSettingsText: JSON.stringify(row.connectionSettings ?? {}, null, 2),
      credentialsText: "",
      pollIntervalSeconds: String(row.pollIntervalSeconds),
    });
  };

  const remove = async (id: string) => {
    try {
      await machineGatewayService.remove(id);
      toast.success("Gateway deleted");
      await load();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const testConnection = async (id: string) => {
    setTestingInFlight((s) => new Set(s).add(id));
    try {
      const result = await machineGatewayService.testConnection(id);
      setTesting((t) => ({ ...t, [id]: result }));
      if (result.ok) toast.success(result.detail);
      else toast.error(result.detail);
    } catch (err) {
      const detail = message(err);
      setTesting((t) => ({ ...t, [id]: { ok: false, detail } }));
      toast.error(detail);
    } finally {
      setTestingInFlight((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  const openSignalMap = async (id: string) => {
    if (signalMapFor === id) {
      setSignalMapFor(null);
      return;
    }
    setSignalMapFor(id);
    try {
      setSignalMapRows(await machineGatewayService.signalMap(id));
    } catch (err) {
      toast.error(message(err));
    }
  };

  const addSignalMapRow = () => {
    if (!newRow.vendorTag.trim() || !newRow.canonicalSignal) return;
    setSignalMapRows((rowsList) => [
      ...rowsList,
      {
        id: `new-${rowsList.length}`,
        gatewayId: signalMapFor ?? "",
        vendorTag: newRow.vendorTag.trim(),
        canonicalSignal: newRow.canonicalSignal,
        unit: null,
        dataType: "NUMERIC",
        isActive: true,
      },
    ]);
    setNewRow({ vendorTag: "", canonicalSignal: "" });
  };

  const saveSignalMap = async () => {
    if (!signalMapFor) return;
    try {
      const active = signalMapRows.filter((r) => r.isActive);
      const saved = await machineGatewayService.replaceSignalMap(
        signalMapFor,
        active.map((r) => ({ vendorTag: r.vendorTag, canonicalSignal: r.canonicalSignal }))
      );
      setSignalMapRows(saved);
      toast.success("Signal map saved");
    } catch (err) {
      toast.error(message(err));
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="Machine gateways"
        icon={<Cpu size={22} />}
        subtitle="One gateway per machine connection. SIMULATOR is the only adapter that has met a real device today; OPCUA_EUROMAP77, EUROMAP63_FILE and MODBUS_MQTT are written but unpinned and will refuse to connect until they have."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "Machine gateways" }]}
      />

      {can("machine-telemetry.configure") && (
        <div className="grid gap-2 sl-tile p-4 sm:p-5 sm:grid-cols-3">
          <input
            className={field}
            placeholder="Code"
            value={form.code}
            disabled={!!editing}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
          <select
            className={field}
            value={form.machineId}
            disabled={!!editing}
            onChange={(e) => setForm({ ...form, machineId: e.target.value })}
          >
            <option value="">Machine…</option>
            {machines.map((m) => (
              <option key={m.machineId} value={m.machineId}>
                {m.machineId} — {m.machineName}
              </option>
            ))}
          </select>
          <select
            className={field}
            value={form.adapterKind}
            disabled={!!editing}
            onChange={(e) =>
              setForm({ ...form, adapterKind: e.target.value as GatewayAdapterKind })
            }
          >
            {ADAPTER_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className={field}
            type="number"
            min={5}
            max={3600}
            placeholder="Poll interval (s)"
            value={form.pollIntervalSeconds}
            onChange={(e) => setForm({ ...form, pollIntervalSeconds: e.target.value })}
          />
          <textarea
            className={`${field} sm:col-span-3 font-mono text-xs`}
            rows={2}
            placeholder='Connection settings (JSON), e.g. {"filePath": "/var/telemetry/press1.json"}'
            value={form.connectionSettingsText}
            onChange={(e) => setForm({ ...form, connectionSettingsText: e.target.value })}
          />
          <textarea
            className={`${field} sm:col-span-3 font-mono text-xs`}
            rows={2}
            placeholder={
              editing
                ? "Credentials (JSON) — leave blank to keep the stored value"
                : "Credentials (JSON), e.g. {}"
            }
            value={form.credentialsText}
            onChange={(e) => setForm({ ...form, credentialsText: e.target.value })}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="sl-cta sl-pill-md"
              disabled={busy || (!editing && (!form.code || !form.machineId))}
              onClick={save}
            >
              {editing ? "Save" : "Add gateway"}
            </button>
            {editing && (
              <button
                type="button"
                className={secondary}
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="sl-tile overflow-x-auto p-2 sm:p-3">
        <table className="min-w-full divide-y divide-line-soft">
          <thead>
            <tr>
              <th className={th}>Code</th>
              <th className={th}>Machine</th>
              <th className={th}>Adapter</th>
              <th className={th}>Poll</th>
              <th className={th}>Status</th>
              <th className={th}>Last seen</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr>
                  <td className={`${td} font-mono text-xs`}>{r.code}</td>
                  <td className={td}>{r.machineId}</td>
                  <td className={td}>{r.adapterKind}</td>
                  <td className={td}>{r.pollIntervalSeconds}s</td>
                  <td className={td}>
                    {!r.isActive ? (
                      <span className="text-ink-muted">Inactive</span>
                    ) : r.consecutiveFailures > 0 ? (
                      <span
                        className="text-[color:var(--color-danger)]"
                        title={r.lastError ?? undefined}
                      >
                        {r.consecutiveFailures} failing
                      </span>
                    ) : (
                      <span className="text-[color:var(--color-success)]">Healthy</span>
                    )}
                  </td>
                  <td className={td}>{relativeAge(r.lastSeenAt)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {can("machine-telemetry.ingest") && (
                      <button
                        type="button"
                        className="sl-btn sl-pill-sm mr-2"
                        disabled={testingInFlight.has(r.id)}
                        onClick={() => testConnection(r.id)}
                      >
                        Test connection
                      </button>
                    )}
                    {can("machine-telemetry.view") && (
                      <button
                        type="button"
                        className="sl-btn sl-pill-sm mr-2"
                        onClick={() => openSignalMap(r.id)}
                      >
                        Signal map
                      </button>
                    )}
                    {can("machine-telemetry.configure") && (
                      <button
                        type="button"
                        className="sl-btn sl-pill-sm mr-2"
                        onClick={() => startEdit(r)}
                      >
                        Edit
                      </button>
                    )}
                    {can("machine-telemetry.configure") && (
                      <button type="button" className={danger} onClick={() => remove(r.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
                {testing[r.id] && (
                  <tr>
                    <td colSpan={7} className="px-3 pb-2">
                      <span
                        className={`sl-chip sl-chip-sm ${testing[r.id]!.ok ? "sl-chip-success" : "sl-chip-danger"}`}
                      >
                        {testing[r.id]!.detail}
                      </span>
                    </td>
                  </tr>
                )}
                {signalMapFor === r.id && (
                  <tr>
                    <td colSpan={7} className="bg-card-2 px-3 py-3">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                          Signal map — vendor tag → canonical signal
                        </p>
                        <table className="min-w-full">
                          <tbody>
                            {signalMapRows
                              .filter((row) => row.isActive)
                              .map((row) => (
                                <tr key={row.id}>
                                  <td className="py-1 pr-3 font-mono text-xs">{row.vendorTag}</td>
                                  <td className="py-1 pr-3 text-xs">{row.canonicalSignal}</td>
                                  <td className="py-1">
                                    <button
                                      type="button"
                                      className="text-xs font-semibold text-[color:var(--color-danger)] hover:underline"
                                      onClick={() =>
                                        setSignalMapRows((rowsList) =>
                                          rowsList.map((x) =>
                                            x.id === row.id ? { ...x, isActive: false } : x
                                          )
                                        )
                                      }
                                    >
                                      Remove
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            <tr>
                              <td className="py-1 pr-3">
                                <input
                                  className={`${field} w-32`}
                                  placeholder="Vendor tag"
                                  value={newRow.vendorTag}
                                  onChange={(e) =>
                                    setNewRow({ ...newRow, vendorTag: e.target.value })
                                  }
                                />
                              </td>
                              <td className="py-1 pr-3">
                                <select
                                  className={field}
                                  value={newRow.canonicalSignal}
                                  onChange={(e) =>
                                    setNewRow({ ...newRow, canonicalSignal: e.target.value })
                                  }
                                >
                                  <option value="">Canonical signal…</option>
                                  {canonicalSignals.map((s) => (
                                    <option key={s.signal} value={s.signal}>
                                      {s.signal}
                                      {s.unit ? ` (${s.unit})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="py-1">
                                <button
                                  type="button"
                                  className={secondary}
                                  onClick={addSignalMapRow}
                                >
                                  Add
                                </button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        {can("machine-telemetry.configure") && (
                          <button type="button" className={primary} onClick={saveSignalMap}>
                            Save signal map
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className={`${td} text-ink-muted`} colSpan={7}>
                  No gateways yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MachineGatewaysPage;
