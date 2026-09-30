import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Ban, Check, ClipboardCheck, FilePlus2, Flag, Play, Plus, ShieldCheck } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import {
  AREA_LABEL,
  STANDARD_LABEL,
  buyerAuditsService,
  type ActionOwner,
  type ActionStatus,
  type AuditDetail,
  type CorrectiveAction,
  type Finding,
  type FindingArea,
  type Severity,
} from "../../../services/buyerAuditsService";
import {
  ActionPill,
  Chip,
  EmptyState,
  PageHeader,
  SkeletonTile,
  Tile,
  cx,
  type ChipTone,
} from "../../../components/ui/v2";
import { PageBody } from "../../production/ui";
import { errorMessage, formatDay } from "../components/peopleUi";
import { AUDIT_STATUS_LABEL, AUDIT_STATUS_TONE } from "../components/auditUi";

/**
 * One buyer audit (TN-08): its dates and grade, the findings the auditor raised and the
 * corrective action against each, which only moves forward (open → in progress → done →
 * verified) and needs evidence to close.
 */
const SEVERITY_TONE: Record<Severity, ChipTone> = {
  CRITICAL: "danger",
  MAJOR: "warning",
  MINOR: "info",
  OBSERVATION: "muted",
};
const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: "Critical",
  MAJOR: "Major",
  MINOR: "Minor",
  OBSERVATION: "Observation",
};
const ACTION_TONE: Record<ActionStatus, ChipTone> = {
  OPEN: "muted",
  IN_PROGRESS: "info",
  DONE: "success",
  VERIFIED: "success",
};
const ACTION_LABEL: Record<ActionStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  VERIFIED: "Verified",
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const field = "sl-input h-11";

const Figure: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-[12px] font-medium text-ink-subtle">{label}</div>
    <div className="text-sm font-semibold text-ink">{value}</div>
  </div>
);

const ActionItem: React.FC<{
  a: CorrectiveAction;
  canEdit: boolean;
  onMove: (a: CorrectiveAction, body: { status: ActionStatus; evidenceNote?: string }) => void;
}> = ({ a, canEdit, onMove }) => {
  const [closing, setClosing] = useState(false);
  const [evidence, setEvidence] = useState(a.evidenceNote ?? "");
  return (
    <li className="border-t border-line-soft py-3 first:border-t-0">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">{a.action}</div>
          <div className="sl-muted text-[12px]">
            {a.ownerName ?? "—"} · due{" "}
            <span className={cx(a.overdue && "font-semibold text-[color:var(--color-danger)]")}>
              {formatDay(a.dueDate)}
            </span>
            {a.closedOn && ` · closed ${formatDay(a.closedOn)}`}
          </div>
          {a.evidenceNote && (
            <div className="mt-1 text-[12px] text-ink-muted">Evidence: {a.evidenceNote}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {a.overdue && (
            <Chip size="sm" tone="danger" dot>
              Overdue
            </Chip>
          )}
          {a.dueSoon && (
            <Chip size="sm" tone="warning" dot>
              Due soon
            </Chip>
          )}
          <Chip size="sm" tone={ACTION_TONE[a.status]} dot>
            {ACTION_LABEL[a.status]}
          </Chip>
          {canEdit && a.status === "OPEN" && (
            <ActionPill
              size="sm"
              variant="secondary"
              icon={<Play size={14} />}
              onClick={() => onMove(a, { status: "IN_PROGRESS" })}
            >
              Start
            </ActionPill>
          )}
          {canEdit && (a.status === "OPEN" || a.status === "IN_PROGRESS") && !closing && (
            <ActionPill
              size="sm"
              variant="secondary"
              icon={<Check size={14} />}
              onClick={() => setClosing(true)}
            >
              Mark done
            </ActionPill>
          )}
          {canEdit && a.status === "DONE" && (
            <ActionPill
              size="sm"
              variant="blue"
              icon={<ShieldCheck size={14} />}
              onClick={() => onMove(a, { status: "VERIFIED" })}
            >
              Verify
            </ActionPill>
          )}
        </div>
      </div>
      {closing && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onMove(a, { status: "DONE", evidenceNote: evidence.trim() });
          }}
        >
          <input
            className="sl-input h-10 min-w-[220px] flex-1 text-sm"
            placeholder="Evidence (e.g. new rota, signed OT register, photo ref.)"
            aria-label="Evidence"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            maxLength={1000}
            required
          />
          <ActionPill size="sm" type="submit" icon={<Check size={14} />}>
            Close action
          </ActionPill>
          <ActionPill size="sm" variant="ghost" onClick={() => setClosing(false)}>
            Cancel
          </ActionPill>
        </form>
      )}
    </li>
  );
};

const AddAction: React.FC<{
  owners: ActionOwner[];
  onAdd: (body: {
    action: string;
    ownerUserId?: string;
    ownerEmployeeId?: string;
    dueDate: string;
  }) => Promise<boolean>;
}> = ({ owners, onAdd }) => {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  if (!open) {
    return (
      <ActionPill size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setOpen(true)}>
        Corrective action
      </ActionPill>
    );
  }
  return (
    <form
      className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_200px_160px_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        const [kind, id] = owner.split(":");
        const ok = await onAdd({
          action: action.trim(),
          dueDate: due,
          ...(kind === "USER" ? { ownerUserId: id } : { ownerEmployeeId: id }),
        });
        if (ok) {
          setAction("");
          setOwner("");
          setDue("");
          setOpen(false);
        }
      }}
    >
      <input
        className="sl-input h-10 text-sm"
        placeholder="What will be done"
        aria-label="Corrective action"
        value={action}
        onChange={(e) => setAction(e.target.value)}
        maxLength={500}
        required
      />
      <select
        className="sl-input h-10 text-sm"
        aria-label="Owner"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        required
      >
        <option value="">Owner</option>
        <optgroup label="Users">
          {owners
            .filter((o) => o.kind === "USER")
            .map((o) => (
              <option key={`u${o.id}`} value={`USER:${o.id}`}>
                {o.name}
              </option>
            ))}
        </optgroup>
        <optgroup label="Employees">
          {owners
            .filter((o) => o.kind === "EMPLOYEE")
            .map((o) => (
              <option key={`e${o.id}`} value={`EMPLOYEE:${o.id}`}>
                {o.name}
              </option>
            ))}
        </optgroup>
      </select>
      <input
        type="date"
        className="sl-input h-10 text-sm"
        aria-label="Due date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        required
      />
      <span className="flex gap-1.5">
        <ActionPill size="sm" type="submit" icon={<Check size={14} />}>
          Add
        </ActionPill>
        <ActionPill size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </ActionPill>
      </span>
    </form>
  );
};

const FindingTile: React.FC<{
  f: Finding;
  canEdit: boolean;
  owners: ActionOwner[];
  onMove: (a: CorrectiveAction, body: { status: ActionStatus; evidenceNote?: string }) => void;
  onAdd: (
    f: Finding,
    body: { action: string; ownerUserId?: string; ownerEmployeeId?: string; dueDate: string }
  ) => Promise<boolean>;
}> = ({ f, canEdit, owners, onMove, onAdd }) => (
  <li className="sl-tile p-4 sm:p-5">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-semibold tabular-nums text-ink-subtle">#{f.seq}</span>
      <Chip size="sm" tone={SEVERITY_TONE[f.severity]}>
        {SEVERITY_LABEL[f.severity]}
      </Chip>
      <Chip size="sm" tone="default">
        {AREA_LABEL[f.area]}
      </Chip>
      {f.clauseRef && <span className="font-mono text-[12px] text-ink-muted">{f.clauseRef}</span>}
      <span className="ml-auto">
        <Chip size="sm" dot tone={f.open ? "warning" : "success"}>
          {f.open ? "Open" : "Closed"}
        </Chip>
      </span>
    </div>
    <p className="m-0 mt-2 text-sm text-ink">{f.description}</p>
    {f.actions.length > 0 && (
      <ul className="m-0 mt-2 list-none p-0" aria-label={`Corrective actions for finding ${f.seq}`}>
        {f.actions.map((a) => (
          <ActionItem key={`${a.id}-${a.status}`} a={a} canEdit={canEdit} onMove={onMove} />
        ))}
      </ul>
    )}
    {canEdit && (
      <div className="mt-2">
        <AddAction owners={owners} onAdd={(body) => onAdd(f, body)} />
      </div>
    )}
  </li>
);

const emptyFinding = {
  area: "WORKING_HOURS" as FindingArea,
  severity: "MAJOR" as Severity,
  clauseRef: "",
  description: "",
};

const BuyerAuditDetailPage: React.FC = () => {
  const { id = "" } = useParams();
  const { can } = usePermission();
  const canEdit = can("buyer-audits.edit");
  const [audit, setAudit] = useState<AuditDetail | null>(null);
  const [owners, setOwners] = useState<ActionOwner[]>([]);
  const [finding, setFinding] = useState(emptyFinding);
  const [showFinding, setShowFinding] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completion, setCompletion] = useState({ actualDate: todayIso(), rating: "", next: "" });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setAudit(await buyerAuditsService.get(id));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canEdit) return;
    buyerAuditsService
      .owners()
      .then(setOwners)
      .catch(() => setOwners([]));
  }, [canEdit]);

  const run = async (fn: () => Promise<AuditDetail>, ok: string): Promise<boolean> => {
    try {
      setAudit(await fn());
      toast.success(ok);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  };

  if (!audit) {
    return (
      <PageBody>
        <PageHeader title="Buyer audit" back="/hr/audit-readiness" />
        <SkeletonTile />
      </PageBody>
    );
  }

  const live = audit.status === "PLANNED" || audit.status === "IN_PROGRESS";
  const editable = canEdit && audit.status !== "CANCELLED";

  return (
    <PageBody>
      <PageHeader
        title={`${STANDARD_LABEL[audit.standard]} · ${audit.auditNo}`}
        back="/hr/audit-readiness"
        backLabel="Audit readiness"
        icon={<ClipboardCheck size={22} />}
        subtitle={[audit.customerName ?? "No buyer", audit.auditorFirm].filter(Boolean).join(" · ")}
        meta={
          <>
            <Chip size="sm" dot tone={AUDIT_STATUS_TONE[audit.status]}>
              {AUDIT_STATUS_LABEL[audit.status]}
            </Chip>
            {audit.overdueActions > 0 && (
              <Chip size="sm" tone="danger" dot>
                {audit.overdueActions} overdue
              </Chip>
            )}
          </>
        }
        actions={
          canEdit && live ? (
            <ActionPill
              variant="ghost"
              icon={<Ban size={16} />}
              onClick={() => setCancelling((c) => !c)}
            >
              Cancel audit
            </ActionPill>
          ) : undefined
        }
        primaryAction={
          canEdit && audit.status === "PLANNED" ? (
            <ActionPill
              icon={<Play size={17} />}
              onClick={() =>
                void run(
                  () => buyerAuditsService.update(audit.id, { status: "IN_PROGRESS" }),
                  "Audit started"
                )
              }
            >
              Start audit
            </ActionPill>
          ) : canEdit && audit.status === "IN_PROGRESS" ? (
            <ActionPill icon={<Flag size={17} />} onClick={() => setCompleting(true)}>
              Complete audit
            </ActionPill>
          ) : undefined
        }
      />

      {cancelling && (
        <Tile title="Cancel this audit" subtitle="It is kept with the reason; nothing is deleted.">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run(
                  () => buyerAuditsService.cancel(audit.id, reason.trim()),
                  "Audit cancelled"
                )
              )
                setCancelling(false);
            }}
          >
            <input
              className="sl-input h-11 min-w-[240px] flex-1"
              placeholder="Why is the audit cancelled?"
              aria-label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              required
            />
            <ActionPill type="submit" variant="danger" icon={<Ban size={16} />}>
              Cancel audit
            </ActionPill>
          </form>
        </Tile>
      )}

      {completing && (
        <Tile title="Complete the audit" subtitle="Record when it took place and the grade given.">
          <form
            className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(
                () =>
                  buyerAuditsService.update(audit.id, {
                    status: "COMPLETED",
                    actualDate: completion.actualDate,
                    ...(completion.rating.trim() ? { rating: completion.rating.trim() } : {}),
                    ...(completion.next ? { nextAuditDue: completion.next } : {}),
                  }),
                "Audit completed"
              );
              if (ok) setCompleting(false);
            }}
          >
            <div>
              <label htmlFor="ba-actual" className="sl-label">
                Audit date
              </label>
              <input
                id="ba-actual"
                type="date"
                className={field}
                max={todayIso()}
                value={completion.actualDate}
                onChange={(e) => setCompletion((c) => ({ ...c, actualDate: e.target.value }))}
                required
              />
            </div>
            <div>
              <label htmlFor="ba-rating" className="sl-label">
                Rating / grade
              </label>
              <input
                id="ba-rating"
                className={field}
                placeholder="e.g. B, Gold, Pass"
                value={completion.rating}
                onChange={(e) => setCompletion((c) => ({ ...c, rating: e.target.value }))}
                maxLength={40}
              />
            </div>
            <div>
              <label htmlFor="ba-next-due" className="sl-label">
                Next audit due
              </label>
              <input
                id="ba-next-due"
                type="date"
                className={field}
                value={completion.next}
                onChange={(e) => setCompletion((c) => ({ ...c, next: e.target.value }))}
              />
            </div>
            <div className="flex items-end justify-end gap-2">
              <ActionPill variant="secondary" onClick={() => setCompleting(false)}>
                Cancel
              </ActionPill>
              <ActionPill type="submit" icon={<Check size={17} />}>
                Complete
              </ActionPill>
            </div>
          </form>
        </Tile>
      )}

      <Tile>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Figure label="Scheduled" value={formatDay(audit.scheduledDate)} />
          <Figure label="Took place" value={formatDay(audit.actualDate)} />
          <Figure label="Rating" value={audit.rating ?? "—"} />
          <Figure label="Next audit due" value={formatDay(audit.nextAuditDue)} />
          <Figure
            label="Open findings"
            value={
              <span className="flex flex-wrap gap-1">
                {(["CRITICAL", "MAJOR", "MINOR"] as Severity[]).map((s) => (
                  <Chip
                    key={s}
                    size="sm"
                    tone={audit.openFindings[s] > 0 ? SEVERITY_TONE[s] : "muted"}
                  >
                    {audit.openFindings[s]} {SEVERITY_LABEL[s].toLowerCase()}
                  </Chip>
                ))}
              </span>
            }
          />
        </div>
        {audit.cancelReason && (
          <p className="sl-muted m-0 mt-3 text-sm">Cancelled: {audit.cancelReason}</p>
        )}
      </Tile>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="sl-h2 m-0">Findings</h2>
        {editable && !showFinding && (
          <ActionPill
            variant="secondary"
            icon={<FilePlus2 size={16} />}
            onClick={() => setShowFinding(true)}
          >
            Add finding
          </ActionPill>
        )}
      </div>

      {showFinding && (
        <Tile title="New finding">
          <form
            className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await run(
                () =>
                  buyerAuditsService.addFinding(audit.id, {
                    area: finding.area,
                    severity: finding.severity,
                    description: finding.description.trim(),
                    ...(finding.clauseRef.trim() ? { clauseRef: finding.clauseRef.trim() } : {}),
                  }),
                "Finding recorded"
              );
              if (ok) {
                setFinding(emptyFinding);
                setShowFinding(false);
              }
            }}
          >
            <div>
              <label htmlFor="bf-area" className="sl-label">
                Area
              </label>
              <select
                id="bf-area"
                className={field}
                value={finding.area}
                onChange={(e) => setFinding((f) => ({ ...f, area: e.target.value as FindingArea }))}
              >
                {(Object.keys(AREA_LABEL) as FindingArea[]).map((a) => (
                  <option key={a} value={a}>
                    {AREA_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="bf-sev" className="sl-label">
                Severity
              </label>
              <select
                id="bf-sev"
                className={field}
                value={finding.severity}
                onChange={(e) =>
                  setFinding((f) => ({ ...f, severity: e.target.value as Severity }))
                }
              >
                {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="bf-clause" className="sl-label">
                Clause
              </label>
              <input
                id="bf-clause"
                className={field}
                placeholder="e.g. PA 6.2"
                value={finding.clauseRef}
                onChange={(e) => setFinding((f) => ({ ...f, clauseRef: e.target.value }))}
                maxLength={40}
              />
            </div>
            <div className="md:col-span-3">
              <label htmlFor="bf-desc" className="sl-label">
                What the auditor found
                <span className="sl-required" aria-hidden="true">
                  *
                </span>
              </label>
              <textarea
                id="bf-desc"
                className="sl-input min-h-[88px] py-2"
                value={finding.description}
                onChange={(e) => setFinding((f) => ({ ...f, description: e.target.value }))}
                maxLength={1000}
                required
              />
            </div>
            <div className="flex justify-end gap-2 md:col-span-3">
              <ActionPill variant="secondary" onClick={() => setShowFinding(false)}>
                Cancel
              </ActionPill>
              <ActionPill type="submit" icon={<Check size={17} />}>
                Record finding
              </ActionPill>
            </div>
          </form>
        </Tile>
      )}

      {audit.findings.length === 0 ? (
        <Tile>
          <EmptyState
            compact
            icon={<ClipboardCheck size={22} />}
            title="No findings recorded."
            description={
              editable
                ? "Add each non-compliance the auditor raises at the closing meeting."
                : undefined
            }
          />
        </Tile>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Findings">
          {audit.findings.map((f) => (
            <FindingTile
              key={f.id}
              f={f}
              canEdit={editable}
              owners={owners}
              onMove={(a, body) =>
                void run(
                  () => buyerAuditsService.updateAction(audit.id, a.id, body),
                  body.status === "VERIFIED" ? "Action verified" : "Action updated"
                )
              }
              onAdd={(fi, body) =>
                run(
                  () => buyerAuditsService.addAction(audit.id, fi.id, body),
                  "Corrective action added"
                )
              }
            />
          ))}
        </ul>
      )}
    </PageBody>
  );
};

export default BuyerAuditDetailPage;
