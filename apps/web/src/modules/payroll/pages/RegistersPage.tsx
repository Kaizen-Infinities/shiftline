import React, { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";

import {
  registersService,
  type AdvanceRow,
  type CeilingCheck,
  type FineDeductionRow,
  type MusterRoll,
  type OvertimeRow,
  type WagesRow,
} from "../../../services/registersService";
import {
  Card,
  day,
  field,
  message,
  money,
  monthOptions,
  primary,
  secondary,
  td,
  th,
} from "../../compliance/components/gstUi";

/**
 * The inspector's registers (P2-03): muster roll, wages, overtime, fines, deductions and
 * advances. Every number here is read from attendance and payroll runs already saved elsewhere —
 * this screen only shapes them into the form the Labour Codes ask a company to keep.
 */
type Register = "muster-roll" | "wages" | "overtime" | "fines" | "deductions" | "advances";

const REGISTERS: { value: Register; label: string; range: boolean }[] = [
  { value: "muster-roll", label: "Muster Roll", range: false },
  { value: "wages", label: "Register of Wages", range: false },
  { value: "overtime", label: "Register of Overtime", range: false },
  { value: "fines", label: "Register of Fines", range: true },
  { value: "deductions", label: "Register of Deductions", range: true },
  { value: "advances", label: "Register of Advances", range: true },
];

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthAgoIso = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

const RegistersPage: React.FC = () => {
  const [register, setRegister] = useState<Register>("muster-roll");
  const [month, setMonth] = useState(monthOptions(1)[0].value);
  const [from, setFrom] = useState(monthAgoIso());
  const [to, setTo] = useState(todayIso());
  const [businessPlaceId, setBusinessPlaceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [muster, setMuster] = useState<MusterRoll | null>(null);
  const [wages, setWages] = useState<WagesRow[]>([]);
  const [overtime, setOvertime] = useState<OvertimeRow[]>([]);
  const [fineRows, setFineRows] = useState<FineDeductionRow[]>([]);
  const [ceilingChecks, setCeilingChecks] = useState<CeilingCheck[]>([]);
  const [advanceRows, setAdvanceRows] = useState<AdvanceRow[]>([]);

  const bp = businessPlaceId.trim() || undefined;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (register === "muster-roll") setMuster(await registersService.musterRoll(month, bp));
      else if (register === "wages") setWages((await registersService.wages(month, bp)).rows);
      else if (register === "overtime")
        setOvertime((await registersService.overtime(month, bp)).rows);
      else if (register === "fines") {
        const r = await registersService.fines(from, to, bp);
        setFineRows(r.rows);
        setCeilingChecks(r.ceilingChecks);
      } else if (register === "deductions")
        setFineRows((await registersService.deductions(from, to, bp)).rows);
      else if (register === "advances")
        setAdvanceRows((await registersService.advances(from, to, bp)).rows);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [register, month, from, to, bp]);

  useEffect(() => {
    void load();
  }, [load]);

  const params = REGISTERS.find((r) => r.value === register)?.range
    ? { from, to, businessPlaceId: bp }
    : { month, businessPlaceId: bp };

  const exportAs = async (fmt: "csv" | "pdf") => {
    setBusy(true);
    try {
      if (fmt === "csv") await registersService.exportCsv(register, params);
      else await registersService.exportPdf(register, params);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
  };

  const isRange = REGISTERS.find((r) => r.value === register)?.range ?? false;

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold text-ink">Statutory Registers</h1>

      <Card
        title="Filters"
        actions={
          <div className="flex gap-2">
            <button className={secondary} disabled={busy} onClick={() => void exportAs("csv")}>
              Export CSV
            </button>
            <button className={primary} disabled={busy} onClick={() => void exportAs("pdf")}>
              Export PDF
            </button>
          </div>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Register
            <select
              className={field}
              value={register}
              onChange={(e) => setRegister(e.target.value as Register)}
            >
              {REGISTERS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          {isRange ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                From
                <input
                  type="date"
                  className={field}
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                To
                <input
                  type="date"
                  className={field}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-ink-muted">
              Month
              <input
                type="month"
                className={field}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Business place (optional)
            <input
              className={field}
              placeholder="Business place id"
              value={businessPlaceId}
              onChange={(e) => setBusinessPlaceId(e.target.value)}
            />
          </label>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          {register === "muster-roll" && muster && <MusterRollTable data={muster} />}
          {register === "wages" && <WagesTable rows={wages} />}
          {register === "overtime" && <OvertimeTable rows={overtime} />}
          {(register === "fines" || register === "deductions") && (
            <FineDeductionTable
              rows={fineRows}
              ceilingChecks={register === "fines" ? ceilingChecks : undefined}
            />
          )}
          {register === "advances" && <AdvancesTable rows={advanceRows} />}
        </>
      )}
    </div>
  );
};

const MusterRollTable: React.FC<{ data: MusterRoll }> = ({ data }) => (
  <Card title={`Muster Roll — ${data.month}`}>
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line-soft">
            <th className={th}>Code</th>
            <th className={th}>Name</th>
            {Array.from({ length: data.totalDays }, (_, i) => (
              <th key={i} className={`${th} text-center`}>
                {i + 1}
              </th>
            ))}
            <th className={th}>P</th>
            <th className={th}>A</th>
            <th className={th}>H</th>
            <th className={th}>L</th>
            <th className={th}>WO</th>
            <th className={th}>OT</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.employeeId} className="border-t border-line-soft">
              <td className={td}>{r.employeeCode}</td>
              <td className={td}>{r.employeeName}</td>
              {r.days.map((d, i) => (
                <td key={i} className={`${td} text-center`}>
                  {d.code ?? "-"}
                  {d.otHours > 0 ? `(${d.otHours})` : ""}
                </td>
              ))}
              <td className={`${td} text-center`}>{r.totals.present}</td>
              <td className={`${td} text-center`}>{r.totals.absent}</td>
              <td className={`${td} text-center`}>{r.totals.halfDay}</td>
              <td className={`${td} text-center`}>{r.totals.leave}</td>
              <td className={`${td} text-center`}>{r.totals.weekOff}</td>
              <td className={`${td} text-center`}>{r.totals.otHours}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td className={td} colSpan={data.totalDays + 8}>
                No employees found for this month.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);

const WagesTable: React.FC<{ rows: WagesRow[] }> = ({ rows }) => (
  <Card title="Register of Wages">
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line-soft">
            {[
              "Code",
              "Name",
              "Days",
              "Rate",
              "Basic",
              "Allowances",
              "OT Wages",
              "Gross",
              "PF",
              "ESI",
              "PT",
              "TDS",
              "Fines",
              "Advances",
              "Others",
              "Net",
              "Mode",
              "Paid On",
            ].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className="border-t border-line-soft">
              <td className={td}>{r.employeeCode}</td>
              <td className={td}>{r.employeeName}</td>
              <td className={`${td} text-right`}>{r.daysWorked}</td>
              <td className={`${td} text-right`}>{money(r.rate)}</td>
              <td className={`${td} text-right`}>{money(r.basic)}</td>
              <td className={`${td} text-right`}>{money(r.allowances)}</td>
              <td className={`${td} text-right`}>{money(r.otWages)}</td>
              <td className={`${td} text-right`}>{money(r.gross)}</td>
              <td className={`${td} text-right`}>{money(r.pf)}</td>
              <td className={`${td} text-right`}>{money(r.esi)}</td>
              <td className={`${td} text-right`}>{money(r.professionalTax)}</td>
              <td className={`${td} text-right`}>{money(r.tds)}</td>
              <td className={`${td} text-right`}>{money(r.fines)}</td>
              <td className={`${td} text-right`}>{money(r.advancesRecovered)}</td>
              <td className={`${td} text-right`}>{money(r.others)}</td>
              <td className={`${td} text-right`}>{money(r.net)}</td>
              <td className={td}>{r.paymentMode}</td>
              <td className={td}>{day(r.paymentDate)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className={td} colSpan={18}>
                No payroll results found for this month.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);

const OvertimeTable: React.FC<{ rows: OvertimeRow[] }> = ({ rows }) => (
  <Card title="Register of Overtime">
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line-soft">
            {[
              "Code",
              "Name",
              "Date",
              "OT Hours",
              "Normal Rate",
              "OT Rate",
              "OT Wages",
              "Quarter Hours",
              "Cap",
              "Over Cap",
              "Quarterly Breach",
            ].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.employeeId}-${r.date}-${i}`} className="border-t border-line-soft">
              <td className={td}>{r.employeeCode}</td>
              <td className={td}>{r.employeeName}</td>
              <td className={td}>{day(r.date)}</td>
              <td className={`${td} text-right`}>{r.otHours}</td>
              <td className={`${td} text-right`}>{money(r.normalRate)}</td>
              <td className={`${td} text-right`}>{money(r.otRate)}</td>
              <td className={`${td} text-right`}>{money(r.otWages)}</td>
              <td className={`${td} text-right`}>{r.cumulativeQuarterHours}</td>
              <td className={`${td} text-right`}>{r.quarterlyCap}</td>
              <td className={`${td} text-center`}>{r.overCap ? "Yes" : ""}</td>
              <td
                className={`${td} text-center ${
                  r.payrollBreach ? "bg-red-50 font-semibold text-red-700" : ""
                }`}
                title={r.payrollBreach ? "Quarterly cap of 125 hours exceeded" : undefined}
              >
                {r.payrollBreach ? "Yes" : ""}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className={td} colSpan={11}>
                No overtime recorded for this month.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);

const FineDeductionTable: React.FC<{
  rows: FineDeductionRow[];
  ceilingChecks?: CeilingCheck[];
}> = ({ rows, ceilingChecks }) => (
  <>
    <Card title="Entries">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line-soft">
              {["Code", "Name", "Date", "Act/Omission", "Amount", "Shown Cause"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line-soft">
                <td className={td}>{r.employeeCode}</td>
                <td className={td}>{r.employeeName}</td>
                <td className={td}>{day(r.date)}</td>
                <td className={td}>{r.cause}</td>
                <td className={`${td} text-right`}>{money(r.amount)}</td>
                <td className={`${td} text-center`}>{r.shownCauseGiven ? "Yes" : "No"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className={td} colSpan={6}>
                  No entries in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
    {ceilingChecks && ceilingChecks.length > 0 && (
      <Card title="3% Ceiling Check (Payment of Wages Act s.8)">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-line-soft">
                {["Code", "Month", "Total Fines", "3% Ceiling", "Breach"].map((h) => (
                  <th key={h} className={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ceilingChecks.map((c, i) => (
                <tr key={i} className={`border-t border-line-soft ${c.breach ? "bg-rose-50" : ""}`}>
                  <td className={td}>{c.employeeCode}</td>
                  <td className={td}>{c.month}</td>
                  <td className={`${td} text-right`}>{money(c.totalFines)}</td>
                  <td className={`${td} text-right`}>
                    {c.wageCeiling === null ? "—" : money(c.wageCeiling)}
                  </td>
                  <td className={`${td} text-center`}>
                    {c.breach === null ? "—" : c.breach ? "Breach" : "OK"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    )}
  </>
);

const AdvancesTable: React.FC<{ rows: AdvanceRow[] }> = ({ rows }) => (
  <Card title="Register of Advances">
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line-soft">
            {["Code", "Name", "Date", "Amount", "Purpose", "Recovered", "Balance", "Status"].map(
              (h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line-soft">
              <td className={td}>{r.employeeCode}</td>
              <td className={td}>{r.employeeName}</td>
              <td className={td}>{day(r.date)}</td>
              <td className={`${td} text-right`}>{money(r.amount)}</td>
              <td className={td}>{r.purpose}</td>
              <td className={`${td} text-right`}>{money(r.recoveredToDate)}</td>
              <td className={`${td} text-right`}>{money(r.balance)}</td>
              <td className={td}>{r.status}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className={td} colSpan={8}>
                No advances in this range.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </Card>
);

export default RegistersPage;
