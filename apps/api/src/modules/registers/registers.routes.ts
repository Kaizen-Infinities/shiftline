import { Router, type Request, type Response } from "express";

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { registersService } from "./registers.service";
import { toCsv, toHtml, toPdf, type RegisterColumn } from "./registers.export";
import { monthQuery, rangeQuery } from "./registers.validation";

/**
 * /api/registers (P2-03): the muster roll, wages, overtime, fines, deductions and advances
 * registers a labour inspector asks for. Read-only — every number here is read from persisted
 * attendance and payroll results, never computed.
 */
const router = Router();
router.use(authMiddleware);

const MUSTER_TOTAL_COLUMNS: RegisterColumn[] = [
  { key: "present", label: "Present" },
  { key: "absent", label: "Absent" },
  { key: "halfDay", label: "Half Day" },
  { key: "leave", label: "Leave" },
  { key: "weekOff", label: "Week Off" },
  { key: "otHours", label: "OT Hours" },
];

/** Sends json, csv or a rendered pdf for one register, given its columns and flat rows. */
async function respond(
  res: Response,
  format: "json" | "csv" | "pdf",
  opts: {
    title: string;
    subtitle: string;
    columns: RegisterColumn[];
    rows: Array<Record<string, unknown>>;
    json: unknown;
    fileStem: string;
  }
) {
  if (format === "csv") {
    const csv = toCsv(opts.columns, opts.rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${opts.fileStem}.csv"`);
    res.send(csv);
    return;
  }
  if (format === "pdf") {
    const html = toHtml({
      title: opts.title,
      subtitle: opts.subtitle,
      columns: opts.columns,
      rows: opts.rows,
    });
    const pdf = await toPdf(html);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${opts.fileStem}.pdf"`);
    res.send(pdf);
    return;
  }
  res.json(new ApiResponse(opts.title, opts.json));
}

// ── 1. Muster roll ────────────────────────────────────────────────────────────
router.get(
  "/muster-roll",
  requirePermission("registers.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = monthQuery.parse(req.query);
    if (q.format !== "json") requirePermissionInline(req, "registers.export");
    const data = await registersService.musterRoll(q.month, q.businessPlaceId);

    const dayColumns: RegisterColumn[] = Array.from({ length: data.totalDays }, (_, i) => ({
      key: `d${i + 1}`,
      label: String(i + 1),
    }));
    const columns: RegisterColumn[] = [
      { key: "employeeCode", label: "Code" },
      { key: "employeeName", label: "Name" },
      { key: "department", label: "Department" },
      { key: "designation", label: "Designation" },
      ...dayColumns,
      ...MUSTER_TOTAL_COLUMNS,
    ];
    const flatRows = data.rows.map((r) => {
      const flat: Record<string, unknown> = {
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        department: r.department,
        designation: r.designation,
        present: r.totals.present,
        absent: r.totals.absent,
        halfDay: r.totals.halfDay,
        leave: r.totals.leave,
        weekOff: r.totals.weekOff,
        otHours: r.totals.otHours,
      };
      r.days.forEach((d, i) => {
        flat[`d${i + 1}`] = d.otHours > 0 ? `${d.code ?? ""}${d.otHours}` : (d.code ?? "");
      });
      return flat;
    });

    await respond(res, q.format, {
      title: "Muster Roll",
      subtitle: q.month,
      columns,
      rows: flatRows,
      json: data,
      fileStem: `muster-roll-${q.month}`,
    });
  })
);

// ── 2. Wages register ────────────────────────────────────────────────────────
const WAGES_COLUMNS: RegisterColumn[] = [
  { key: "employeeCode", label: "Code" },
  { key: "employeeName", label: "Name" },
  { key: "designation", label: "Designation" },
  { key: "daysWorked", label: "Days Worked" },
  { key: "rate", label: "Daily Rate" },
  { key: "basic", label: "Basic" },
  { key: "allowances", label: "Allowances" },
  { key: "otWages", label: "OT Wages" },
  { key: "gross", label: "Gross" },
  { key: "pf", label: "PF" },
  { key: "esi", label: "ESI" },
  { key: "professionalTax", label: "PT" },
  { key: "tds", label: "TDS" },
  { key: "fines", label: "Fines" },
  { key: "advancesRecovered", label: "Advances Recovered" },
  { key: "others", label: "Other Deductions" },
  { key: "net", label: "Net" },
  { key: "paymentMode", label: "Mode" },
  { key: "paymentDate", label: "Payment Date" },
];

router.get(
  "/wages",
  requirePermission("registers.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = monthQuery.parse(req.query);
    if (q.format !== "json") requirePermissionInline(req, "registers.export");
    const data = await registersService.wages(q.month, q.businessPlaceId);
    await respond(res, q.format, {
      title: "Register of Wages",
      subtitle: q.month,
      columns: WAGES_COLUMNS,
      rows: data.rows,
      json: data,
      fileStem: `wages-${q.month}`,
    });
  })
);

// ── 3. Overtime register ─────────────────────────────────────────────────────
const OT_COLUMNS: RegisterColumn[] = [
  { key: "employeeCode", label: "Code" },
  { key: "employeeName", label: "Name" },
  { key: "date", label: "Date" },
  { key: "otHours", label: "OT Hours" },
  { key: "normalRate", label: "Normal Rate/hr" },
  { key: "otRate", label: "OT Rate/hr" },
  { key: "otWages", label: "OT Wages" },
  { key: "cumulativeQuarterHours", label: "Quarter Cumulative Hours" },
  { key: "quarterlyCap", label: "Quarterly Cap" },
  { key: "overCap", label: "Over Cap" },
];

router.get(
  "/overtime",
  requirePermission("registers.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = monthQuery.parse(req.query);
    if (q.format !== "json") requirePermissionInline(req, "registers.export");
    const data = await registersService.overtime(q.month, q.businessPlaceId);
    await respond(res, q.format, {
      title: "Register of Overtime",
      subtitle: q.month,
      columns: OT_COLUMNS,
      rows: data.rows,
      json: data,
      fileStem: `overtime-${q.month}`,
    });
  })
);

// ── 4/5. Fines and deductions ────────────────────────────────────────────────
const FINE_COLUMNS: RegisterColumn[] = [
  { key: "employeeCode", label: "Code" },
  { key: "employeeName", label: "Name" },
  { key: "date", label: "Date" },
  { key: "cause", label: "Act/Omission" },
  { key: "amount", label: "Amount" },
  { key: "shownCauseGiven", label: "Shown Cause" },
  { key: "recovered", label: "Recovered" },
];

router.get(
  "/fines",
  requirePermission("registers.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = rangeQuery.parse(req.query);
    if (q.format !== "json") requirePermissionInline(req, "registers.export");
    const data = await registersService.fines(q.from, q.to, q.businessPlaceId);
    await respond(res, q.format, {
      title: "Register of Fines",
      subtitle: `${q.from} to ${q.to}`,
      columns: FINE_COLUMNS,
      rows: data.rows,
      json: data,
      fileStem: `fines-${q.from}-to-${q.to}`,
    });
  })
);

router.get(
  "/deductions",
  requirePermission("registers.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = rangeQuery.parse(req.query);
    if (q.format !== "json") requirePermissionInline(req, "registers.export");
    const data = await registersService.deductions(q.from, q.to, q.businessPlaceId);
    await respond(res, q.format, {
      title: "Register of Deductions for Damage or Loss",
      subtitle: `${q.from} to ${q.to}`,
      columns: FINE_COLUMNS,
      rows: data.rows,
      json: data,
      fileStem: `deductions-${q.from}-to-${q.to}`,
    });
  })
);

// ── 6. Advances register ─────────────────────────────────────────────────────
const ADVANCE_COLUMNS: RegisterColumn[] = [
  { key: "employeeCode", label: "Code" },
  { key: "employeeName", label: "Name" },
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "purpose", label: "Purpose" },
  { key: "recoveredToDate", label: "Recovered To Date" },
  { key: "balance", label: "Balance" },
];

router.get(
  "/advances",
  requirePermission("registers.view"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = rangeQuery.parse(req.query);
    if (q.format !== "json") requirePermissionInline(req, "registers.export");
    const data = await registersService.advances(q.from, q.to, q.businessPlaceId);
    await respond(res, q.format, {
      title: "Register of Advances",
      subtitle: `${q.from} to ${q.to}`,
      columns: ADVANCE_COLUMNS,
      rows: data.rows,
      json: data,
      fileStem: `advances-${q.from}-to-${q.to}`,
    });
  })
);

/** requirePermission is middleware-shaped; a csv/pdf request needs the export permission too,
 *  checked inline since the format is only known after the query string is parsed. */
function requirePermissionInline(req: Request, key: string) {
  const perms = req.user?.permissions;
  if (req.user?.isSuperAdmin) return;
  if (!Array.isArray(perms) || !perms.includes(key)) {
    throw new ApiError(403, `Access Denied: "${key}" permission required`);
  }
}

export default router;
