import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { CUSTOMER_LIST_MAX_LIMIT } from "@shiftline/shared";

import { usePermission } from "../../../hooks/usePermission";
import { CUSTOMER_LOAD_ERROR, customerService } from "../../../services/customerService";
import {
  orderTnaService,
  type OrderTnaDetail,
  type OrderTnaRow,
  type Rag,
  type TnaAlert,
  type TnaMilestone,
  type TnaTemplate,
} from "../../../services/orderTnaService";
import { day, message } from "../../compliance/components/gstUi";
import { AlertTriangle, CalendarClock, Check, Plus, RotateCcw, X } from "lucide-react";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tile,
  cx,
  type ChipTone,
} from "../../../components/ui/v2";
import { PageBody, formatQty } from "../ui";

const th = "sl-th px-3 py-3 text-left";
const td = "px-3 py-3 text-sm text-ink align-middle";
const field = "sl-input h-11";

/**
 * Export order time-and-action calendar (TN-03): every buyer order's milestones counted back
 * from the ex-factory date, with RAG status and what is overdue today.
 */
const RAG_TONE: Record<Rag, ChipTone> = {
  RED: "danger",
  AMBER: "warning",
  GREEN: "success",
};
const RAG_LABEL: Record<Rag, string> = { RED: "Late", AMBER: "At risk", GREEN: "On track" };

const RagDot: React.FC<{ rag: Rag }> = ({ rag }) => (
  <Chip size="sm" dot tone={RAG_TONE[rag]} title={rag}>
    {RAG_LABEL[rag]}
  </Chip>
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
      <td className={`${td} tabular-nums text-ink-subtle`}>{m.seq}</td>
      <td className={`${td} font-semibold`}>{m.name}</td>
      <td
        className={cx(
          td,
          "tabular-nums",
          overdue && "font-semibold text-[color:var(--color-danger)]"
        )}
      >
        {day(m.plannedDate)}
      </td>
      <td className={`${td} tabular-nums`}>{m.actualDate ? day(m.actualDate) : "—"}</td>
      <td className={td}>
        <Chip size="sm" dot tone={m.status === "DONE" ? "success" : overdue ? "danger" : "muted"}>
          {m.status === "DONE" ? "Done" : overdue ? "Overdue" : "Pending"}
        </Chip>
      </td>
      <td
        className={cx(
          td,
          "text-right tabular-nums",
          m.delayDays && m.delayDays > 0 && "font-semibold text-[color:var(--color-danger)]"
        )}
      >
        {m.delayDays ?? "—"}
      </td>
      <td className={td}>
        {canEdit && m.status === "PENDING" && (
          <span className="flex items-center justify-end gap-1.5">
            <input
              type="date"
              className={`${field} w-[150px]`}
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              aria-label={`Actual date for ${m.name}`}
            />
            <ActionPill
              variant="secondary"
              size="sm"
              icon={<Check size={14} />}
              onClick={() => onSave(m, { status: "DONE", actualDate: actual })}
            >
              Done
            </ActionPill>
          </span>
        )}
        {canEdit && m.status === "DONE" && (
          <div className="flex justify-end">
            <ActionPill
              variant="ghost"
              size="sm"
              icon={<RotateCcw size={14} />}
              onClick={() => onSave(m, { status: "PENDING" })}
            >
              Reopen
            </ActionPill>
          </div>
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
      .fetchAll({ limit: CUSTOMER_LIST_MAX_LIMIT })
      .then((r) => setBuyers(r.customers.map((c) => ({ id: c.id, firmName: c.firmName }))))
      .catch(() => {
        setBuyers([]);
        toast.error(CUSTOMER_LOAD_ERROR);
      });
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

  const lateCount = rows.filter((r) => r.rag === "RED").length;
  const riskCount = rows.filter((r) => r.rag === "AMBER").length;

  return (
    <PageBody>
      <PageHeader
        title="Order T&A"
        icon={<CalendarClock size={22} />}
        subtitle="Buyer order milestones counted back from the ex-factory date."
        meta={
          !loading && rows.length > 0 ? (
            <>
              {lateCount > 0 && (
                <Chip size="sm" tone="danger" dot>
                  {lateCount} late
                </Chip>
              )}
              {riskCount > 0 && (
                <Chip size="sm" tone="warning" dot>
                  {riskCount} at risk
                </Chip>
              )}
            </>
          ) : undefined
        }
        primaryAction={
          can("order-tna.create") ? (
            showForm ? (
              <ActionPill
                variant="secondary"
                icon={<X size={17} />}
                onClick={() => setShowForm(false)}
              >
                Close
              </ActionPill>
            ) : (
              <ActionPill icon={<Plus size={18} />} onClick={() => setShowForm(true)}>
                New T&amp;A plan
              </ActionPill>
            )
          ) : undefined
        }
      />

      {alerts.length > 0 && (
        <section
          aria-label="Alerts"
          className="sl-tile flex flex-wrap items-center gap-2 p-4"
          style={{ boxShadow: "inset 4px 0 0 var(--color-danger)" }}
        >
          <AlertTriangle
            size={18}
            className="shrink-0 text-[color:var(--color-danger)]"
            aria-hidden="true"
          />
          <strong className="mr-1 text-sm text-[color:var(--color-danger)]">Alerts:</strong>
          {alerts.slice(0, 8).map((a) => (
            <Chip
              key={a.milestoneId}
              tone={a.kind === "OVERDUE" ? "danger" : "warning"}
              onClick={() => void open(a.tnaId)}
            >
              {a.tnaNo} · {a.milestone} ·{" "}
              {a.kind === "OVERDUE" ? `${a.daysLate}d late` : `due ${day(a.plannedDate)}`}
            </Chip>
          ))}
          {alerts.length > 8 && (
            <span className="text-sm text-ink-muted">+{alerts.length - 8} more</span>
          )}
        </section>
      )}

      {showForm && (
        <Tile
          title="New T&A plan"
          subtitle="Milestones are generated from the template, counted back from ex-factory."
        >
          <form onSubmit={create} className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
            <div>
              <label htmlFor="tna-buyer" className="sl-label">
                Buyer
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id="tna-buyer"
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
            </div>
            <div>
              <label htmlFor="tna-po" className="sl-label">
                Buyer PO no.
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="tna-po"
                className={field}
                placeholder="Buyer PO no."
                value={form.buyerPoNo}
                onChange={(e) => setForm((f) => ({ ...f, buyerPoNo: e.target.value }))}
                required
              />
            </div>
            <div>
              <label htmlFor="tna-style" className="sl-label">
                Style ref
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="tna-style"
                className={field}
                placeholder="Style ref"
                value={form.styleRef}
                onChange={(e) => setForm((f) => ({ ...f, styleRef: e.target.value }))}
                required
              />
            </div>
            <div>
              <label htmlFor="tna-qty" className="sl-label">
                Order qty
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="tna-qty"
                className={`${field} tabular-nums`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="Order qty"
                value={form.orderQty}
                onChange={(e) => setForm((f) => ({ ...f, orderQty: e.target.value }))}
                required
              />
            </div>
            <div>
              <label htmlFor="tna-order-date" className="sl-label">
                Order date
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="tna-order-date"
                className={field}
                type="date"
                value={form.orderDate}
                onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
                required
              />
            </div>
            <div>
              <label htmlFor="tna-exf" className="sl-label">
                Ex-factory
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="tna-exf"
                className={field}
                type="date"
                value={form.exFactoryDate}
                onChange={(e) => setForm((f) => ({ ...f, exFactoryDate: e.target.value }))}
                required
              />
            </div>
            <div>
              <label htmlFor="tna-template" className="sl-label">
                Template
              </label>
              <select
                id="tna-template"
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
            </div>
            <div>
              <label htmlFor="tna-merch" className="sl-label">
                Merchandiser
              </label>
              <input
                id="tna-merch"
                className={field}
                placeholder="Merchandiser"
                value={form.merchandiser}
                onChange={(e) => setForm((f) => ({ ...f, merchandiser: e.target.value }))}
              />
            </div>
            <div className="flex items-end justify-end gap-2.5">
              <ActionPill variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </ActionPill>
              <ActionPill type="submit" icon={<Check size={17} />}>
                Create
              </ActionPill>
            </div>
          </form>
        </Tile>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Tile
            padding="none"
            divider
            title="Active orders"
            actions={
              <select
                className="sl-input h-10 w-auto max-w-[200px] pr-9 text-sm"
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
              <SkeletonRows rows={4} columns={3} header={false} />
            ) : rows.length === 0 ? (
              <EmptyState
                compact
                icon={<CalendarClock size={22} />}
                title="No active T&A plans yet."
                description={
                  can("order-tna.create")
                    ? "Create one from a buyer PO to track every milestone to ex-factory."
                    : undefined
                }
              />
            ) : (
              <ul className="m-0 list-none p-0" aria-label="Active T&A plans">
                {rows.map((r) => (
                  <li key={r.id} className="border-t border-line-soft first:border-t-0">
                    <button
                      type="button"
                      aria-pressed={selected?.id === r.id}
                      onClick={() => void open(r.id)}
                      className={cx(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                        selected?.id === r.id ? "bg-nav-active" : "hover:bg-card-2"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-accent">
                            {r.tnaNo}
                          </span>
                          <RagDot rag={r.rag} />
                        </div>
                        <div className="truncate text-sm font-medium text-ink">
                          {r.customerName ?? "—"}
                          <span className="text-ink-subtle"> · {r.styleRef}</span>
                        </div>
                        <div className="sl-muted text-[12px]">
                          Next: {r.nextMilestone ? r.nextMilestone.name : "—"}
                          {r.overdueCount > 0 && (
                            <span className="ml-1 font-semibold text-[color:var(--color-danger)]">
                              · {r.overdueCount} overdue
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[11px] font-medium text-ink-subtle">Ex-factory</div>
                        <div className="text-sm font-semibold text-ink tabular-nums">
                          {day(r.exFactoryDate)}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Tile>
        </div>

        <div className="lg:col-span-3">
          {selected ? (
            <Tile
              padding="none"
              divider
              title={`${selected.tnaNo} · ${selected.customerName ?? ""}`}
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-2">
                  <RagDot rag={selected.rag} /> PO {selected.buyerPoNo} ·{" "}
                  {formatQty(selected.orderQty)} {selected.uom ?? ""} · ex-factory{" "}
                  {day(selected.exFactoryDate)}
                </span>
              }
              actions={
                canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      className="sl-input h-10 w-[160px]"
                      value={newExFactory}
                      onChange={(e) => setNewExFactory(e.target.value)}
                      aria-label="Ex-factory date"
                    />
                    <ActionPill
                      variant="secondary"
                      size="sm"
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
                    </ActionPill>
                  </div>
                )
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full" aria-label="Milestones">
                  <thead className="bg-card-2">
                    <tr>
                      <th scope="col" className={th}>
                        #
                      </th>
                      <th scope="col" className={th}>
                        Milestone
                      </th>
                      <th scope="col" className={th}>
                        Planned
                      </th>
                      <th scope="col" className={th}>
                        Actual
                      </th>
                      <th scope="col" className={th}>
                        Status
                      </th>
                      <th scope="col" className={`${th} !text-right`}>
                        Delay
                      </th>
                      <th scope="col" className={th}>
                        <span className="sr-only">Actions</span>
                      </th>
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
            </Tile>
          ) : (
            <Tile title="Milestones">
              <EmptyState
                compact
                icon={<CalendarClock size={22} />}
                title="Pick an order to see its milestones."
              />
            </Tile>
          )}
        </div>
      </div>
    </PageBody>
  );
};

export default OrderTnaPage;
