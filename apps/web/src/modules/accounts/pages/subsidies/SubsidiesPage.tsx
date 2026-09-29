import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  AlarmClock,
  BadgeIndianRupee,
  ChevronRight,
  Download,
  Landmark,
  Plus,
  Zap,
} from "lucide-react";

import { usePermission } from "../../../../hooks/usePermission";
import {
  subsidySchemesService,
  type SchemeStatus,
  type SubsidyReminder,
  type SubsidyScheme,
  type SubsidySummary,
} from "../../../../services/subsidySchemesService";
import { message, money } from "../../../compliance/components/gstUi";
import {
  ActionPill,
  Chip,
  ChipTabs,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatTile,
  Tile,
} from "../../../../components/ui/v2";
import { ErrorTile, PageBody } from "../../../production/ui";
import { KIND_LABEL, SchemeForm, SchemeStatusChip, shortMoney } from "./subsidyUi";

/**
 * Subsidies & schemes (TN-10): what the company has been sanctioned under state and central
 * schemes, what it has claimed and received, and what is due to be claimed.
 */
type Filter = "ALL" | SchemeStatus;

const REMINDER_TONE = {
  danger: "danger",
  warning: "warning",
  info: "info",
} as const;

const RemindersTile: React.FC<{
  items: SubsidyReminder[];
  loading: boolean;
  onOpen: (schemeId: string) => void;
  title?: string;
}> = ({ items, loading, onOpen, title = "Reminders" }) => (
  <Tile
    padding="none"
    divider
    title={title}
    icon={<AlarmClock size={18} />}
    subtitle="Power subsidy months to claim and money slow to arrive"
    actions={
      items.length > 0 ? (
        <Chip size="sm" tone="warning">
          {items.length}
        </Chip>
      ) : undefined
    }
  >
    {loading ? (
      <SkeletonRows rows={3} columns={1} header={false} />
    ) : items.length === 0 ? (
      <EmptyState compact title="Nothing is waiting on you." description="All caught up." />
    ) : (
      <ul className="m-0 list-none p-0" aria-label="Subsidy reminders">
        {items.map((r, i) => (
          <li
            key={`${r.schemeId}-${r.type}-${r.claimId ?? i}`}
            className="border-t border-line-soft first:border-t-0"
          >
            <button
              type="button"
              onClick={() => onOpen(r.schemeId)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-card-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold text-accent">
                    {r.schemeCode}
                  </span>
                  <Chip size="sm" tone={REMINDER_TONE[r.severity]}>
                    {r.type === "LTPT_DUE"
                      ? "Claim due"
                      : r.type === "LTPT_MISSED"
                        ? "Missed"
                        : r.type === "PENDING_DISBURSEMENT"
                          ? "Unpaid"
                          : "Expiring"}
                  </Chip>
                </div>
                <p className="m-0 mt-1 text-sm text-ink">{r.message}</p>
              </div>
              {r.amount !== null && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {money(r.amount)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    )}
  </Tile>
);

const SubsidiesPage: React.FC = () => {
  const navigate = useNavigate();
  const { can } = usePermission();
  const canCreate = can("subsidy-schemes.create");
  const canExport = can("subsidy-schemes.export");

  const [summary, setSummary] = useState<SubsidySummary | null>(null);
  const [schemes, setSchemes] = useState<SubsidyScheme[]>([]);
  const [reminders, setReminders] = useState<SubsidyReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [s, l, r] = await Promise.all([
        subsidySchemesService.summary(),
        subsidySchemesService.list(),
        subsidySchemesService.reminders(),
      ]);
      setSummary(s);
      setSchemes(l);
      setReminders(r.items);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (filter === "ALL" ? schemes : schemes.filter((s) => s.status === filter)),
    [schemes, filter]
  );
  const count = (st: SchemeStatus) => schemes.filter((s) => s.status === st).length;
  const open = (id: string) => navigate(`/accounts/subsidies/${id}`);

  const exportCsv = async () => {
    try {
      await subsidySchemesService.downloadCsv();
    } catch (err) {
      toast.error(message(err));
    }
  };

  if (failed) {
    return (
      <PageBody>
        <ErrorTile onRetry={() => void load()} />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <PageHeader
        title="Subsidies & schemes"
        icon={<Landmark size={22} />}
        subtitle="Capital subsidy, LTPT power subsidy, interest subvention and every other scheme: sanctioned, claimed and received."
        actions={
          canExport ? (
            <ActionPill
              variant="secondary"
              icon={<Download size={16} />}
              onClick={() => void exportCsv()}
            >
              Export
            </ActionPill>
          ) : undefined
        }
        primaryAction={
          canCreate ? (
            <ActionPill icon={<Plus size={18} />} onClick={() => setAdding(true)}>
              Add scheme
            </ActionPill>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Sanctioned"
          value={shortMoney(summary?.sanctioned)}
          hint={`${summary?.schemes ?? 0} scheme${summary?.schemes === 1 ? "" : "s"}`}
          icon={<Landmark size={18} />}
          loading={loading}
        />
        <StatTile
          label="Claimed"
          value={shortMoney(summary?.claimed)}
          hint={
            summary?.drafted
              ? `${shortMoney(summary.drafted)} in drafts`
              : "Filed with the authority"
          }
          icon={<BadgeIndianRupee size={18} />}
          loading={loading}
        />
        <StatTile
          label="Received"
          value={shortMoney(summary?.received)}
          hint={
            summary?.shortfall ? `${shortMoney(summary.shortfall)} short of claims` : "In the bank"
          }
          loading={loading}
        />
        <StatTile
          label="Pending"
          value={shortMoney(summary?.pending)}
          hint="Filed, money not yet in"
          delta={summary?.reminderCount ? `${summary.reminderCount} reminders` : undefined}
          deltaTone="warning"
          loading={loading}
        />
      </div>

      {adding && (
        <SchemeForm
          scheme={null}
          defaults={summary?.defaults ?? null}
          verifyNote={summary?.verifyNote ?? ""}
          onCancel={() => setAdding(false)}
          onSubmit={async (body) => {
            try {
              const created = await subsidySchemesService.create(body);
              toast.success("Scheme added");
              setAdding(false);
              open(created.id);
            } catch (err) {
              toast.error(message(err));
            }
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tile padding="none" divider title="Schemes">
            <div className="px-4 pt-3 sm:px-5">
              <ChipTabs<Filter>
                ariaLabel="Scheme status"
                size="sm"
                value={filter}
                onChange={setFilter}
                items={[
                  { key: "ALL", label: "All", count: schemes.length },
                  { key: "APPLIED", label: "Applied", count: count("APPLIED") },
                  { key: "SANCTIONED", label: "Sanctioned", count: count("SANCTIONED") },
                  { key: "ACTIVE", label: "Active", count: count("ACTIVE") },
                  { key: "CLOSED", label: "Closed", count: count("CLOSED") },
                ]}
              />
            </div>
            {loading ? (
              <SkeletonRows rows={4} columns={4} header={false} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Landmark size={26} />}
                title={schemes.length ? "No scheme at this stage." : "No schemes yet."}
                description="Add the subsidies you have applied for or been sanctioned, and track every claim to the bank."
                action={
                  canCreate && !schemes.length ? (
                    <ActionPill icon={<Plus size={18} />} onClick={() => setAdding(true)}>
                      Add scheme
                    </ActionPill>
                  ) : undefined
                }
              />
            ) : (
              <ul className="m-0 mt-3 list-none p-0" aria-label="Subsidy schemes">
                {rows.map((s) => (
                  <li key={s.id} className="border-t border-line-soft">
                    <button
                      type="button"
                      onClick={() => open(s.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-card-2 sm:px-5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-accent">
                            {s.schemeCode}
                          </span>
                          <SchemeStatusChip status={s.status} />
                          <Chip
                            size="sm"
                            tone="muted"
                            icon={s.kind === "POWER_SUBSIDY_LTPT" ? <Zap size={12} /> : undefined}
                          >
                            {KIND_LABEL[s.kind]}
                          </Chip>
                          {s.ltptDueMonths > 0 && (
                            <Chip size="sm" tone="warning">
                              {s.ltptDueMonths} month{s.ltptDueMonths === 1 ? "" : "s"} to claim
                            </Chip>
                          )}
                          {s.ltptMissedMonths > 0 && (
                            <Chip size="sm" tone="danger">
                              {s.ltptMissedMonths} missed
                            </Chip>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-sm font-medium text-ink">{s.name}</div>
                        <div className="sl-muted truncate text-[12px]">
                          {[s.authority, s.sanctionOrderNo].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      <div className="hidden shrink-0 text-right sm:block">
                        <div className="text-[11px] font-medium text-ink-subtle">
                          Received / sanctioned
                        </div>
                        <div className="text-sm font-semibold tabular-nums text-ink">
                          {shortMoney(s.totals.disbursed)}
                          <span className="sl-muted font-normal">
                            {" "}
                            / {s.expected !== null ? shortMoney(s.expected) : "—"}
                          </span>
                        </div>
                      </div>
                      <ChevronRight
                        size={18}
                        className="shrink-0 text-ink-subtle"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Tile>
        </div>
        <div className="min-w-0">
          <RemindersTile items={reminders} loading={loading} onOpen={open} />
        </div>
      </div>
    </PageBody>
  );
};

export default SubsidiesPage;
