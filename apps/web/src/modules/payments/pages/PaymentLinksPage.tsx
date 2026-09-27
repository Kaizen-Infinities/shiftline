import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  paymentsService,
  type GatewaySettings,
  type PaymentLinkRow,
  type PaymentLinkStatus,
} from "../../../services/paymentsService";
import {
  Card,
  day,
  danger,
  field,
  message,
  money,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * Payment links and the gateway (P1-21).
 *
 * The list is the useful half: what is out, what has been paid, and what the gateway kept. The
 * settings half exists so the secrets can be set once and never shown again — the screen can say
 * a secret is stored, and that is all it can say.
 */
const STATUS_STYLE: Record<PaymentLinkStatus, string> = {
  CREATED: "bg-sky-100 text-sky-800",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800",
  PAID: "bg-emerald-100 text-emerald-800",
  EXPIRED: "bg-slate-100 text-slate-700",
  CANCELLED: "bg-slate-100 text-slate-700",
};

const PaymentLinksPage: React.FC = () => {
  const { can } = usePermission();
  const [tab, setTab] = useState<"links" | "settings">("links");
  const [links, setLinks] = useState<PaymentLinkRow[]>([]);
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "links") setLinks(await paymentsService.links());
      else {
        const s = await paymentsService.settings();
        setSettings(s);
        setKeyId(s.keyId ?? "");
      }
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const raise = async () => {
    const value = Number(amount);
    if (!value || value <= 0) return toast.error("Give the amount to collect");
    setBusy(true);
    try {
      await paymentsService.create({ amount: value, description: description || null });
      setAmount("");
      setDescription("");
      toast.success("Payment link raised");
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const saved = await paymentsService.saveSettings({
        provider: settings.provider,
        enabled: settings.enabled,
        keyId: keyId || null,
        keySecret: keySecret || null,
        webhookSecret: webhookSecret || null,
        bankLedgerCode: settings.bankLedgerCode,
        feeLedgerCode: settings.feeLedgerCode,
        expiryHours: settings.expiryHours,
      });
      setSettings(saved);
      // The secrets are gone from the form the moment they are stored.
      setKeySecret("");
      setWebhookSecret("");
      toast.success("Gateway settings saved");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="sl-h1 m-0">Payment Links</h1>
        <p className="text-sm text-ink-soft">
          Links a customer can pay, and what the gateway kept out of each collection.
        </p>
      </div>

      <div className="flex gap-2">
        {(["links", "settings"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={t === tab ? primary : secondary}
          >
            {t === "links" ? "Links" : "Gateway"}
          </button>
        ))}
      </div>

      {tab === "links" && (
        <>
          {can("payments.create") && (
            <Card title="Raise a link">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-ink-soft">
                  Amount
                  <input
                    className={`${field} ml-2 w-32`}
                    value={amount}
                    inputMode="decimal"
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="text-sm text-ink-soft">
                  For
                  <input
                    className={`${field} ml-2 w-64`}
                    value={description}
                    placeholder="What this is for"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <button type="button" className={primary} disabled={busy} onClick={raise}>
                  Raise link
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-soft">
                A link against an invoice is raised from the invoice itself, so it can never be for
                more than the invoice still owes.
              </p>
            </Card>
          )}

          <Card title="Links">
            {loading ? (
              <p className="text-sm text-ink-soft">Loading…</p>
            ) : links.length === 0 ? (
              <p className="text-sm text-ink-soft">No payment links yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr>
                      <th className={th}>Link</th>
                      <th className={th}>For</th>
                      <th className={th}>Amount</th>
                      <th className={th}>Paid</th>
                      <th className={th}>Gateway kept</th>
                      <th className={th}>Status</th>
                      <th className={th}>Expires</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((l) => {
                      const kept = (l.captures ?? []).reduce(
                        (s, c) => s + Number(c.fee) + Number(c.feeTax),
                        0
                      );
                      return (
                        <tr key={l.id} className="border-t border-line-soft">
                          <td className={td}>
                            {l.shortUrl ? (
                              <a
                                className="text-blue-600 hover:underline"
                                href={l.shortUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {l.linkNo}
                              </a>
                            ) : (
                              l.linkNo
                            )}
                          </td>
                          <td className={td}>{l.description ?? "—"}</td>
                          <td className={`${td} text-right`}>{money(l.amount)}</td>
                          <td className={`${td} text-right`}>{money(l.amountPaid)}</td>
                          <td className={`${td} text-right`}>{kept ? money(kept) : "—"}</td>
                          <td className={td}>
                            <span
                              className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[l.status]}`}
                            >
                              {l.status.replace("_", " ").toLowerCase()}
                            </span>
                          </td>
                          <td className={td}>{day(l.expiresAt)}</td>
                          <td className={`${td} whitespace-nowrap`}>
                            <button
                              type="button"
                              className={secondary}
                              disabled={busy}
                              onClick={() =>
                                act(() => paymentsService.refresh(l.id), "Checked with the gateway")
                              }
                            >
                              Check
                            </button>
                            {can("payments.cancel") &&
                              l.status !== "PAID" &&
                              l.status !== "CANCELLED" && (
                                <button
                                  type="button"
                                  className={`${danger} ml-2`}
                                  disabled={busy}
                                  onClick={() =>
                                    act(() => paymentsService.cancel(l.id), "Link cancelled")
                                  }
                                >
                                  Cancel
                                </button>
                              )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === "settings" && settings && (
        <Card title="Gateway">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink-soft">
              Provider
              <select
                className={`${field} ml-2`}
                value={settings.provider}
                onChange={(e) => setSettings({ ...settings, provider: e.target.value })}
              >
                <option value="FIXTURE">Fixture (no real money)</option>
                <option value="RAZORPAY">Razorpay</option>
              </select>
            </label>
            <label className="text-sm text-ink-soft">
              <input
                type="checkbox"
                className="mr-2"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              Collect through the gateway
            </label>
            <label className="text-sm text-ink-soft">
              Key id
              <input
                className={`${field} ml-2 w-56`}
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
              />
            </label>
            <label className="text-sm text-ink-soft">
              Key secret
              <input
                className={`${field} ml-2 w-56`}
                type="password"
                value={keySecret}
                placeholder={settings.hasKeySecret ? "stored — leave blank to keep" : ""}
                onChange={(e) => setKeySecret(e.target.value)}
              />
            </label>
            <label className="text-sm text-ink-soft">
              Webhook secret
              <input
                className={`${field} ml-2 w-56`}
                type="password"
                value={webhookSecret}
                placeholder={settings.hasWebhookSecret ? "stored — leave blank to keep" : ""}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </label>
            <label className="text-sm text-ink-soft">
              A link lasts (hours)
              <input
                className={`${field} ml-2 w-24`}
                value={settings.expiryHours}
                onChange={(e) =>
                  setSettings({ ...settings, expiryHours: Number(e.target.value) || 0 })
                }
              />
            </label>
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            Callback URL: <code className="text-xs">{settings.webhookPath}</code> — give this to the
            gateway. It names no company, and rotating it stops the old one at once.
          </p>
          {can("payments.settings") && (
            <div className="mt-3 flex gap-2">
              <button type="button" className={primary} disabled={busy} onClick={save}>
                Save
              </button>
              <button
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const out = await paymentsService.verify();
                    if (!out.ok) throw new Error(out.detail);
                  }, "The gateway answered")
                }
              >
                Check the credentials
              </button>
              <button
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => act(() => paymentsService.rotateToken(), "Callback URL rotated")}
              >
                Rotate the callback URL
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default PaymentLinksPage;
