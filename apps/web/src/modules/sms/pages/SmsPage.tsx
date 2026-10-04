import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { ChipTabs, LoadError, PageHeader } from "../../../components/ui/v2";
import { MessageSquare } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  smsService,
  type SmsMessageRow,
  type SmsSettings,
  type SmsTemplateRow,
} from "../../../services/smsService";
import {
  Card,
  day,
  field,
  message,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * SMS, the DLT templates and the log (P1-22).
 *
 * The templates tab is the one that matters: in India a transactional message is delivered only
 * if it matches a template registered on a DLT platform, so a template without its registration
 * id is a message that will silently go nowhere. The screen says so on the row.
 */
const STATUS_STYLE: Record<SmsMessageRow["status"], string> = {
  QUEUED: "border border-line text-ink-muted bg-card-2",
  SENT: "border border-[color:var(--color-success)]/40 text-[color:var(--color-success)] bg-[color:var(--color-success)]/10",
  DELIVERED:
    "border border-[color:var(--color-success)]/40 text-[color:var(--color-success)] bg-[color:var(--color-success)]/10",
  FAILED:
    "border border-[color:var(--color-danger)]/40 text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10",
};

const SmsPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<"templates" | "messages" | "settings">("templates");
  const [templates, setTemplates] = useState<SmsTemplateRow[]>([]);
  const [messages, setMessages] = useState<SmsMessageRow[]>([]);
  const [settings, setSettings] = useState<SmsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadSeq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [authKey, setAuthKey] = useState("");
  const [dltEdits, setDltEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    // Only the newest request may write state: a slow tab must not overwrite the one now open.
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      if (tab === "templates") {
        const rows = await smsService.templates(true);
        if (seq === loadSeq.current) setTemplates(rows);
      }
      if (tab === "messages") {
        const rows = await smsService.messages();
        if (seq === loadSeq.current) setMessages(rows);
      }
      if (tab === "settings") {
        const row = await smsService.settings();
        if (seq === loadSeq.current) setSettings(row);
      }
    } catch {
      if (seq === loadSeq.current) setLoadFailed(true);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveTemplate = async (t: SmsTemplateRow) => {
    setBusy(true);
    try {
      await smsService.saveTemplate({
        code: t.code,
        name: t.name,
        category: t.category,
        dltTemplateId: dltEdits[t.code] ?? t.dltTemplateId,
        body: t.body,
        isActive: t.isActive,
      });
      toast.success(`${t.code} saved`);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const saved = await smsService.saveSettings({
        provider: settings.provider,
        enabled: settings.enabled,
        senderId: settings.senderId,
        principalEntityId: settings.principalEntityId,
        authKey: authKey || null,
        dailyCap: settings.dailyCap,
      });
      setSettings(saved);
      setAuthKey("");
      toast.success("SMS settings saved");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <PageHeader
        title="SMS and OTP"
        icon={<MessageSquare size={22} />}
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "SMS and OTP" }]}
        subtitle="Templates registered on DLT, what has been sent, and the account it goes out through."
      />

      <ChipTabs
        ariaLabel="SMS"
        value={tab}
        onChange={setTab}
        items={(["templates", "messages", "settings"] as const).map((t) => ({
          key: t,
          label: t === "templates" ? "Templates" : t === "messages" ? "Sent" : "Account",
        }))}
      />

      {loadFailed && (
        <div className="sl-tile">
          <LoadError
            compact
            title={`Couldn't load the SMS ${tab === "templates" ? "templates" : tab === "messages" ? "log" : "account"}`}
            onRetry={load}
            retrying={loading}
          />
        </div>
      )}

      {!loadFailed && tab === "templates" && (
        <Card title="Templates">
          {loading ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Code</th>
                    <th className={th}>Message</th>
                    <th className={th}>Variables</th>
                    <th className={th}>DLT template id</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-t border-line-soft align-top">
                      <td className={td}>
                        <div className="font-medium">{t.code}</div>
                        <div className="text-xs text-ink-muted">{t.name}</div>
                      </td>
                      <td className={`${td} max-w-md`}>{t.body}</td>
                      <td className={td}>{t.variables.join(", ") || "—"}</td>
                      <td className={td}>
                        <input
                          className={`${field} w-44`}
                          value={dltEdits[t.code] ?? t.dltTemplateId ?? ""}
                          placeholder="not registered"
                          onChange={(e) => setDltEdits({ ...dltEdits, [t.code]: e.target.value })}
                        />
                        {!t.dltTemplateId && (
                          <div className="mt-1 text-xs text-[color:var(--color-danger)]">
                            Without this the operator drops the message.
                          </div>
                        )}
                      </td>
                      <td className={td}>
                        {can("sms.settings") && (
                          <button
                            type="button"
                            className={secondary}
                            disabled={busy}
                            onClick={() => saveTemplate(t)}
                          >
                            Save
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!loadFailed && tab === "messages" && (
        <Card title="Sent">
          {loading ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing has been sent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>To</th>
                    <th className={th}>Template</th>
                    <th className={th}>Message</th>
                    <th className={th}>Parts</th>
                    <th className={th}>Status</th>
                    <th className={th}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id} className="border-t border-line-soft">
                      <td className={td}>{m.toMobile}</td>
                      <td className={td}>{m.templateCode ?? "—"}</td>
                      <td className={`${td} max-w-md truncate`}>{m.body}</td>
                      <td className={`${td} text-right`}>{m.segments}</td>
                      <td className={td}>
                        <span
                          className={`rounded-sm px-2 py-0.5 text-xs ${STATUS_STYLE[m.status]}`}
                        >
                          {m.status.toLowerCase()}
                        </span>
                        {m.error && (
                          <div className="text-xs text-[color:var(--color-danger)]">{m.error}</div>
                        )}
                      </td>
                      <td className={td}>{day(m.sentAt ?? m.queuedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {!loadFailed && tab === "settings" && !settings && loading && (
        <div className="sl-tile space-y-3 p-5" role="status" aria-label="Loading">
          <div className="sl-skeleton h-4 w-2/5" />
          <div className="sl-skeleton h-3 w-3/4" />
        </div>
      )}

      {!loadFailed && tab === "settings" && settings && (
        <Card title="Account">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink-muted">
              Provider
              <select
                className={`${field} ml-2`}
                value={settings.provider}
                onChange={(e) => setSettings({ ...settings, provider: e.target.value })}
              >
                <option value="FIXTURE">Fixture (nothing leaves the building)</option>
                <option value="MSG91">MSG91</option>
              </select>
            </label>
            <label className="text-sm text-ink-muted">
              <input
                type="checkbox"
                className="mr-2"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              Send messages
            </label>
            <label className="text-sm text-ink-muted">
              Sender id
              <input
                className={`${field} ml-2 w-28`}
                value={settings.senderId ?? ""}
                placeholder="SHFTLN"
                onChange={(e) =>
                  setSettings({ ...settings, senderId: e.target.value.toUpperCase() })
                }
              />
            </label>
            <label className="text-sm text-ink-muted">
              Principal entity id
              <input
                className={`${field} ml-2 w-56`}
                value={settings.principalEntityId ?? ""}
                onChange={(e) => setSettings({ ...settings, principalEntityId: e.target.value })}
              />
            </label>
            <label className="text-sm text-ink-muted">
              Auth key
              <input
                className={`${field} ml-2 w-56`}
                type="password"
                value={authKey}
                placeholder={settings.hasAuthKey ? "stored — leave blank to keep" : ""}
                onChange={(e) => setAuthKey(e.target.value)}
              />
            </label>
            <label className="text-sm text-ink-muted">
              Messages a day
              <input
                className={`${field} ml-2 w-28`}
                value={settings.dailyCap}
                onChange={(e) =>
                  setSettings({ ...settings, dailyCap: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            {settings.sentToday} of {settings.dailyCap} sent today.
          </p>
          {can("sms.settings") && (
            <div className="mt-3 flex gap-2">
              <button type="button" className={primary} disabled={busy} onClick={saveSettings}>
                Save
              </button>
              <button
                type="button"
                className={secondary}
                disabled={busy}
                onClick={async () => {
                  try {
                    const out = await smsService.verify();
                    if (out.ok) toast.success(out.detail);
                    else toast.error(out.detail);
                  } catch (err) {
                    toast.error(message(err));
                  }
                }}
              >
                Check the credentials
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default SmsPage;
