import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import { customerService } from "../../../services/customerService";
import {
  orderTnaService,
  type OrderTnaDetail,
  type OrderTnaRow,
  type Rag,
  type TnaAlert,
  type TnaMilestone,
  type TnaTemplate,
} from "../../../services/orderTnaService";
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
 * Export order time-and-action calendar (TN-03): every buyer order's milestones counted back
 * from the ex-factory date, with RAG status and what is overdue today.
 */
const RAG_DOT: Record<Rag, string> = {
  RED: "bg-rose-500",
  AMBER: "bg-amber-400",
  GREEN: "bg-emerald-500",
};

const RagDot: React.FC<{ rag: Rag }> = ({ rag }) => (
  <span
    className={`inline-block h-2.5 w-2.5 rounded-full ${RAG_DOT[rag]}`}
    title={rag}
    aria-label={rag}
  />
);

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  customerId: "",
  buyerPoNo: "",
  styleRef: "",
  orderQty: "",
  uom: "PCS",
  orderDate: todayIso(),
  exFactoryDate: "",
  template: "GARMENT_KNIT",
  merchandiser: "",
};

const MilestoneRow: React.FC<{
  m: TnaMilestone;
  canEdit: boolean;
  onSave: (m: TnaMilestone, patch: { actualDate?: string; status?: "DONE" | "PENDING" }) => void;
}> = ({ m, canEdit, onSave }) => {
  const [actual, setActual] = useState(m.actualDate ?? todayIso());
  const overdue = m.status === "PENDING" && m.plannedDate < todayIso();
  return (
    <tr className="border-t border-line-soft">
      <td className={td}>{m.seq}</td>
      <td className={td}>{m.name}</td>
      <td className={`${td} ${overdue ? "font-medium text-rose-600" : ""}`}>
        {day(m.plannedDate)}
      </td>
      <td className={td}>{m.actualDate ? day(m.actualDate) : "—"}</td>
      <td className={td}>{m.status}</td>
      <td className={`${td} ${m.delayDays && m.delayDays > 0 ? "text-rose-600" : ""}`}>
        {m.delayDays ?? "—"}
      </td>
      <td className={td}>
        {canEdit && m.status === "PENDING" && (
          <span className="flex items-center gap-1">
            <input
              type="date"
              className={field}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              aria-label={`Actual date for ${m.name}`}
            />
            <button
              className={secondary}
              onClick={() => onSave(m, { status: "DONE", actualDate: actual })}
            >
              Done
            </button>
          </span>
        )}
        {canEdit && m.status === "DONE" && (
          <button className={secondary} onClick={() => onSave(m, { status: "PENDING" })}>
            Reopen
          </button>
        )}
      </td>
    </tr>
  );
};

const OrderTnaPage: React.FC = () => {
  const { can } = usePermission();
  const canEdit = can("order-tna.edit");
  const [rows, setRows] = useState<OrderTnaRow[]>([]);
  const [alerts, setAlerts] = useState<TnaAlert[]>([]);
  const [templates, setTemplates] = useState<TnaTemplate[]>([]);
  const [buyers, setBuyers] = useState<{ id: string; firmName: string }[]>([]);
  const [buyer, setBuyer] = useState("");
  const [selected, setSelected] = useState<OrderTnaDetail | null>(null);
  const [newExFactory, setNewExFactory] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, due] = await Promise.all([
        orderTnaService.list({ status: "ACTIVE", ...(buyer ? { customerId: buyer } : {}) }),
        orderTnaService.alerts(3),
      ]);
      setRows(list);
      setAlerts(due);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [buyer]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    orderTnaService
      .templates()
      .then(setTemplates)
      .catch(() => setTemplates([]));
    customerService
      .fetchAll({ limit: 200 })
      .then((r) => setBuyers(r.customers.map((c) => ({ id: c.id, firmName: c.firmName }))))
      .catch(() => setBuyers([]));
  }, []);

  const open = async (id: string) => {
    try {
      const detail = await orderTnaService.get(id);
      setSelected(detail);
      setNewExFactory(detail.exFactoryDate);
    } catch (err) {
      toast.error(message(err));
    }
  };

  const run = async (fn: () => Promise<OrderTnaDetail>, ok: string) => {
    try {
      const detail = await fn();
      setSelected(detail);
      setNewExFactory(detail.exFactoryDate);
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(
      () =>
        orderTnaService.create({
          customerId: form.customerId,
          buyerPoNo: form.buyerPoNo.trim(),
          styleRef: form.styleRef.trim(),
          orderQty: Number(form.orderQty),
          uom: form.uom || undefined,
          orderDate: form.orderDate,
          exFactoryDate: form.exFactoryDate,
          template: form.template,
          merchandiser: form.merchandiser.trim() || undefined,
        }),
      "T&A plan created"
    );
    setForm(emptyForm);
    setShowForm(false);
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Order T&amp;A</h1>
          <p className="text-sm text-ink-muted">
            Buyer order milestones counted back from the ex-factory date.
          </p>
        </div>
        {can("order-tna.create") && (
          <button className={primary} onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "New T&A plan"}
          </button>
        )}
      </header>

      {alerts.length > 0 && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <strong className="mr-2">Alerts:</strong>
          {alerts.slice(0, 8).map((a) => (
            <button
              key={a.milestoneId}
              className="mr-3 underline-offset-2 hover:underline"
              onClick={() => void open(a.tnaId)}
            >
              {a.tnaNo} · {a.milestone} ·{" "}
              {a.kind === "OVERDUE" ? `${a.daysLate}d late` : `due ${day(a.plannedDate)}`}
            </button>
          ))}
          {alerts.length > 8 && <span>+{alerts.length - 8} more</span>}
        </section>
      )}

      {showForm && (
        <Card title="New T&A plan">
          <form onSubmit={create} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              className={field}
              value={form.customerId}
              onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
              required
              aria-label="Buyer"
            >
              <option value="">Buyer</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.firmName}
                </option>
              ))}
            </select>
            <input
              className={field}
              placeholder="Buyer PO no."
              value={form.buyerPoNo}
              onChange={(e) => setForm((f) => ({ ...f, buyerPoNo: e.target.value }))}
              required
            />
            <input
              className={field}
              placeholder="Style ref"
              value={form.styleRef}
              onChange={(e) => setForm((f) => ({ ...f, styleRef: e.target.value }))}
              required
            />
            <input
              className={field}
              type="number"
              min="0"
              step="any"
              placeholder="Order qty"
              value={form.orderQty}
              onChange={(e) => setForm((f) => ({ ...f, orderQty: e.target.value }))}
              required
            />
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Order date
              <input
                className={field}
                type="date"
                value={form.orderDate}
                onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
                required
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              Ex-factory
              <input
                className={field}
                type="date"
                value={form.exFactoryDate}
                onChange={(e) => setForm((f) => ({ ...f, exFactoryDate: e.target.value }))}
                required
              />
            </label>
            <select
              className={field}
              value={form.template}
              onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))}
              aria-label="Template"
            >
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              className={field}
              placeholder="Merchandiser"
              value={form.merchandiser}
              onChange={(e) => setForm((f) => ({ ...f, merchandiser: e.target.value }))}
            />
            <button className={primary} type="submit">
              Create
            </button>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card
            title="Active orders"
            actions={
              <select
                className={field}
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
                aria-label="Filter by buyer"
              >
                <option value="">All buyers</option>
                {buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.firmName}
                  </option>
                ))}
              </select>
            }
          >
            {loading ? (
              <p className="text-sm text-ink-muted">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-ink-muted">No active T&amp;A plans yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th} />
                    <th className={th}>T&amp;A no.</th>
                    <th className={th}>Buyer</th>
                    <th className={th}>Ex-factory</th>
                    <th className={th}>Next</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={`cursor-pointer border-t border-line-soft hover:bg-card-2 ${
                        selected?.id === r.id ? "bg-card-2" : ""
                      }`}
                      onClick={() => void open(r.id)}
                    >
                      <td className={td}>
                        <RagDot rag={r.rag} />
                      </td>
                      <td className={td}>
                        {r.tnaNo}
                        <div className="text-xs text-ink-muted">{r.styleRef}</div>
                      </td>
                      <td className={td}>{r.customerName ?? "—"}</td>
                      <td className={td}>{day(r.exFactoryDate)}</td>
                      <td className={td}>
                        {r.nextMilestone ? r.nextMilestone.name : "—"}
                        {r.overdueCount > 0 && (
                          <div className="text-xs text-rose-600">{r.overdueCount} overdue</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="lg:col-span-3">
          {selected ? (
            <Card
              title={`${selected.tnaNo} · ${selected.customerName ?? ""}`}
              actions={
                canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      className={field}
                      value={newExFactory}
                      onChange={(e) => setNewExFactory(e.target.value)}
                      aria-label="Ex-factory date"
                    />
                    <button
                      className={secondary}
                      disabled={!newExFactory || newExFactory === selected.exFactoryDate}
                      onClick={() =>
                        void run(
                          () =>
                            orderTnaService.update(selected.id, { exFactoryDate: newExFactory }),
                          "Ex-factory date moved"
                        )
                      }
                    >
                      Reschedule
                    </button>
                  </div>
                )
              }
            >
              <p className="mb-2 text-sm text-ink-muted">
                <RagDot rag={selected.rag} /> PO {selected.buyerPoNo} · {selected.orderQty}{" "}
                {selected.uom ?? ""} · ex-factory {day(selected.exFactoryDate)}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>#</th>
                      <th className={th}>Milestone</th>
                      <th className={th}>Planned</th>
                      <th className={th}>Actual</th>
                      <th className={th}>Status</th>
                      <th className={th}>Delay</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {selected.milestones.map((m) => (
                      <MilestoneRow
                        key={`${m.id}-${m.status}`}
                        m={m}
                        canEdit={canEdit}
                        onSave={(ms, patch) =>
                          void run(
                            () =>
                              orderTnaService.updateMilestone(selected.id, ms.id, {
                                ...patch,
                                ...(patch.status === "PENDING" ? { actualDate: null } : {}),
                              }),
                            "Milestone updated"
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card title="Milestones">
              <p className="text-sm text-ink-muted">Pick an order to see its milestones.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderTnaPage;
