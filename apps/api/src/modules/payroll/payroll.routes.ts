import { Router } from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { requireAnyPermission, requirePermission } from "../../middleware/permission.middleware";
import { validateMiddleware } from "../../middleware/validate.middleware";
import { payrollController } from "./payroll.controller";
import {
  updatePayrollConfigSchema,
  upsertEmployeePayrollSchema,
  bulkUpsertAttendanceSchema,
  getAttendanceSchema,
  createPayrollRunSchema,
  runActionSchema,
  listRunsSchema,
  createAdvanceSchema,
} from "./payroll.validation";

import { requireFeature } from "../../middleware/feature.middleware";
const router = Router();

// Shared reads (employee list, config, attendance) feed every payroll screen, so any payroll
// view key opens them; writes and the run lifecycle each need their own key.
const anyPayrollView = requireAnyPermission(
  "payroll.view",
  "payroll-run.view",
  "payroll-settings.view",
  "payroll-attendance.view",
  "payroll-advance.view"
);

// All payroll routes require authentication
router.use(authMiddleware);
// Payroll is a plan feature (P1-01); every route also needs a payroll permission key.
router.use(requireFeature("payroll"));

// ─── Payroll Config ───────────────────────────────────────────────────────────
router.get("/config", anyPayrollView, payrollController.getConfig);
router.put(
  "/config",
  requirePermission("payroll-settings.edit"),
  validateMiddleware(updatePayrollConfigSchema),
  payrollController.updateConfig
);

// ─── Employee Payroll ─────────────────────────────────────────────────────────
router.get("/employees", anyPayrollView, payrollController.listEmployees);
router.get("/employees/:employeeId/config", anyPayrollView, payrollController.getEmployeeConfig);
router.put(
  "/employees/:employeeId/config",
  requirePermission("payroll-settings.edit"),
  validateMiddleware(upsertEmployeePayrollSchema),
  payrollController.upsertEmployeeConfig
);

// ─── Attendance ───────────────────────────────────────────────────────────────
router.get(
  "/attendance",
  anyPayrollView,
  validateMiddleware(getAttendanceSchema),
  payrollController.getAttendance
);
router.post(
  "/attendance",
  requirePermission("payroll-attendance.edit"),
  validateMiddleware(bulkUpsertAttendanceSchema),
  payrollController.bulkUpsertAttendance
);

// ─── Payroll Runs ─────────────────────────────────────────────────────────────
router.get(
  "/runs",
  requireAnyPermission("payroll.view", "payroll-run.view", "payroll-attendance.view"),
  validateMiddleware(listRunsSchema),
  payrollController.listRuns
);
router.post(
  "/runs",
  requirePermission("payroll-run.create"),
  validateMiddleware(createPayrollRunSchema),
  payrollController.computeRun
);
router.get(
  "/runs/:id",
  requirePermission("payroll-run.view"),
  validateMiddleware(runActionSchema),
  payrollController.getRun
);
router.get(
  "/runs/:id/payslip/:resultId",
  requirePermission("payroll-run.view"),
  payrollController.getPayslip
);
router.post(
  "/runs/:id/approve",
  requirePermission("payroll-run.edit"),
  validateMiddleware(runActionSchema),
  payrollController.approveRun
);
router.post(
  "/runs/:id/lock",
  requirePermission("payroll-run.edit"),
  validateMiddleware(runActionSchema),
  payrollController.lockRun
);
router.delete(
  "/runs/:id",
  requirePermission("payroll-run.delete"),
  validateMiddleware(runActionSchema),
  payrollController.deleteRun
);

// ─── Salary Advances ──────────────────────────────────────────────────────────
router.get(
  "/advances",
  requireAnyPermission("payroll-advance.view", "payroll-run.view"),
  payrollController.listAdvances
);
router.post(
  "/advances",
  requirePermission("payroll-advance.create"),
  validateMiddleware(createAdvanceSchema),
  payrollController.createAdvance
);
router.delete(
  "/advances/:id",
  requirePermission("payroll-advance.delete"),
  payrollController.deleteAdvance
);

export default router;
