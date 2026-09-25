import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { eInvoiceService, type EInvoiceSettings } from "../../../services/eInvoiceService";

/**
 * E-invoice settings (P1-11): whether it is on, from which date, the turnover band that decides
 * the 30-day window, and the GSP connection. Secrets are write-only.
 */
const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50";
const primary = `${btn} bg-accent text-white hover:brightness-110`;
const secondary = `${btn} border border-line-soft text-ink hover:bg-card-2`;
const input = "w-full rounded-lg border border-line-soft bg-card-2 px-3 py-2 text-sm text-ink";
const label = "block text-xs font-semibold uppercase tracking-wide text-ink-subtle mb-1";
const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  "Something went wrong";

interface Form {
  provider: "FIXTURE" | "GSP";
  enabled: boolean;
  applicableFrom: string;
  aatoCrore: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}
const fromSettings = (s: EInvoiceSettings): Form => ({
  provider: s.provider,
  enabled: s.enabled,
  applicableFrom: s.applicableFrom ?? "",
  aatoCrore: s.aatoCrore === null ? "" : String(s.aatoCrore),
  baseUrl: s.baseUrl ?? "",
  clientId: s.clientId ?? "",
  clientSecret: "",
  username: s.username ?? "",
  password: "",
});

const EInvoiceSettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<EInvoiceSettings | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await eInvoiceService.settings();
      setSettings(s);
      setForm(fromSettings(s));
    } catch (err) {
      toast.error(message(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const s = await eInvoiceService.saveSettings({
        provider: form.provider,
        enabled: form.enabled,
        applicableFrom: form.applicableFrom || null,
        aatoCrore: form.aatoCrore === "" ? null : Number(form.aatoCrore),
        baseUrl: form.baseUrl || null,
        clientId: form.clientId || null,
        username: form.username || null,
        ...(form.clientSecret && { clientSecret: form.clientSecret }),
        ...(form.password && { password: form.password }),
      });
      setSettings(s);
      setForm(fromSettings(s));
      toast.success("E-invoice settings saved");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    try {
      const r = await eInvoiceService.verify();
      (r.ok ? toast.success : toast.error)(r.detail);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  if (!form || !settings) return <div className="p-6 text-sm text-ink-muted">Loading…</div>;
  return (
    <div className="p-4 md:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-ink">E-invoicing</h2>
        <p className="text-sm text-ink-muted">
          B2B invoices, credit notes and debit notes are registered with the Invoice Registration
          Portal through your GST Suvidha Provider. Until a GSP is connected, the built-in fixture
          provider mimics the portal so the flow can be tried without filing anything.
        </p>
      </div>
      <div className="grid gap-4 rounded-lg border border-line-soft bg-card p-4 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-ink md:col-span-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          E-invoicing is on for this company
        </label>
        <div>
          <span className={label}>Provider</span>
          <select
            className={input}
            value={form.provider}
            onChange={(e) => set("provider", e.target.value as Form["provider"])}
          >
            <option value="FIXTURE">Fixture (no portal; for trials)</option>
            <option value="GSP">GST Suvidha Provider</option>
          </select>
        </div>
        <div>
          <span className={label}>Applies to documents dated from</span>
          <input
            type="date"
            className={input}
            value={form.applicableFrom}
            onChange={(e) => set("applicableFrom", e.target.value)}
          />
        </div>
        <div>
          <span className={label}>Aggregate annual turnover (₹ crore)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            className={input}
            value={form.aatoCrore}
            onChange={(e) => set("aatoCrore", e.target.value)}
            placeholder="e.g. 12"
          />
          <p className="mt-1 text-xs text-ink-muted">
            At ₹10 crore and above the portal accepts an IRN only within 30 days of the document
            date.
            {settings.thirtyDayWindow && " The 30-day window is in force."}
          </p>
        </div>
        <div className="md:col-span-2 border-t border-line-soft pt-3 text-sm font-semibold text-ink">
          GSP connection
        </div>
        <div className="md:col-span-2">
          <span className={label}>Base URL</span>
          <input
            className={input}
            value={form.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder="https://…"
          />
        </div>
        <div>
          <span className={label}>Client id</span>
          <input
            className={input}
            value={form.clientId}
            onChange={(e) => set("clientId", e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <span className={label}>
            Client secret {settings.hasClientSecret && "(stored; leave blank to keep)"}
          </span>
          <input
            type="password"
            className={input}
            value={form.clientSecret}
            onChange={(e) => set("clientSecret", e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div>
          <span className={label}>API user (e-invoice portal)</span>
          <input
            className={input}
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <span className={label}>
            API password {settings.hasPassword && "(stored; leave blank to keep)"}
          </span>
          <input
            type="password"
            className={input}
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <button type="button" className={primary} disabled={busy} onClick={save}>
            Save
          </button>
          <button type="button" className={secondary} disabled={busy} onClick={verify}>
            Test connection
          </button>
          {settings.lastVerifiedAt && (
            <span className="text-xs text-ink-muted">
              Last verified{" "}
              {new Date(settings.lastVerifiedAt).toLocaleString("en-IN", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default EInvoiceSettingsPage;
