import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { Check, Plus, Truck, X } from "lucide-react";

import { usePermission } from "../../../hooks/usePermission";
import { customerService } from "../../../services/customerService";
import {
  projectJobsService,
  type JobRow,
  type JobStatus,
  type StagePlan,
} from "../../../services/projectJobsService";
import { day, message } from "../../compliance/components/gstUi";
import {
  ActionPill,
  EmptyState,
  PageHeader,
  SkeletonRows,
  Tile,
  Toolbar,
  type ToolbarFilter,
} from "../../../components/ui/v2";
import { PageBody, formatINR } from "../ui";
import { todayIso } from "./projectJobsFormat";
import { JobProgress, JobStatusChip, MarginChip } from "./projectJobsUi";

/**
 * Job / project costing (TN-09): every body-building or fabrication job with its quote,
 * cost to date, margin and progress through the stage plan.
 */
type Filter = "OPEN" | JobStatus | "ALL";

const th = "sl-th px-3 py-3 text-left";
const td = "px-3 py-3 text-sm text-ink align-middle";
const field = "sl-input h-11";

const emptyForm = {
  jobNo: "",
  customerId: "",
  title: "",
  quotedAmount: "",
  quoteDate: todayIso(),
  targetDate: "",
  chassisNo: "",
  chassisMake: "",
  chassisReceivedOn: "",
  conditionNotes: "",
  stagePlan: "BODY_BUILDING",
};

const Label: React.FC<{ htmlFor: string; children: React.ReactNode; required?: boolean }> = ({
  htmlFor,
  children,
  required,
}) => (
  <label htmlFor={htmlFor} className="sl-label">
    {children}
    {required && (
      <span className="sl-required" aria-hidden="true">
        *
      </span>
    )}
  </label>
);

const ProjectJobsPage: React.FC = () => {
  const { can } = usePermission();
  const navigate = useNavigate();
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [plans, setPlans] = useState<StagePlan[]>([]);
  const [customers, setCustomers] = useState<{ id: string; firmName: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await projectJobsService.list());
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showForm) return;
    projectJobsService
      .stagePlans()
      .then(setPlans)
      .catch(() => setPlans([]));
    customerService
      .fetchAll({ limit: 200 })
      .then((r) => setCustomers(r.customers.map((c) => ({ id: c.id, firmName: c.firmName }))))
      .catch(() => setCustomers([]));
  }, [showForm]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      OPEN: 0,
      ALL: rows.length,
      QUOTED: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };
    for (const r of rows) {
      c[r.status] += 1;
      if (r.status === "QUOTED" || r.status === "IN_PROGRESS" || r.status === "COMPLETED") {
        c.OPEN += 1;
      }
    }
    return c;
  }, [rows]);

  const filters: ToolbarFilter<Filter>[] = [
    { key: "OPEN", label: "Open", count: counts.OPEN },
    { key: "QUOTED", label: "Quoted", count: counts.QUOTED },
    { key: "IN_PROGRESS", label: "In progress", count: counts.IN_PROGRESS },
    { key: "COMPLETED", label: "Completed", count: counts.COMPLETED },
    { key: "DELIVERED", label: "Delivered", count: counts.DELIVERED },
    { key: "CANCELLED", label: "Cancelled", count: counts.CANCELLED },
    { key: "ALL", label: "All", count: counts.ALL },
  ];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const statusOk =
        filter === "ALL"
          ? true
          : filter === "OPEN"
            ? r.status === "QUOTED" || r.status === "IN_PROGRESS" || r.status === "COMPLETED"
            : r.status === filter;
      if (!statusOk) return false;
      if (!q) return true;
      return [r.jobNo, r.title, r.customerName, r.chassisNo, r.chassisMake]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const opt = (v: string) => (v.trim() ? v.trim() : undefined);
      const job = await projectJobsService.create({
        jobNo: form.jobNo.trim(),
        customerId: form.customerId,
        title: form.title.trim(),
        quotedAmount: Number(form.quotedAmount),
        quoteDate: form.quoteDate,
        targetDate: opt(form.targetDate),
        chassisNo: opt(form.chassisNo),
        chassisMake: opt(form.chassisMake),
        chassisReceivedOn: opt(form.chassisReceivedOn),
        conditionNotes: opt(form.conditionNotes),
        stagePlan: form.stagePlan,
      });
      toast.success("Job created");
      setForm(emptyForm);
      setShowForm(false);
      navigate(`/production/jobs/${job.id}`);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSaving(false);
    }
  };

  const set =
    (k: keyof typeof emptyForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <PageBody>
      <PageHeader
        title="Jobs"
        icon={<Truck size={22} />}
        subtitle="Cost each body-building or fabrication job against its quote, stage by stage."
        primaryAction={
          can("project-jobs.create") ? (
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
                New job
              </ActionPill>
            )
          ) : undefined
        }
      />

      {showForm && (
        <Tile
          title="New job"
          subtitle="The stage plan is created with the job; you can add and reorder stages later."
        >
          <form onSubmit={create} className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
            <div>
              <Label htmlFor="job-no" required>
                Job no.
              </Label>
              <input
                id="job-no"
                className={field}
                value={form.jobNo}
                onChange={set("jobNo")}
                maxLength={30}
                required
              />
            </div>
            <div>
              <Label htmlFor="job-customer" required>
                Customer
              </Label>
              <select
                id="job-customer"
                className={field}
                value={form.customerId}
                onChange={set("customerId")}
                required
              >
                <option value="">Pick a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firmName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="job-plan">Stage plan</Label>
              <select
                id="job-plan"
                className={field}
                value={form.stagePlan}
                onChange={set("stagePlan")}
              >
                {plans.length === 0 && <option value="BODY_BUILDING">Truck body building</option>}
                {plans.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="job-title" required>
                Title
              </Label>
              <input
                id="job-title"
                className={field}
                placeholder="Tipper body on Tata 2518 chassis"
                value={form.title}
                onChange={set("title")}
                maxLength={120}
                required
              />
            </div>
            <div>
              <Label htmlFor="job-quote" required>
                Quoted amount (₹)
              </Label>
              <input
                id="job-quote"
                className={`${field} tabular-nums`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={form.quotedAmount}
                onChange={set("quotedAmount")}
                required
              />
            </div>
            <div>
              <Label htmlFor="job-quote-date" required>
                Quote date
              </Label>
              <input
                id="job-quote-date"
                className={field}
                type="date"
                value={form.quoteDate}
                onChange={set("quoteDate")}
                required
              />
            </div>
            <div>
              <Label htmlFor="job-target">Target date</Label>
              <input
                id="job-target"
                className={field}
                type="date"
                value={form.targetDate}
                onChange={set("targetDate")}
              />
            </div>
            <div aria-hidden="true" className="hidden md:block" />
            <p className="sl-section-label m-0 md:col-span-3">
              Customer&apos;s chassis / material in custody
            </p>
            <div>
              <Label htmlFor="job-chassis">Chassis no.</Label>
              <input
                id="job-chassis"
                className={field}
                value={form.chassisNo}
                onChange={set("chassisNo")}
                maxLength={40}
              />
            </div>
            <div>
              <Label htmlFor="job-make">Make / model</Label>
              <input
                id="job-make"
                className={field}
                placeholder="Tata Signa 2518"
                value={form.chassisMake}
                onChange={set("chassisMake")}
                maxLength={80}
              />
            </div>
            <div>
              <Label htmlFor="job-received">Received on</Label>
              <input
                id="job-received"
                className={field}
                type="date"
                value={form.chassisReceivedOn}
                onChange={set("chassisReceivedOn")}
              />
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="job-condition">Condition on arrival</Label>
              <textarea
                id="job-condition"
                className="sl-input min-h-[72px] py-2"
                value={form.conditionNotes}
                onChange={set("conditionNotes")}
                maxLength={500}
              />
            </div>
            <div className="flex items-end justify-end gap-2.5 md:col-span-3">
              <ActionPill variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </ActionPill>
              <ActionPill type="submit" icon={<Check size={17} />} disabled={saving}>
                Create job
              </ActionPill>
            </div>
          </form>
        </Tile>
      )}

      <Toolbar<Filter>
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search job, customer or chassis…"
        searchLabel="Search jobs"
        filters={filters}
        filterValue={filter}
        onFilterChange={setFilter}
        filtersLabel="Job status"
      />

      <Tile padding="none">
        {loading ? (
          <SkeletonRows rows={5} columns={6} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Truck size={22} />}
            title={rows.length === 0 ? "No jobs yet." : "No jobs match this filter."}
            description={
              rows.length === 0 && can("project-jobs.create")
                ? "Open a job for each body or fabrication order to see its real margin."
                : undefined
            }
            action={
              rows.length === 0 && can("project-jobs.create") ? (
                <ActionPill icon={<Plus size={18} />} onClick={() => setShowForm(true)}>
                  New job
                </ActionPill>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]" aria-label="Jobs">
              <thead className="bg-card-2">
                <tr>
                  <th scope="col" className={th}>
                    Job
                  </th>
                  <th scope="col" className={th}>
                    Customer
                  </th>
                  <th scope="col" className={th}>
                    Status
                  </th>
                  <th scope="col" className={`${th} w-[150px]`}>
                    Progress
                  </th>
                  <th scope="col" className={`${th} !text-right`}>
                    Quoted
                  </th>
                  <th scope="col" className={`${th} !text-right`}>
                    Cost to date
                  </th>
                  <th scope="col" className={th}>
                    Margin
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-line-soft hover:bg-card-2"
                    onClick={() => navigate(`/production/jobs/${r.id}`)}
                  >
                    <td className={td}>
                      <button
                        type="button"
                        className="font-mono text-[13px] font-semibold text-accent hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/production/jobs/${r.id}`);
                        }}
                      >
                        {r.jobNo}
                      </button>
                      <div className="max-w-[260px] truncate text-[13px] text-ink-muted">
                        {r.title}
                      </div>
                    </td>
                    <td className={td}>
                      <div className="font-medium">{r.customerName ?? "—"}</div>
                      <div className="text-[12px] text-ink-subtle">
                        {r.chassisNo
                          ? `Chassis ${r.chassisNo}`
                          : r.targetDate
                            ? `Due ${day(r.targetDate)}`
                            : ""}
                      </div>
                    </td>
                    <td className={td}>
                      <JobStatusChip status={r.status} />
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <JobProgress
                          pct={r.summary.percentComplete}
                          label={`${r.jobNo} progress`}
                          className="flex-1"
                        />
                        <span className="w-10 text-right text-[12px] tabular-nums text-ink-muted">
                          {Math.round(r.summary.percentComplete)}%
                        </span>
                      </div>
                      <div className="truncate text-[12px] text-ink-subtle">
                        {r.currentStage ?? "—"}
                      </div>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {formatINR(r.summary.quoted)}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {formatINR(r.summary.costToDate)}
                    </td>
                    <td className={td}>
                      <MarginChip summary={r.summary} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tile>
    </PageBody>
  );
};

export default ProjectJobsPage;
