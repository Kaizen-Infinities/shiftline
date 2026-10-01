import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { PageHeader } from "../../../components/ui/v2";
import { Coins } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  currencyService,
  type CurrencyRow,
  type ExchangeRateRow,
} from "../../../services/advanceService";
import { Card, day, field, message, primary, td, th } from "../../compliance/components/gstUi";

/**
 * The currency master and the daily rates (P1-14).
 *
 * A document in a foreign currency will not save without a rate for its date, so this screen is
 * where an export month starts. Rates are per day and the one on or before the document's date
 * is used, because a holiday has no rate of its own.
 */
const today = () => new Date().toISOString().slice(0, 10);

const CurrenciesPage: React.FC = () => {
  const { can } = usePermission();
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([]);
  const [rates, setRates] = useState<ExchangeRateRow[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ currencyCode: "USD", rateDate: today(), rate: "" });

  const load = useCallback(async () => {
    try {
      const [list, rows] = await Promise.all([
        currencyService.list(true),
        currencyService.rates(filter ? { currencyCode: filter } : {}),
      ]);
      setCurrencies(list);
      setRates(rows);
    } catch (err) {
      toast.error(message(err));
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!(Number(form.rate) > 0)) {
      toast.error("A rate has to be more than zero");
      return;
    }
    setBusy(true);
    try {
      await currencyService.setRate({
        currencyCode: form.currencyCode,
        rateDate: form.rateDate,
        rate: Number(form.rate),
      });
      toast.success("Rate saved");
      setForm({ ...form, rate: "" });
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (c: CurrencyRow) => {
    setBusy(true);
    try {
      await currencyService.save({ ...c, isActive: !c.isActive });
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sl-page">
      <PageHeader
        title="Currencies & rates"
        icon={<Coins size={22} />}
        subtitle="The books are kept in rupees. A foreign invoice converts at the rate published for its date, and that rate stays on the document."
        breadcrumbs={[{ label: "Settings", to: "/settings" }, { label: "Currencies & rates" }]}
      />

      {can("currencies.edit") && (
        <Card title="Record a rate">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="text-ink-muted">Currency</span>
              <select
                className={`${field} mt-1`}
                value={form.currencyCode}
                onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}
              >
                {currencies
                  .filter((c) => c.code !== "INR")
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-ink-muted">Date</span>
              <input
                type="date"
                className={`${field} mt-1`}
                value={form.rateDate}
                onChange={(e) => setForm({ ...form, rateDate: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-ink-muted">Rupees per unit</span>
              <input
                type="number"
                step="0.0001"
                className={`${field} mt-1`}
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
              />
            </label>
            <button className={primary} onClick={() => void save()} disabled={busy}>
              Save
            </button>
          </div>
        </Card>
      )}

      <Card title="Currencies">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Code</th>
                <th className={th}>Name</th>
                <th className={th}>Symbol</th>
                <th className={th}>In use</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => (
                <tr key={c.code} className="border-t border-line-soft">
                  <td className={`${td} font-medium`}>{c.code}</td>
                  <td className={td}>{c.name}</td>
                  <td className={td}>{c.symbol ?? "—"}</td>
                  <td className={td}>{c.isActive ? "Yes" : "No"}</td>
                  <td className={`${td} text-right`}>
                    {can("currencies.edit") && c.code !== "INR" && (
                      <button
                        className="text-sm font-semibold text-accent hover:underline"
                        onClick={() => void toggle(c)}
                        disabled={busy}
                      >
                        {c.isActive ? "Retire" : "Use"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Rates"
        actions={
          <select
            className={field}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by currency"
          >
            <option value="">Every currency</option>
            {currencies
              .filter((c) => c.code !== "INR")
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
          </select>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Currency</th>
                <th className={`${th} text-right`}>Rupees per unit</th>
                <th className={th}>Source</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className={td}>{day(r.rateDate)}</td>
                  <td className={td}>{r.currencyCode}</td>
                  <td className={`${td} text-right`}>{Number(r.rate).toFixed(4)}</td>
                  <td className={`${td} text-ink-muted`}>{r.source.toLowerCase()}</td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td className={`${td} text-ink-muted`} colSpan={4}>
                    No rates yet. A foreign-currency invoice needs one for its date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default CurrenciesPage;
