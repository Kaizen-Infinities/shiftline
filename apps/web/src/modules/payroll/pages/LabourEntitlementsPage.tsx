import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import { usePermission } from "../../../hooks/usePermission";
import {
  labourService,
  type BonusReport,
  type GratuityReport,
  type HolidayRow,
  type LeaveBalanceRow,
  type LeaveTypeRow,
  type SettlementRow,
} from "../../../services/labourService";
import { Umbrella } from "lucide-react";
import { ChipTabs, PageHeader, SkeletonTile } from "../../../components/ui/v2";
import {
  Card,
  PageShell,
  num,
  day,
  field,
  fyOptions,
  message,
  money,
  primary,
  secondary,
  success,
  td,
  th,
} from "../components/peopleUi";

/**
 * Leave, gratuity, bonus and settlements (P1-17b).
 *
 * Everything on this screen is money the company owes and would not otherwise see: leave that has
 * accrued, gratuity that has been building since somebody's fifth year, the bonus the Act
 * requires. The gratuity tab values everyone still employed as if they left today, because that
 * is the liability — not the amount somebody has asked for.
 */
type Tab = "leave" | "gratuity" | "bonus" | "settlements" | "holidays";
const STATUS_STYLE: Record<SettlementRow["status"], string> = {
  DRAFT:
    "bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] text-[color:var(--color-warning)]",
  APPROVED: "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-accent",
  PAID: "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-[color:var(--color-success)]",
  CANCELLED: "bg-card-2 text-ink",
};

const LabourEntitlementsPage: React.FC = () => {
  const { can } = usePermission();
  const years = useMemo(() => fyOptions(3), []);
  const [tab, setTab] = useState<Tab>("leave");
  const [fyCode, setFyCode] = useState(years[0].value);
  const [balances, setBalances] = useState<LeaveBalanceRow[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeRow[]>([]);
  const [gratuity, setGratuity] = useState<GratuityReport | null>(null);
  const [bonus, setBonus] = useState<BonusReport | null>(null);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "leave") {
        setBalances(await labourService.balances(fyCode));
        setLeaveTypes(await labourService.leaveTypes(true));
      }
      if (tab === "gratuity") setGratuity(await labourService.gratuity());
      if (tab === "bonus") setBonus(await labourService.bonus(fyCode));
      if (tab === "settlements") setSettlements(await labourService.settlements());
      if (tab === "holidays") setHolidays(await labourService.holidays(fyCode));
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [tab, fyCode]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggleAllowNegative = (t: LeaveTypeRow) =>
    act(
      () =>
        labourService.saveLeaveType({
          code: t.code,
          name: t.name,
          daysPerYear: Number(t.daysPerYear),
          basis: t.basis,
          daysWorkedPerDay: t.daysWorkedPerDay,
          carryForwardMax: Number(t.carryForwardMax),
          encashable: t.encashable,
          isActive: t.isActive,
          allowNegative: !t.allowNegative,
        }),
      t.allowNegative ? "Leave without pay turned off" : "Leave without pay allowed"
    );

  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      await load();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Leave and Entitlements"
        icon={<Umbrella size={20} />}
        breadcrumbs={[{ label: "Payroll", to: "/payroll" }, { label: "Entitlements" }]}
        subtitle="What the company owes rather than what it deducts: leave accrued, gratuity building since the fifth year, the statutory bonus, and what is settled when someone leaves."
        actions={
          <>
            <select
              className={field}
              value={fyCode}
              onChange={(e) => setFyCode(e.target.value)}
              aria-label="Financial year"
            >
              {years.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </select>
            {tab === "leave" && can("payroll-settings.edit") && (
              <button
                className={secondary}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const out = await labourService.closeLeaveYear(fyCode);
                    toast.info(`${out.lapsedDays} day(s) lapsed at the carry-forward cap`);
                  }, "Year closed")
                }
              >
                Close the leave year
              </button>
            )}
          </>
        }
      >
        <ChipTabs
          ariaLabel="Entitlements"
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          items={[
            { key: "leave", label: "Leave" },
            { key: "gratuity", label: "Gratuity" },
            { key: "bonus", label: "Bonus" },
            { key: "settlements", label: "Settlements" },
            { key: "holidays", label: "Holidays" },
          ]}
        />
      </PageHeader>

      {loading && <SkeletonTile lines={4} label="Loading entitlements" />}

      {tab === "leave" && (
        <Card title="Leave types">
          <p className="sl-muted m-0 mb-4 text-sm">
            "Leave without pay allowed" lets a request against this type take an employee's balance
            negative instead of being refused for insufficient leave.
          </p>
          <div className="overflow-x-auto rounded-[14px] border border-line-soft">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Code</th>
                  <th className={th}>Name</th>
                  <th className={`${th} text-right`}>Days/year</th>
                  <th className={th}>Leave without pay allowed</th>
                </tr>
              </thead>
              <tbody>
                {leaveTypes.map((t) => (
                  <tr key={t.id} className="border-t border-line-soft">
                    <td className={td}>{t.code}</td>
                    <td className={td}>{t.name}</td>
                    <td className={`${td} ${num}`}>{Number(t.daysPerYear)}</td>
                    <td className={td}>
                      {can("payroll-settings.edit") ? (
                        <button
                          className={t.allowNegative ? success : secondary}
                          disabled={busy}
                          onClick={() => void toggleAllowNegative(t)}
                        >
                          {t.allowNegative ? "Allowed" : "Not allowed"}
                        </button>
                      ) : (
                        <span>{t.allowNegative ? "Allowed" : "Not allowed"}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {leaveTypes.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={4}>
                      No leave types configured yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "leave" && (
        <Card title={`Leave balances · FY ${fyCode}`}>
          <p className="sl-muted m-0 mb-4 text-sm">
            Earned leave accrues on days actually worked — one day for every twenty — and is the
            only kind that can be encashed. What is over the carry-forward cap lapses when the year
            is closed.
          </p>
          <div className="overflow-x-auto rounded-[14px] border border-line-soft">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Employee</th>
                  <th className={th}>Leave</th>
                  <th className={`${th} text-right`}>Opening</th>
                  <th className={`${th} text-right`}>Accrued</th>
                  <th className={`${th} text-right`}>Taken</th>
                  <th className={`${th} text-right`}>Lapsed</th>
                  <th className={`${th} text-right`}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.id} className="border-t border-line-soft">
                    <td className={td}>{b.employeeId}</td>
                    <td className={td}>
                      {b.leaveType.name}
                      {b.leaveType.encashable && (
                        <div className="text-xs text-ink-muted">encashable</div>
                      )}
                    </td>
                    <td className={`${td} ${num}`}>{Number(b.opening)}</td>
                    <td className={`${td} ${num}`}>{Number(b.accrued)}</td>
                    <td className={`${td} ${num}`}>{Number(b.taken)}</td>
                    <td className={`${td} ${num}`}>{Number(b.lapsed)}</td>
                    <td className={`${td} text-right font-semibold`}>{Number(b.closing)}</td>
                  </tr>
                ))}
                {balances.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={7}>
                      No leave has been accrued for this year yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "gratuity" && gratuity && (
        <>
          <Card title={`Gratuity carried at ${gratuity.asOn}`}>
            <p className="text-2xl font-semibold text-ink">{money(gratuity.total)}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {gratuity.eligible} of {gratuity.employees} employees have passed five years. This is
              the liability whether or not anyone has resigned — a company that computes gratuity
              only on resignation is carrying an unrecorded one.
            </p>
          </Card>
          <Card title="By employee">
            <div className="overflow-x-auto rounded-[14px] border border-line-soft">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className={th}>Employee</th>
                    <th className={th}>Joined</th>
                    <th className={`${th} text-right`}>Years</th>
                    <th className={`${th} text-right`}>Counted</th>
                    <th className={`${th} text-right`}>Last wage</th>
                    <th className={`${th} text-right`}>Gratuity</th>
                  </tr>
                </thead>
                <tbody>
                  {gratuity.rows.map((r) => (
                    <tr key={r.employeeCode} className="border-t border-line-soft">
                      <td className={td}>
                        {r.employeeName}
                        <div className="text-xs text-ink-muted">{r.employeeCode}</div>
                      </td>
                      <td className={td}>{r.joinedOn ? day(r.joinedOn) : "—"}</td>
                      <td className={`${td} ${num}`}>{r.serviceYears}</td>
                      <td className={`${td} ${num}`}>{r.countedYears}</td>
                      <td className={`${td} ${num}`}>{money(r.lastDrawnWage)}</td>
                      <td className={`${td} text-right font-semibold`}>
                        {r.eligible ? money(r.amount) : "—"}
                        {r.cappedAtCeiling && (
                          <div className="text-xs text-ink-muted">at the ceiling</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "bonus" && bonus && (
        <Card title={`Statutory bonus · FY ${bonus.fyCode}`}>
          <p className="sl-muted m-0 mb-4 text-sm">
            {bonus.eligible} employee(s) are eligible, at {bonus.percent}%, for a total of{" "}
            {money(bonus.total)}. The bonus is worked out on ₹7,000 a month (or the minimum wage
            where that is higher), not on what the employee actually earns — computing it on the
            real wage overstates the liability nearly threefold.
          </p>
          <div className="overflow-x-auto rounded-[14px] border border-line-soft">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Employee</th>
                  <th className={`${th} text-right`}>Wage</th>
                  <th className={`${th} text-right`}>Computed on</th>
                  <th className={`${th} text-right`}>Percent</th>
                  <th className={`${th} text-right`}>Bonus</th>
                </tr>
              </thead>
              <tbody>
                {bonus.rows.map((r) => (
                  <tr key={r.employeeCode} className="border-t border-line-soft">
                    <td className={td}>
                      {r.employeeName}
                      <div className="text-xs text-ink-muted">{r.employeeCode}</div>
                    </td>
                    <td className={`${td} ${num}`}>{money(r.monthlyWage)}</td>
                    <td className={`${td} ${num}`}>{money(r.calculationWage)}</td>
                    <td className={`${td} ${num}`}>{r.percent}%</td>
                    <td className={`${td} text-right font-semibold`}>{money(r.amount)}</td>
                  </tr>
                ))}
                {bonus.rows.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={5}>
                      Nobody is under the ₹21,000 eligibility wage.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "settlements" && (
        <Card title="Full and final settlements">
          <div className="overflow-x-auto rounded-[14px] border border-line-soft">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Employee</th>
                  <th className={th}>Left on</th>
                  <th className={`${th} text-right`}>Salary</th>
                  <th className={`${th} text-right`}>Encashment</th>
                  <th className={`${th} text-right`}>Gratuity</th>
                  <th className={`${th} text-right`}>Recoveries</th>
                  <th className={`${th} text-right`}>Net</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id} className="border-t border-line-soft">
                    <td className={td}>{s.employeeCode}</td>
                    <td className={td}>{day(s.lastWorkingDay)}</td>
                    <td className={`${td} ${num}`}>{money(s.salaryDue)}</td>
                    <td className={`${td} ${num}`}>{money(s.leaveEncashment)}</td>
                    <td className={`${td} ${num}`}>{money(s.gratuity)}</td>
                    <td className={`${td} ${num}`}>
                      {money(Number(s.noticeRecovery) + Number(s.advanceRecovery))}
                    </td>
                    <td
                      className={`${td} text-right font-semibold ${
                        Number(s.netPayable) < 0 ? "text-[color:var(--color-danger)]" : ""
                      }`}
                    >
                      {money(s.netPayable)}
                    </td>
                    <td className={td}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[s.status]}`}
                      >
                        {s.status.toLowerCase()}
                      </span>
                    </td>
                    <td className={`${td} ${num}`}>
                      {s.status === "DRAFT" && can("payroll-run.edit") && (
                        <button
                          className={success}
                          disabled={busy}
                          onClick={() =>
                            act(() => labourService.approveSettlement(s.id), "Approved and posted")
                          }
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {settlements.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={9}>
                      Nobody has left.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "holidays" && (
        <Card
          title={`Holidays · FY ${fyCode}`}
          actions={
            can("payroll-settings.edit") && (
              <button
                className={primary}
                disabled={busy}
                onClick={() => {
                  const name = window.prompt("What is the holiday called?");
                  if (!name) return;
                  const on = window.prompt("On what date? (YYYY-MM-DD)");
                  if (!on) return;
                  void act(() => labourService.addHoliday({ holidayOn: on, name }), "Added");
                }}
              >
                Add a holiday
              </button>
            )
          }
        >
          <div className="overflow-x-auto rounded-[14px] border border-line-soft">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={th}>Holiday</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Paid</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.id} className="border-t border-line-soft">
                    <td className={td}>{day(h.holidayOn)}</td>
                    <td className={td}>{h.name}</td>
                    <td className={td}>{h.kind.toLowerCase()}</td>
                    <td className={td}>{h.isPaid ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {holidays.length === 0 && !loading && (
                  <tr>
                    <td className={`${td} text-ink-muted`} colSpan={4}>
                      No holidays listed for this year.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageShell>
  );
};

export default LabourEntitlementsPage;
