Research note, 2026-09-14, generated for the Phase 2 plan; assumptions on legal values must be verified by the tenant's accountant/consultant.

# HRMS / People domain — research report

## 1. Inventory

### Prisma models (apps/api/prisma/schema.prisma)

- `Employee` (line 10) — big master, sections for identity/contact/family/docs/address/official/
  joining/shift/payroll. `companyId` default-scoped, `@@unique` codes not shown for empCode (check —
  no `@@unique([companyId, empCode])` visible near declaration; worth confirming before relying on
  code uniqueness).
- `Department` (419) — minimal: name, description. No cost-centre link, no head-of-department,
  no location.
- `Shift` (918) — shiftCode/shiftName, start/end time as `String` (not `Time`), break/grace as `Int`
  minutes. Linked to production models (DailyProductionPlan, HourlyProduction, etc.) as well as
  Employee/AttendanceRecord — shift is shared between HR and shopfloor scheduling.
- `AttendanceRecord` (3239) — one row per employee/date/period, status as free `String`, `otHours`,
  `lateMinutes`, `permissionMinutes`, `salaryAdvance`. No punch-in/out timestamps, no source
  (manual/device), no geolocation. `@@unique([employeeId, date])` — note no `period` in the unique
  key even though `period` is a column, and no `companyId` in the unique key (relies on employeeId
  scoping already being tenant-safe via FK, but see quality note below).
- `EmployeePayrollConfig` (3263), `PayrollConfig` (3291, singleton per company), `PayrollRun` (3336),
  `PayrollResult` (3366) — the Phase-0 payroll engine: OT slabs, PF/ESI as flat company-wide %, LOP,
  late-entry deduction, cash-in-hand split.
- `SalaryAdvance` (3415) — employee advance, `status` string, `recoveredAmount`. No repayment
  schedule/instalments, no link to which payroll run recovered how much.
- `EmployeePermanentDeduction` (3434) — recurring deduction (loan EMI, uniform, etc.), generic
  type/label/amount, `isActive`.
- `StatutoryRule` (5193), `PayrollStatutory` (5222), `EmployeeTaxDeclaration` (5271) — P1-16
  statutory payroll (PF/ESI/PT/LWF/TDS split), seeded for 6 states.
- `Holiday` (5312), `LeaveType` (5331), `LeaveBalance` (5361), `FinalSettlement` (5386) — P1-17b
  Labour Code entitlements (leave register, gratuity/bonus computed but not persisted per-run,
  settlement voucher).
- `AdvanceReceipt`/`AdvanceAdjustment` (4165/4213) — these are **customer** advances (P1-14,
  `modules/advances`), not salary advances; do not confuse with `SalaryAdvance`. Cross-domain, not
  really HRMS.
- `Expense` (2104) — a generic vendor/business expense-claim model (P1-10d) with GST/TDS fields and
  an approver; it has **no `employeeId`**, so it cannot represent "employee paid out of pocket,
  claim reimbursement" — it is vendor-invoice shaped, not an employee expense claim.
- No models at all for: contract labour/contractor master, training/skills, safety incidents,
  recruitment/onboarding pipeline, biometric/attendance-device integration, muster roll/inspector
  registers (data exists in attendance+payroll but no register model/report), employee documents
  repository (beyond a few string fields), leave _requests_ (only a running balance, no application/
  approval workflow), disciplinary/fines register.

### API modules (apps/api/src/modules/)

- `employee/` — CRUD (`employee.controller/service/validation.ts`, `employee.routes.ts`).
- `department/` — CRUD.
- `shift/` — CRUD (shared with shopfloor).
- `payroll/` — `payroll.service.ts` (1415 lines, core engine: attendance→OT→PF/ESI/LOP→net),
  `statutory.calc.ts` + `statutory.service.ts` + `statutory.files.ts` + `statutory.routes.ts`
  (P1-16: ECR, ESIC file, PT challan, bank transfer file, journal), `labour.calc.ts` +
  `labour.service.ts` + `labour.routes.ts` (P1-17b: OT-under-Codes, gratuity, bonus, leave accrual,
  settlement).
- `advances/` — **customer** advances (P1-14), not salary advances; salary advance CRUD lives
  inside `payroll.service.ts`/`payroll.controller.ts` via `SalaryAdvance`.
- `entitlements/` — thin (`entitlement.service.ts` 130 lines, single GET route) — appears to be a
  read-only summary layer, separate from `payroll/labour.*` which does the real Labour Code work;
  worth checking for overlap/confusion between `modules/entitlements` and `modules/payroll/labour.*`.
- `filings/` — generic filing-approval gate (`filing-approval.service.ts`) used by `PF_ECR`,
  `ESI_MONTHLY`, `PT_RETURN`, `TDS_24Q`, `PAYROLL_RUN` filing types; registry + approve/reject/mark-filed
  endpoints.
- `users/`, `role/`, `permissions/` — platform IAM, not HR-specific but govern who can touch HR data.
- `mobile/` — field-sales/visit sync app (customer visits, orders, OCR); **no employee self-service
  surface** (no punch-in, no leave application, no payslip view) despite being the natural place
  for one.

### Web screens (apps/web/src/modules/, routed in AppRoutes.tsx)

- `/departments`, `/employees` (+ create/view/edit), `/shifts` (+ create/edit), `/shift-execution`
  (shopfloor board, permission `shift-execution.view`).
- `/payroll`, `/payroll/run`, `/payroll/settings`, `/payroll/attendance`, `/payroll/advance`,
  `/payroll/monthly-report`, `/payroll/weekly-report`, `/payroll/statutory`, `/payroll/entitlements`
  (5 tabs per handoff: leave/gratuity/bonus/settlement/registers-shaped, though registers themselves
  are not written per the handoff "half-done" list).
- No dedicated leave-application screen, no employee self-service portal, no org-chart/department
  hierarchy view, no contractor/training/safety screens (no backing modules).

### Permission keys (packages/shared/src/permissions.ts)

`employees.*`, `shifts.*`, `machine-assignments.*` (shared with production), `departments.*`,
`payroll.*`, `payroll-run.*`, `payroll-settings.*`, `payroll-attendance.*`, `payroll-advance.*`,
`payroll-extended-comp.*` (view/export only — presumably statutory/entitlements?), `filings.*`,
`users.*`, `roles.*`, `permissions.*`, `role-permissions.*`, `profile.*`. No permission keys exist
for entitlements/labour/statutory specifically — check whether `/payroll/statutory` and
`/payroll/entitlements` routes are actually gated by `payroll.view` broadly rather than a scoped key
(AppRoutes.tsx line ~620 gates both under `payroll.view`), which is looser than the module's own
sensitivity (PF/ESI numbers, tax declarations) warrants.

### Tests (apps/api/test/integration/)

Present: `advances.spec.ts` (customer advances, not salary), `entitlements.spec.ts`,
`filings.spec.ts`, `labour-code.spec.ts` (21 unit + 8 integration per handoff), `statutory-payroll.spec.ts`
(19 unit + 8 integration), `mobile.spec.ts`.
**Missing entirely**: no `employee.spec.ts`, `department.spec.ts`, `shift.spec.ts`, `payroll.spec.ts`
(the core Phase-0 engine — attendance, OT, LOP, salary advance CRUD) or `attendance.spec.ts`. These
are the oldest, most business-critical HR modules and have zero integration-test coverage visible in
the suite — a real quality gap given the repo's own "Definition of done" requires cross-tenant tests
for every module.

### Quality issues noticed

- **Salary-advance vs customer-advance naming collision**: `modules/advances` (route
  `/api/advances`, permission `advances.*`) is customer money; `SalaryAdvance` (permission
  `payroll-advance.*`) is employee money. Easy to misroute a permission grant.
- **Reconciliation gap (explicitly logged by P1-16/P1-17b handoffs)**: `statutory.calc.ts` and
  `labour.calc.ts` compute PF/ESI/PT/OT correctly but **do not feed back into
  `PayrollResult.netSalary`** — the Phase-0 engine in `payroll.service.ts` still uses its own
  cruder PF/ESI/OT math for what actually gets paid. This is the single most consequential
  half-done item: the statutory numbers used for filings and the numbers used for payment can
  disagree.
- **One state per company** (`stateCode` on Company, not per employee) — a plant with workers
  across state lines gets one PT slab for everyone (noted in P1-16 handoff).
- **ESI contribution-period rule not implemented** — eligibility re-evaluated monthly instead of
  fixed for the 6-month scheme period (P1-16 handoff).
- **Leave accrual is not automatic** — `accrue()` must be called by hand; no job wired to
  attendance (P1-17b handoff).
- **No leave application/approval workflow** — only a running balance; "who is off next Tuesday" is
  unanswerable (P1-17b handoff).
- **Inspector registers not written** — muster roll, wages, OT, fines, deductions, advances
  registers are explicitly flagged as not done, even though the underlying data exists.
- **No employee self-service** — nobody, including the employee, can see their own leave balance,
  payslip, or tax declaration status without going through HR/admin.
- **Bonus assumes 12 months worked for everyone**, no proration for new joiners/leavers, no
  allocable-surplus computation (percentage is entered, not derived).
- **Form 16 Part B, Form 24Q file writer wiring**: 24Q _data_ exists (`form24QRows`) but the actual
  `^`-delimited file writer lives in the TDS module and isn't wired (P1-16 handoff).
- **No biometric/attendance-device integration** at all — attendance is presumably entered by hand
  (no device/punch model, no OCR/geo fields on `AttendanceRecord`).
- **`Expense` model has no `employeeId`** — no way to model an employee's own reimbursement claim
  distinct from a vendor bill.
- **AttendanceRecord.status/period are free strings**, not enums — no validation against a fixed
  vocabulary at the schema level (may be enforced in `.validation.ts`, but worth checking against
  encoding-level integrity).

## 2. Gaps — proposed features (ranked by value to plastics SME owner/accountant/plant manager)

1. **Wire statutory calc into the live payroll run** — Rationale: the #1 flagged half-done item;
   without it, the filings and the actual payment disagree, which is the exact bug a labour
   inspector or PF audit would catch first. Data: none new — `payroll.service.ts` calls
   `statutory.calc.ts`/`labour.calc.ts` per employee instead of its own PF/ESI/OT math;
   `PayrollResult` gains columns or a join to `PayrollStatutory` for the authoritative net.
   Touches: payroll, filings. Size: M. Isolated: No — must land before other payroll-accuracy work.

2. **Leave application & approval workflow** — Rationale: plant managers need to know who is on the
   floor tomorrow; today leave is only an after-the-fact number typed into a balance.
   Data: `LeaveRequest` (employeeId, leaveTypeId, fromDate, toDate, days, status, approverId,
   reason), event that updates `LeaveBalance.taken` on approval. Endpoints: apply/approve/reject/
   cancel, calendar view by department. Screens: leave calendar, my-leave (ESS), approvals inbox.
   Touches: entitlements, employee, notifications. Size: M. Isolated: mostly yes (reads existing
   `LeaveBalance`).

3. **Automatic monthly leave accrual job** — Rationale: explicitly flagged as missing; without it
   the whole leave-ledger feature is manual data entry. Data: pg-boss job reading `AttendanceRecord`
   → calls `entitlement`/`labour` accrue() per employee per month, idempotent per period.
   Touches: payroll (attendance), entitlements. Size: S. Isolated: yes, once (1) done.

4. **Inspector/statutory registers** (muster roll, wages register, OT register, fines & deductions
   register, advances register) — Rationale: named explicitly in the Factories Act/Labour Codes as
   what an inspector asks for on a visit; data already exists across attendance/payroll/advances,
   this is "just" reporting but is a real compliance exposure if absent. Data: no new tables —
   report queries + PDF/Excel export, maybe a `RegisterExport` audit row (who generated/downloaded
   when, since inspectors care about that too). Endpoints: `/api/labour/registers/:type?period=`.
   Screens: registers tab under `/payroll/entitlements`. Touches: payroll, entitlements, advances.
   Size: M. Isolated: yes.

5. **Employee self-service (ESS) portal** — Rationale: every modern factory-floor ERP gives workers
   a view of their own payslip, leave balance and tax declaration status; today only HR/admin can
   see this, which is both a UX gap and, for a factory with 100+ workers, an HR-desk bottleneck.
   Data: none new; a scoped "me" API surface (`/api/me/payslips`, `/api/me/leave`, `/api/me/tax-
declaration`) restricted to the logged-in user's own `Employee` row (needs `Employee.userId` link
   if not already present — check). Screens: `/me/payslip`, `/me/leave`, `/me/declaration`. Touches:
   employee, payroll, entitlements, users. Size: M. Isolated: mostly, but needs an Employee↔User
   link if missing.

6. **Employee↔User account link + biometric/device attendance capture** — Rationale: attendance is
   the input to every downstream number (OT, LOP, PF, ESI, gratuity) and today is manual; a factory
   with 50+ shopfloor workers needs a punch source (RFID/biometric device feed, or at minimum a
   supervisor bulk-mark screen) with a source/audit trail. Data: `AttendanceDevice` (device id,
   location, type), `AttendancePunch` (employeeId, deviceId|manual, timestamp, direction), a
   nightly job that derives `AttendanceRecord` from punches with exceptions flagged for review.
   Touches: employee, payroll, mobile (if a phone-based punch is wanted for field/contract workers).
   Size: L. Isolated: mostly, but changes the source of truth for AttendanceRecord so needs careful
   sequencing with payroll.

7. **Contract labour / contractor master + license & compliance tracking** — Rationale: plastics
   SMEs run recycling/granulation and packing lines heavily on contract labour; the Contract Labour
   (Regulation & Abolition) Act requires a principal-employer register of contractors, their labour
   licences, and headcount, none of which exists today. Data: `Contractor` (name, licenceNumber,
   licenceValidTo, PF/ESI code, GSTIN), `ContractWorker` (contractorId, name, aadhaar-masked,
   skill, dailyRate, from/to), `ContractorInvoice` link to existing job-work/purchase modules for
   billing. Endpoints/screens: contractor master, contract-worker roster, licence-expiry alerts.
   Touches: employee (parallel worker type), payroll (their wages may or may not run through
   in-house payroll), filings (Form V/VI registers). Size: L. Isolated: yes, new subdomain.

8. **Full-and-final settlement → payroll/advances reconciliation UI** — Rationale: `FinalSettlement`
   exists and posts a voucher, but the handoff doesn't show it pulling `SalaryAdvance.recoveredAmount`
   or `EmployeePermanentDeduction` automatically — worth confirming and, if missing, wiring
   outstanding advances/loans into the settlement calculation so nothing is missed at exit. Data:
   none new; service change joining `SalaryAdvance` (status PENDING) into `FinalSettlement`
   creation. Touches: payroll, entitlements. Size: S. Isolated: no — depends on (1).

9. **Salary-advance repayment schedule (instalments)** — Rationale: today `SalaryAdvance` has only
   a lump `recoveredAmount`; an accountant needs to see "₹X over 5 months" and have payroll auto-
   deduct the right instalment each run rather than a manual figure. Data: `SalaryAdvanceInstalment`
   (advanceId, dueMonth, amount, status), payroll run reads open instalments for the period.
   Touches: payroll (salary advance + engine). Size: S/M. Isolated: yes.

10. **Recruitment/onboarding pipeline for shopfloor hires** — Rationale: plastics SMEs churn
    operators seasonally; today `Employee` only exists once someone is fully onboarded, so there's
    no visibility into open positions, candidates, or the paperwork checklist (Form 11, ID proof,
    bank details) before day one. Data: `JobRequisition` (department, role, count, targetDate),
    `Candidate` (name, contact, source, status), `OnboardingChecklist` (per new hire, linked
    document uploads). Touches: employee, department. Size: L. Isolated: yes.

11. **Skills & training register** — Rationale: machine-tonnage-specific operator competency
    (who is certified on which machine/mould) matters for both safety and OEE; today
    `machine-assignments` links employees to machines but nothing captures certification/training
    history or expiry (e.g. forklift licence, hot-work certificate). Data: `Skill` (name, category),
    `EmployeeSkill` (employeeId, skillId, certifiedOn, expiresOn, certificateUrl), `TrainingSession`
    (topic, date, trainerId, attendee list). Touches: employee, machine (existing
    machine-operation-assignment module could gate assignment by skill). Size: M. Isolated: yes,
    but higher value if it later gates machine assignment.

12. **Safety incident register** — Rationale: Factories Act requires accident reporting; plastics
    (injection/blow moulding, granulation) is a higher-injury-risk environment (burns, crush,
    entanglement) and there is currently zero capture. Data: `SafetyIncident` (employeeId?,
    machineId?, date, severity, description, correctiveAction, reportedToInspector bool,
    reportedOn). Endpoints/screens: incident log, dashboard count, export for Form 24/29 style
    reporting. Touches: employee, machine. Size: M. Isolated: yes.

13. **Department hierarchy / cost-centre link** — Rationale: `Department` today is a flat
    name+description with no head, no parent, no link to the accounts cost-centre used elsewhere
    in the ERP for costing (payroll cost by department feeding into `costing` module). Data: add
    `headEmployeeId`, `parentDepartmentId`, `costCenterCode` to `Department`. Touches: department,
    costing, payroll (department-wise payroll cost report). Size: S. Isolated: yes.

14. **Shift roster / rotation planner** — Rationale: `Shift` is a static definition (start/end/
    break); there's no weekly roster assigning employees to shifts in rotation (A/B/C shift
    patterns common in 24x7 moulding plants), so attendance/payroll can't tell which shift an
    absent employee was actually rostered for. Data: `ShiftRoster` (employeeId, shiftId, date) or
    `ShiftRotationPattern` (departmentId, cycleDays, sequence). Touches: shift, employee, payroll
    (attendance), shift-execution (already exists for production shift board — may be reusable).
    Size: M. Isolated: mostly, benefits from checking `shift-execution` module for reuse first.

15. **Overtime authorization workflow** — Rationale: the Labour Code OT ceiling (quarterly) is
    computed and reported, but nothing stops OT being worked/paid beyond it in the first place;
    a pre-approval step (supervisor requests OT for a date/employee, capped against the quarterly
    balance) turns a compliance report into compliance prevention. Data: `OvertimeRequest`
    (employeeId, date, plannedHours, approverId, status). Touches: payroll, entitlements
    (labour.calc quarterly ceiling), shift-execution. Size: M. Isolated: no — needs (1)'s ceiling
    numbers surfaced live.

16. **PF/ESI/PT/LWF employee master data completeness checks (pre-run gate)** — Rationale: the ECR/
    ESIC file logic already "counts and names" who's left out (per handoff) but this happens at
    file-generation time; a pre-run dashboard ("12 employees missing UAN, 3 missing bank IFSC")
    before running payroll would catch it a week earlier, not on filing day. Data: none new,
    a compliance-readiness report over `Employee`/`PayrollStatutory`. Touches: payroll, statutory,
    entitlements. Size: S. Isolated: yes.

17. **Multi-state professional tax per employee (work-state, not company-state)** — Rationale:
    explicitly flagged in the P1-16 handoff as a known gap; a company with plants/depots in more
    than one state currently gets one state's PT for everyone. Data: add `workStateCode` to
    `Employee` (or `EmployeePayrollConfig`), `statutory.calc.ts` looks up `StatutoryRule` by the
    employee's state rather than the company's. Touches: payroll (statutory). Size: S. Isolated: no
    — small but must land carefully against (1)'s reconciliation.

18. **Form 16 Part B generation + 24Q file writer wiring** — Rationale: both flagged half-done; a
    company cannot actually hand employees their tax certificate or file TDS returns without them.
    Data: none new (`form24QRows` exists); wire into TDS module's `^`-delimited writer, add a
    PDF template job for Form 16 Part B. Touches: payroll (statutory), TDS module (cross-domain,
    likely owned by finance researcher — flag for coordination). Size: M. Isolated: no — needs TDS
    module cooperation.

19. **Employee document vault** — Rationale: Aadhaar/PAN numbers are stored as raw strings on
    `Employee` with no attached scanned copies, expiry tracking (e.g. driving licence, ESI card),
    or access control separate from the general employee-edit permission. Data:
    `EmployeeDocument` (employeeId, type, fileUrl, expiresOn, verifiedBy). Touches: employee.
    Size: S. Isolated: yes.

20. **Payroll cost dashboard by department/machine-line** — Rationale: a plant manager wants "what
    did labour cost me per shift/line this month" alongside production OEE, not just a payroll
    total; ties HR spend to the production data this ERP already tracks well (shift records,
    machine assignments). Data: none new — report joining `PayrollResult`, `Department`,
    `MachineOperationAssignment`. Touches: payroll, department, insights/dashboard module. Size: S/M.
    Isolated: yes.

21. **Fixed-term/contract employee type distinctions surfaced in UI** — Rationale: `Employee.
employeeType` exists as a field and the Labour Code gratuity rule already treats fixed-term
    employees specially (1 year vs 5), but there's no screen surfacing "employees nearing 1-year
    fixed-term gratuity eligibility" the way there should be an alert. Data: none new — a report/
    alert. Touches: employee, entitlements. Size: S. Isolated: yes.

22. **Notice-period / exit workflow before settlement** — Rationale: `FinalSettlement` captures
    notice days required/served after the fact, but there's no resignation/termination request
    step (date, reason, last-working-day agreement, asset return checklist, exit interview) feeding
    into it — today it looks like settlement is typed in cold. Data: `ExitRequest`
    (employeeId, initiatedBy, reason, noticeDate, lastWorkingDay, status, assetsReturned).
    Touches: employee, entitlements (settlement). Size: M. Isolated: mostly, feeds (8).

## 3. Sequencing

**Build in isolation (few cross-domain deps):**
2 (leave workflow), 3 (accrual job — after wiring choices are stable), 4 (registers), 9 (advance
instalments), 11 (skills/training), 12 (safety incidents), 13 (department hierarchy), 16 (pre-run
gate), 19 (document vault), 20 (cost dashboard), 21 (fixed-term alerts), 7 (contractor master, new
subdomain), 10 (recruitment).

**Need sequencing (dependencies):**
1 must land before 8, 15, 17 fully make sense (they all assume the authoritative net-pay path).
6 (device attendance) changes the source of truth for AttendanceRecord — should land before or
alongside 3 (accrual job) and 14 (shift roster), since both consume attendance data shaped by it.
18 needs coordination with the TDS/finance module owner (cross-domain).
22 should land before or with 8 (settlement wiring) so exits have a proper request trail feeding the
settlement, not just typed-in dates.
5 (ESS) depends on an Employee↔User link existing or being added — check first, then can proceed
independently of the payroll-accuracy work (1).
