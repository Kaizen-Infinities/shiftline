import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Pencil } from "lucide-react";
import {
  Chip,
  ChipTabs,
  PageHeader,
  SkeletonTile,
  Tile,
  actionPillClass,
} from "../../../components/ui/v2";
import { usePermission } from "../../../hooks/usePermission";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FaUser,
  FaPhone,
  FaUsers,
  FaIdCard,
  FaMapMarkerAlt,
  FaBriefcase,
  FaCalendarAlt,
  FaClock,
  FaMoneyBillWave,
  FaLock,
  FaArrowLeft,
} from "react-icons/fa";
import { employeeService } from "../../../services/employeeService";
import StatusBadge from "../../../components/ui/StatusBadge/Badge";
import { usePayrollConfig } from "../../../hooks/usePayrollConfig";
import {
  deriveFromMonthly,
  deriveFromWeekly,
  deriveFromDaily,
  deriveFromHourly,
  getMonthlyWorkingDays,
  getWeeklyWorkingDays,
  calcShiftWorkingHours,
  formatINR,
  calcMethodLabel,
  type PayrollCalcConfig,
} from "../../../utils/salaryCalculation";

const STATUS_MAP: Record<string, string> = {
  active: "ACTIVE",
  inactive: "INACTIVE",
  resigned: "RESIGNED",
  terminated: "TERMINATED",
  retired: "RETIRED",
};

// ─── InfoRow (2-col grid cell) ────────────────────────────────────────────────
function InfoRow({
  label,
  value,
}: {
  label: string;
  value?: string | number | null | React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-b border-line-soft py-2.5">
      <span className="text-[12px] font-medium text-ink-subtle">{label}</span>
      <span className="truncate text-sm font-semibold text-ink">
        {value === null || value === undefined || value === "" ? (
          <span className="font-normal text-ink-subtle">—</span>
        ) : (
          value
        )}
      </span>
    </div>
  );
}

// ─── 2-col section body ───────────────────────────────────────────────────────
function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">{children}</div>;
}

// ─── SectionHeader ────────────────────────────────────────────────────────────
function Section({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tile title={title} icon={<Icon size={15} />} className={className}>
      {children}
    </Tile>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(val: string | null | undefined): string {
  if (!val) return "";
  const d = new Date(val);
  if (isNaN(d.getTime())) return val;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function calcAge(dob: string | null | undefined): string {
  if (!dob) return "";
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
  return `${years} yrs`;
}

function getPhotoUrl(url?: string | null): string {
  if (!url) return "";
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  const base = import.meta.env.VITE_API_BASE_URL?.replace("/api", "") || "http://localhost:5000";
  return `${base}/${url.replace(/^\//, "")}`;
}

const SALARY_TYPE_LABELS: Record<string, string> = {
  monthly: "Monthly",
  weekly: "Weekly",
  daily: "Daily Wage",
  hourly: "Hourly",
};
const PRIMARY_SALARY_LABELS: Record<string, string> = {
  monthly: "Monthly Gross Salary",
  weekly: "Weekly Gross Salary",
  daily: "Daily Wage",
  hourly: "Hourly Rate",
};

// ─── CalcCard ─────────────────────────────────────────────────────────────────
const CARD_STYLES: Record<string, { bg: string; border: string; label: string; val: string }> = {
  slate: { bg: "bg-card-2", border: "border-line-soft", label: "text-ink-muted", val: "text-ink" },
  blue: { bg: "bg-card-2", border: "border-line-soft", label: "text-ink-muted", val: "text-ink" },
  emerald: {
    bg: "bg-card-2",
    border: "border-line-soft",
    label: "text-ink-muted",
    val: "text-ink",
  },
  indigo: { bg: "bg-card-2", border: "border-line-soft", label: "text-ink-muted", val: "text-ink" },
};

function CalcCard({
  label,
  amount,
  note,
  color = "slate",
}: {
  label: string;
  amount: string;
  note: string;
  color?: string;
}) {
  const s = CARD_STYLES[color] ?? CARD_STYLES.slate;
  return (
    <div className={`flex flex-col gap-1 rounded-[14px] px-4 py-3 ${s.bg}`}>
      <span className={`text-[12px] font-medium ${s.label}`}>{label}</span>
      <span className={`text-lg font-bold tabular-nums ${s.val}`}>{amount}</span>
      <span className="text-[12px] text-ink-subtle">{note}</span>
    </div>
  );
}

function StatFlag({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-[14px] bg-card-2 px-3.5 py-2.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <Chip size="sm" tone={value ? "success" : "muted"} className="ml-auto">
        {value ? "Yes" : "No"}
      </Chip>
    </div>
  );
}

// ─── PayrollRows ──────────────────────────────────────────────────────────────
function PayrollRows({ employee, payrollConfig }: { employee: any; payrollConfig: any }) {
  const salaryType = (employee.salaryType || "monthly").toLowerCase();
  const grossAmount = Number(employee.grossSalary || 0);
  const basicAmount = Number(employee.basicSalary || 0);
  const shiftHours = calcShiftWorkingHours(employee.shift, 0);
  const hoursPerDayVal =
    shiftHours > 0 ? shiftHours : payrollConfig?.defaultWorkingHoursPerDay || 8;

  const calcConfig: PayrollCalcConfig = {
    salaryCalculationMethod: payrollConfig?.salaryCalculationMethod || "WORKING_DAYS",
    fixedDays: payrollConfig?.fixedDays || 26,
    defaultWorkingHoursPerDay: hoursPerDayVal,
    weeklyOffDays: payrollConfig?.weeklyOffDays || [0],
  };

  const derivatives =
    grossAmount > 0
      ? salaryType === "monthly"
        ? deriveFromMonthly(grossAmount, calcConfig)
        : salaryType === "weekly"
          ? deriveFromWeekly(grossAmount, calcConfig)
          : salaryType === "daily"
            ? deriveFromDaily(grossAmount, calcConfig)
            : salaryType === "hourly"
              ? deriveFromHourly(grossAmount, calcConfig)
              : null
      : null;

  const workingDays = getMonthlyWorkingDays(calcConfig);
  const weeklyDays = getWeeklyWorkingDays(calcConfig);
  const hoursPerDay = calcConfig.defaultWorkingHoursPerDay;
  const methodLabel = calcMethodLabel(calcConfig.salaryCalculationMethod);

  const pfRate = payrollConfig?.employeePfPercent || 12;
  const maxPf = payrollConfig?.maxPfWage || 15000;
  const pfWageFormula = payrollConfig?.pfWageFormula || "BASIC";
  const pfBase = pfWageFormula === "GROSS" ? grossAmount : basicAmount || grossAmount;
  const pf = employee.pfApplicable ? (Math.min(pfBase, maxPf) * pfRate) / 100 : 0;
  const esiRate = payrollConfig?.employeeEsiPercent || 0.75;
  const maxEsi = payrollConfig?.maxEsiSalary || 21000;
  const esi = employee.esiApplicable && grossAmount <= maxEsi ? (grossAmount * esiRate) / 100 : 0;

  return (
    <>
      {/* Salary structure — 2-col */}
      <FieldGrid>
        <InfoRow label="Salary Type" value={SALARY_TYPE_LABELS[salaryType] ?? salaryType} />
        <InfoRow
          label={PRIMARY_SALARY_LABELS[salaryType] ?? "Gross"}
          value={grossAmount > 0 ? formatINR(grossAmount) : null}
        />
        {basicAmount > 0 && <InfoRow label="Basic Salary" value={formatINR(basicAmount)} />}
        {Number(employee.da || 0) > 0 && (
          <InfoRow label="DA (Dearness Allow.)" value={formatINR(Number(employee.da))} />
        )}
        {Number(employee.hra || 0) > 0 && (
          <InfoRow label="HRA (House Rent Allow.)" value={formatINR(Number(employee.hra))} />
        )}
        {Number(employee.otherAllowance || 0) > 0 && (
          <InfoRow label="Other Allowance" value={formatINR(Number(employee.otherAllowance))} />
        )}
      </FieldGrid>

      {/* Salary breakdown cards */}
      {derivatives && (
        <div className="py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
            {salaryType !== "daily" && salaryType !== "hourly" && (
              <CalcCard
                label="Daily Wage"
                amount={formatINR(derivatives.dailyWage)}
                note={`÷ ${salaryType === "weekly" ? `${weeklyDays}d/wk` : `${workingDays} days`}`}
                color="slate"
              />
            )}
            {salaryType !== "hourly" && (
              <CalcCard
                label="Hourly Rate"
                amount={formatINR(derivatives.hourlyWage)}
                note={`Daily ÷ ${hoursPerDay}h`}
                color="indigo"
              />
            )}
            {salaryType !== "weekly" && (
              <CalcCard
                label="Weekly Equiv."
                amount={formatINR(derivatives.weeklyEquivalent)}
                note={`Daily × ${weeklyDays}d`}
                color="blue"
              />
            )}
            {salaryType !== "monthly" && (
              <CalcCard
                label="Monthly Equiv."
                amount={formatINR(derivatives.monthlyEquivalent)}
                note={salaryType === "weekly" ? "Wkly × 52 ÷ 12" : `Daily × ${workingDays}d`}
                color="emerald"
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2 text-[12px] text-ink-subtle">
            <span>
              <span className="font-semibold text-ink">Method:</span> {methodLabel}
            </span>
            <span>
              <span className="font-semibold text-ink">Monthly Days:</span> {workingDays}
            </span>
            <span>
              <span className="font-semibold text-ink">Weekly Days:</span> {weeklyDays}
            </span>
            <span>
              <span className="font-semibold text-ink">Hrs/Day:</span> {hoursPerDay}
            </span>
          </div>
        </div>
      )}

      {/* Statutory */}
      {employee.paymentMode === "BANK" && (
        <>
          <div className="py-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <StatFlag label="PF Applicable" value={!!employee.pfApplicable} />
              <StatFlag label="ESI Applicable" value={!!employee.esiApplicable} />
              <StatFlag label="Professional Tax" value={!!employee.professionalTax} />
            </div>
          </div>
          <FieldGrid>
            <InfoRow label="PF Number" value={employee.pfNumber} />
            <InfoRow label="UAN Number" value={employee.uanNumber} />
            <InfoRow label="ESIC Number" value={employee.esiNumber} />
            <InfoRow label="Work State" value={employee.workStateCode} />
          </FieldGrid>
          <div className="py-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <CalcCard
                label="Est. Employee PF / Month"
                amount={employee.pfApplicable ? formatINR(pf) : "₹0.00"}
                note={
                  !employee.pfApplicable
                    ? "Not applicable"
                    : `${pfRate}% of ${pfWageFormula === "GROSS" ? "Gross" : "Basic"} (cap ${formatINR(maxPf)})`
                }
                color="blue"
              />
              <CalcCard
                label="Est. Employee ESI / Month"
                amount={employee.esiApplicable ? formatINR(esi) : "₹0.00"}
                note={
                  !employee.esiApplicable
                    ? "Not applicable"
                    : esi === 0
                      ? `Exceeds ceiling (${formatINR(maxEsi)})`
                      : `${esiRate}% of Gross`
                }
                color="emerald"
              />
            </div>
          </div>
        </>
      )}

      {/* Bank details — 2-col */}
      <FieldGrid>
        <InfoRow label="Payment Mode" value={employee.paymentMode || "—"} />
        <InfoRow label="Bank Name" value={employee.bankName} />
        <InfoRow label="Branch" value={employee.bankBranch} />
        <InfoRow label="Account Number" value={employee.accountNumber} />
        <InfoRow label="IFSC Code" value={employee.ifscCode} />
        <InfoRow label="Account Holder" value={employee.accountHolderName} />
      </FieldGrid>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function EmployeeViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [imgError, setImgError] = useState(false);
  const [tab, setTab] = useState<"profile" | "job" | "pay" | "login">("profile");
  const { can } = usePermission();
  const { config: payrollConfig } = usePayrollConfig();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    employeeService
      .fetchById(id)
      .then(setEmployee)
      .catch((err: any) => {
        toast.error(err?.response?.data?.message || "Failed to load employee");
        navigate("/employees");
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return (
      <div className="mx-auto w-full max-w-[1200px] space-y-5 py-1 sm:py-2">
        <PageHeader title="Employee" back="/employees" subtitle="Loading…" />
        <SkeletonTile lines={3} />
        <SkeletonTile lines={6} />
      </div>
    );

  if (!employee) return null;

  const initials =
    employee.fullName
      ?.split(" ")
      .map((n: string) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const cashInHand = Number(employee.payrollConfig?.cashInHand || 0);
  const onRecordGross = Number(employee.grossSalary || employee.monthlySalary || 0);
  const totalCTC = onRecordGross + cashInHand;

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-5 py-1 sm:py-2">
      <PageHeader
        title={employee.fullName}
        back="/employees"
        backLabel="Back to Employees"
        breadcrumbs={[{ label: "Employees", to: "/employees" }, { label: employee.empCode }]}
        meta={
          <StatusBadge
            status={STATUS_MAP[employee.status] ?? employee.status?.toUpperCase() ?? "INACTIVE"}
          />
        }
        subtitle={
          [employee.designation, employee.department?.name].filter(Boolean).join(" · ") ||
          employee.empCode
        }
        actions={
          can("employees.edit") ? (
            <Link
              to={`/employees/edit/${employee.id}`}
              state={employee}
              className={actionPillClass({ variant: "secondary" })}
            >
              <Pencil size={15} aria-hidden="true" /> Edit
            </Link>
          ) : undefined
        }
      />

      {/* Summary */}
      <div className="sl-tile flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        {employee.photoUrl && !imgError ? (
          <img
            src={getPhotoUrl(employee.photoUrl)}
            alt={employee.fullName}
            onError={() => setImgError(true)}
            className="h-20 w-20 shrink-0 rounded-[18px] border border-line-soft object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[18px] bg-chip text-2xl font-bold text-chip-fg">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-semibold text-accent">{employee.empCode}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {employee.designation && <Chip size="sm">{employee.designation}</Chip>}
            {employee.department?.name && (
              <Chip size="sm" tone="muted">
                {employee.department.name}
              </Chip>
            )}
            {employee.employeeType && (
              <Chip size="sm" tone="muted" className="capitalize">
                {employee.employeeType}
              </Chip>
            )}
            {employee.paymentMode && (
              <Chip size="sm" tone="info">
                {employee.paymentMode}
              </Chip>
            )}
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[12px] font-medium text-ink-subtle">
              {PRIMARY_SALARY_LABELS[(employee.salaryType || "monthly").toLowerCase()] ?? "Gross"}
            </dt>
            <dd className="m-0 text-xl font-bold tabular-nums text-ink">
              {onRecordGross > 0 ? formatINR(onRecordGross) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium text-ink-subtle">Joined</dt>
            <dd className="m-0 text-base font-semibold text-ink">
              {formatDate(employee.dateOfJoining) || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium text-ink-subtle">Shift</dt>
            <dd className="m-0 text-base font-semibold text-ink">
              {employee.shift?.shiftName || employee.shiftId || "—"}
            </dd>
          </div>
        </dl>
      </div>

      <ChipTabs
        ariaLabel="Employee details"
        value={tab}
        onChange={(k) => setTab(k as typeof tab)}
        items={[
          { key: "profile", label: "Profile" },
          { key: "job", label: "Job" },
          { key: "pay", label: "Pay & statutory" },
          { key: "login", label: "Login" },
        ]}
      />

      {tab === "profile" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={FaUser} title="Basic Information">
            <FieldGrid>
              <InfoRow label="Employee Code" value={employee.empCode} />
              <InfoRow label="Full Name" value={employee.fullName} />
              <InfoRow
                label="Gender"
                value={
                  employee.gender
                    ? employee.gender.charAt(0).toUpperCase() + employee.gender.slice(1)
                    : null
                }
              />
              <InfoRow
                label="Date of Birth"
                value={
                  employee.dateOfBirth
                    ? `${formatDate(employee.dateOfBirth)} (${calcAge(employee.dateOfBirth)})`
                    : null
                }
              />
              <InfoRow label="Blood Group" value={employee.bloodGroup} />
              <InfoRow
                label="Marital Status"
                value={
                  employee.maritalStatus
                    ? employee.maritalStatus.charAt(0).toUpperCase() +
                      employee.maritalStatus.slice(1)
                    : null
                }
              />
            </FieldGrid>
          </Section>
          <Section icon={FaPhone} title="Contact Details">
            <FieldGrid>
              <InfoRow label="Work Mobile" value={employee.mobile} />
              <InfoRow label="Work Email" value={employee.email} />
              <InfoRow label="Personal Mobile" value={employee.personalMobile} />
              <InfoRow label="Personal Email" value={employee.personalEmail} />
              <InfoRow label="Emergency Contact" value={employee.emergencyContactName} />
              <InfoRow label="Emergency Number" value={employee.emergencyContactNumber} />
            </FieldGrid>
          </Section>
          <Section icon={FaUsers} title="Family Details">
            <FieldGrid>
              <InfoRow label="Father's Name" value={employee.fatherName} />
              <InfoRow label="Mother's Name" value={employee.motherName} />
              <InfoRow label="Spouse's Name" value={employee.spouseName} />
              <InfoRow label="Guardian's Name" value={employee.guardianName} />
              <InfoRow label="Guardian Relationship" value={employee.guardianRelationship} />
            </FieldGrid>
          </Section>
          <Section icon={FaIdCard} title="Identity Documents">
            <FieldGrid>
              <InfoRow label="Aadhaar Number" value={employee.aadhaarNumber} />
              <InfoRow label="PAN Number" value={employee.panNumber} />
              <InfoRow label="Driving License" value={employee.drivingLicense} />
              <InfoRow label="Voter ID" value={employee.voterId} />
            </FieldGrid>
          </Section>
          <Section icon={FaMapMarkerAlt} title="Address" className="lg:col-span-2">
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              <div>
                <p className="sl-section-label m-0 mb-1">Permanent Address</p>
                <InfoRow label="Line 1" value={employee.permanentAddressLine1} />
                <InfoRow label="Line 2" value={employee.permanentAddressLine2} />
                <InfoRow label="City" value={employee.permanentCity} />
                <InfoRow label="State" value={employee.permanentState} />
                <InfoRow label="Pincode" value={employee.permanentPincode} />
              </div>
              <div>
                <p className="sl-section-label m-0 mb-1">Present Address</p>
                <InfoRow label="Line 1" value={employee.presentAddressLine1} />
                <InfoRow label="Line 2" value={employee.presentAddressLine2} />
                <InfoRow label="City" value={employee.presentCity} />
                <InfoRow label="State" value={employee.presentState} />
                <InfoRow label="Pincode" value={employee.presentPincode} />
              </div>
            </div>
          </Section>
        </div>
      )}

      {tab === "job" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Section icon={FaBriefcase} title="Official Information" className="lg:col-span-2">
            <FieldGrid>
              <InfoRow label="Department" value={employee.department?.name} />
              <InfoRow label="Role" value={employee.role?.name || employee.user?.role?.name} />
              <InfoRow
                label="Employee Type"
                value={
                  employee.employeeType
                    ? employee.employeeType.charAt(0).toUpperCase() + employee.employeeType.slice(1)
                    : null
                }
              />
              <InfoRow
                label="Status"
                value={
                  <StatusBadge
                    status={
                      STATUS_MAP[employee.status] ?? employee.status?.toUpperCase() ?? "INACTIVE"
                    }
                  />
                }
              />
            </FieldGrid>
          </Section>
          <Section icon={FaCalendarAlt} title="Joining Details">
            <FieldGrid>
              <InfoRow label="Date of Joining" value={formatDate(employee.dateOfJoining)} />
              <InfoRow label="Relieving Date" value={formatDate(employee.relievingDate)} />
              <InfoRow label="Previous Experience" value={employee.previousExperience} />
            </FieldGrid>
          </Section>
          <Section icon={FaClock} title="Shift Assignment">
            <FieldGrid>
              <InfoRow label="Shift" value={employee.shift?.shiftName || employee.shiftId} />
              <InfoRow label="Shift Code" value={employee.shiftId} />
            </FieldGrid>
          </Section>
        </div>
      )}

      {tab === "pay" && (
        <div className="space-y-5">
          <Section icon={FaMoneyBillWave} title="Payroll & Statutory">
            <PayrollRows employee={employee} payrollConfig={payrollConfig} />
          </Section>

          {/* 9b. Total CTC */}
          {cashInHand > 0 && (
            <Section icon={FaMoneyBillWave} title="Total Compensation Summary">
              <div className="py-3">
                <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <CalcCard
                    label="Net Pay (Monthly)"
                    amount={formatINR(onRecordGross)}
                    note="On-record gross"
                    color="slate"
                  />
                  <CalcCard
                    label="Cash in Hand"
                    amount={formatINR(cashInHand)}
                    note="Off-payroll"
                    color="indigo"
                  />
                  <CalcCard
                    label="Total Monthly CTC"
                    amount={formatINR(totalCTC)}
                    note="Net + Cash"
                    color="emerald"
                  />
                </div>
                <p className="m-0 text-center text-[12px] text-ink-subtle">
                  {formatINR(onRecordGross)} + {formatINR(cashInHand)} = {formatINR(totalCTC)}
                </p>
              </div>
            </Section>
          )}
        </div>
      )}

      {tab === "login" && (
        <Section icon={FaLock} title="Login Account">
          <FieldGrid>
            <InfoRow label="Username" value={employee.user?.username} />
            <InfoRow label="Role" value={employee.user?.role?.name} />
            <InfoRow
              label="Login Status"
              value={
                employee.user ? (
                  <StatusBadge status={employee.user.status?.toUpperCase() || "INACTIVE"} />
                ) : (
                  <span className="font-normal text-ink-subtle">No account</span>
                )
              }
            />
            <InfoRow
              label="Must Change Password"
              value={
                employee.user ? (
                  <span
                    className={`text-sm font-semibold ${employee.user.mustChangePw ? "text-[color:var(--color-warning)]" : "text-[color:var(--color-success)]"}`}
                  >
                    {employee.user.mustChangePw ? "Yes" : "No"}
                  </span>
                ) : null
              }
            />
          </FieldGrid>
        </Section>
      )}
    </div>
  );
}
