import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useFormShortcuts } from "../../../hooks/useFormShortcuts";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";
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
  FaKey,
  FaClipboardList,
  FaSave,
  FaChevronLeft,
  FaChevronRight,
  FaCamera,
  FaRandom,
  FaEye,
  FaEyeSlash,
  FaCheck,
  FaTimes,
  FaSpinner,
} from "react-icons/fa";

import TextInput from "../../../components/form/TextInput/TextInput";
import SelectInput from "../../../components/form/SelectInput/SelectInput";
import CityStateSelect from "../../../components/ui/CityStateSelect/CityStateSelect";
import { ActionPill, PageHeader, SkeletonTile } from "../../../components/ui/v2";
import DatePickerCalendar from "../../../components/ui/DatePickerCalendar/DatePickerCalendar";
import IndiaPhoneInput from "../../../components/ui/PhoneInput/PhoneInput";
import { useDepartments } from "../../../hooks/useDepartments";
import { useRoles } from "../../../hooks/useRoles";
import { useSocketSync } from "../../../hooks/useSocketSync";
import { employeeService } from "../../../services/employeeService";
import apiClient from "../../../api/apiClient";
import SalaryStructureSection from "../../../components/employee/SalaryStructureSection";

// ─── helpers ────────────────────────────────────────────────────────────────

function calcAge(dob: string): string {
  if (!dob) return "";
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 ? String(age) : "";
}

function calcExperience(dateOfJoining: string): string {
  if (!dateOfJoining) return "";
  const start = new Date(dateOfJoining);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years < 0) return "";
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years !== 1 ? "s" : ""}`);
  if (months > 0) parts.push(`${months} month${months !== 1 ? "s" : ""}`);
  return parts.length ? parts.join(" ") : "Less than a month";
}

function generatePassword(): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;
  // Cryptographic randomness (SEC-03): rejection sampling avoids modulo bias.
  const randomIndex = (n: number) => {
    const limit = 256 - (256 % n);
    const buf = new Uint8Array(1);
    do crypto.getRandomValues(buf);
    while (buf[0] >= limit);
    return buf[0] % n;
  };
  const rand = (s: string) => s[randomIndex(s.length)];
  const chars = [rand(upper), rand(lower), rand(digits), rand(symbols)];
  for (let i = 4; i < 14; i++) chars.push(rand(all));
  // Fisher–Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function fmtDate(val: string | null | undefined): string {
  if (!val) return "";
  return val.split("T")[0]; // strip time if ISO string
}

// ─── tab definitions ─────────────────────────────────────────────────────────

const TABS = [
  { id: 0, label: "Basic Info", icon: FaUser },
  { id: 1, label: "Contact", icon: FaPhone },
  { id: 2, label: "Family", icon: FaUsers },
  { id: 3, label: "Identity", icon: FaIdCard },
  { id: 4, label: "Address", icon: FaMapMarkerAlt },
  { id: 5, label: "Official Info", icon: FaBriefcase },
  { id: 6, label: "Joining", icon: FaCalendarAlt },
  { id: 7, label: "Shift", icon: FaClock },
  { id: 8, label: "Payroll", icon: FaMoneyBillWave },
  { id: 9, label: "Login Account", icon: FaKey },
];

// ─── form state ───────────────────────────────────────────────────────────────

interface FormState {
  empCode: string;
  fullName: string;
  gender: string;
  dateOfBirth: string;
  bloodGroup: string;
  maritalStatus: string;
  employeeStatus: string;
  photoFile: File | null;
  photoPreview: string;
  existingPhotoUrl: string;
  personalMobile: string;
  officialMobile: string;
  personalEmail: string;
  officialEmail: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  fatherName: string;
  motherName: string;
  spouseName: string;
  guardianName: string;
  guardianRelationship: string;
  aadhaarNumber: string;
  panNumber: string;
  drivingLicense: string;
  voterId: string;
  permAddress1: string;
  permAddress2: string;
  permCity: string;
  permState: string;
  permPincode: string;
  sameAsPermanent: boolean;
  presAddress1: string;
  presAddress2: string;
  presCity: string;
  presState: string;
  presPincode: string;
  departmentId: string;
  designation: string;
  employeeType: string;
  dateOfJoining: string;
  relievingDate: string;
  previousExperience: string;
  probationPeriod: string;
  noticePeriod: string;
  shiftId: string;
  businessPlaceId: string;
  // Payroll — salary structure
  salaryType: string;
  // Monthly
  monthlySalary: string;
  basicSalary: string;
  da: string;
  hra: string;
  conveyanceAllowance: string;
  medicalAllowance: string;
  specialAllowance: string;
  otherAllowance: string;
  cashInHand: string;
  // Weekly
  weeklySalary: string;
  // Daily
  dailySalary: string;
  overtimeEligible: boolean;
  // Hourly
  hourlySalary: string;
  minWorkingHours: string;
  maxWorkingHours: string;
  // Statutory
  pfApplicable: boolean;
  pfNumber: string;
  uanNumber: string;
  esiApplicable: boolean;
  esiNumber: string;
  professionalTax: boolean;
  tdsApplicable: boolean;
  workStateCode: string;
  // Bank
  paymentMode: string;
  bankName: string;
  bankBranch: string;
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  createLoginAccount: boolean;
  username: string;
  password: string;
  roleId: string;
  mustChangePw: boolean;
  loginEnabled: boolean;
  // audit
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

const INITIAL_STATE: FormState = {
  empCode: "",
  fullName: "",
  gender: "",
  dateOfBirth: "",
  bloodGroup: "",
  maritalStatus: "",
  employeeStatus: "active",
  photoFile: null,
  photoPreview: "",
  existingPhotoUrl: "",
  personalMobile: "",
  officialMobile: "",
  personalEmail: "",
  officialEmail: "",
  emergencyContactName: "",
  emergencyContactNumber: "",
  fatherName: "",
  motherName: "",
  spouseName: "",
  guardianName: "",
  guardianRelationship: "",
  aadhaarNumber: "",
  panNumber: "",
  drivingLicense: "",
  voterId: "",
  permAddress1: "",
  permAddress2: "",
  permCity: "",
  permState: "",
  permPincode: "",
  sameAsPermanent: false,
  presAddress1: "",
  presAddress2: "",
  presCity: "",
  presState: "",
  presPincode: "",
  departmentId: "",
  designation: "",
  employeeType: "",
  dateOfJoining: "",
  relievingDate: "",
  previousExperience: "",
  probationPeriod: "",
  noticePeriod: "",
  shiftId: "",
  businessPlaceId: "",
  salaryType: "MONTHLY",
  monthlySalary: "",
  basicSalary: "",
  da: "",
  hra: "",
  conveyanceAllowance: "",
  medicalAllowance: "",
  specialAllowance: "",
  otherAllowance: "",
  cashInHand: "",
  weeklySalary: "",
  dailySalary: "",
  overtimeEligible: false,
  hourlySalary: "",
  minWorkingHours: "",
  maxWorkingHours: "",
  pfApplicable: false,
  pfNumber: "",
  uanNumber: "",
  esiApplicable: false,
  esiNumber: "",
  professionalTax: false,
  tdsApplicable: false,
  workStateCode: "",
  paymentMode: "BANK",
  bankName: "",
  bankBranch: "",
  accountNumber: "",
  ifscCode: "",
  accountHolderName: "",
  createLoginAccount: false,
  username: "",
  password: "",
  roleId: "",
  mustChangePw: false,
  loginEnabled: true,
  createdBy: "",
  createdAt: "",
  updatedBy: "",
  updatedAt: "",
};

// ─── sub-components ───────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ icon: React.ElementType; title: string; color?: string }> = ({
  icon: Icon,
  title,
  color = "text-accent",
}) => (
  <div className="mb-5 flex items-center gap-2.5">
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-chip"
      aria-hidden="true"
    >
      <Icon className={color} size={16} />
    </span>
    <h3 className="sl-h2 m-0">{title}</h3>
  </div>
);

const Toggle: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({
  label,
  value,
  onChange,
}) => (
  <div className="flex items-center gap-3">
    <label className="text-xs font-bold uppercase tracking-[0.5px] text-ink-muted">{label}</label>
    <label className="relative inline-flex cursor-pointer items-center">
      <input
        type="checkbox"
        className="sr-only"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div
        className={`block w-14 h-8 rounded-full transition-colors duration-300 ${value ? "bg-accent" : "bg-line"}`}
      />
      <div
        className={`dot absolute left-1 top-1 bg-card w-6 h-6 rounded-full transition-transform duration-300 ${value ? "transform translate-x-6" : ""}`}
      />
    </label>
    <span className="text-sm font-medium text-ink-muted">{value ? "YES" : "NO"}</span>
  </div>
);

// ─── main component ───────────────────────────────────────────────────────────

const EmployeeForm: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const user = useSelector((state: any) => state.auth.user);
  const { departments, loadDepartments } = useDepartments();
  const { roles, loadRoles } = useRoles();

  const [activeTab, setActiveTab] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [shifts, setShifts] = useState<any[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">(
    "idle"
  );
  const photoInputRef = useRef<HTMLInputElement>(null);
  const usernameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFormShortcuts({});

  const fetchShifts = useCallback(() => {
    apiClient
      .get("/shifts")
      .then((res) => {
        const data = res.data?.data || res.data || [];
        setShifts(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, []);

  const fetchDeps = useCallback(() => {
    loadDepartments();
  }, [loadDepartments]);

  const fetchRls = useCallback(() => {
    loadRoles();
  }, [loadRoles]);

  // Real-time socket sync for dropdowns (Departments, Roles, Shifts)
  useSocketSync("department", undefined, fetchDeps);
  useSocketSync("role", undefined, fetchRls);
  useSocketSync("shift", undefined, fetchShifts);

  // ── load dropdowns + shifts + employee data (edit) or next emp code (create)
  useEffect(() => {
    fetchDeps();
    fetchRls();
    fetchShifts();

    if (isEdit && id) {
      setIsLoading(true);
      employeeService
        .fetchById(id)
        .then((emp: any) => {
          setForm({
            empCode: emp.empCode || "",
            fullName: emp.fullName || "",
            gender: emp.gender || "",
            dateOfBirth: fmtDate(emp.dateOfBirth),
            bloodGroup: emp.bloodGroup || "",
            maritalStatus: emp.maritalStatus || "",
            employeeStatus: emp.status || "active",
            photoFile: null,
            photoPreview: "",
            existingPhotoUrl: emp.photoUrl || "",
            personalMobile: emp.personalMobile || "",
            officialMobile: emp.mobile || "",
            personalEmail: emp.personalEmail || "",
            officialEmail: emp.email || "",
            emergencyContactName: emp.emergencyContactName || "",
            emergencyContactNumber: emp.emergencyContactNumber || "",
            fatherName: emp.fatherName || "",
            motherName: emp.motherName || "",
            spouseName: emp.spouseName || "",
            guardianName: emp.guardianName || "",
            guardianRelationship: emp.guardianRelationship || "",
            aadhaarNumber: emp.aadhaarNumber || "",
            panNumber: emp.panNumber || "",
            drivingLicense: emp.drivingLicense || "",
            voterId: emp.voterId || "",
            permAddress1: emp.permanentAddressLine1 || "",
            permAddress2: emp.permanentAddressLine2 || "",
            permCity: emp.permanentCity || "",
            permState: emp.permanentState || "",
            permPincode: emp.permanentPincode || "",
            sameAsPermanent: false,
            presAddress1: emp.presentAddressLine1 || "",
            presAddress2: emp.presentAddressLine2 || "",
            presCity: emp.presentCity || "",
            presState: emp.presentState || "",
            presPincode: emp.presentPincode || "",
            departmentId: emp.departmentId ? String(emp.departmentId) : "",
            designation: emp.designation || "",
            employeeType: emp.employeeType || "",
            dateOfJoining: fmtDate(emp.dateOfJoining),
            relievingDate: fmtDate(emp.relievingDate),
            previousExperience: emp.previousExperience || "",
            probationPeriod: emp.probationPeriod ? String(emp.probationPeriod) : "",
            noticePeriod: emp.noticePeriod ? String(emp.noticePeriod) : "",
            shiftId: emp.shiftId ? String(emp.shiftId) : "",
            businessPlaceId: emp.businessPlaceId ? String(emp.businessPlaceId) : "",
            salaryType: (emp.salaryType || "monthly").toUpperCase(),
            monthlySalary:
              emp.salaryType?.toLowerCase() === "monthly" ? String(emp.grossSalary || "") : "",
            weeklySalary:
              emp.salaryType?.toLowerCase() === "weekly" ? String(emp.grossSalary || "") : "",
            dailySalary:
              emp.salaryType?.toLowerCase() === "daily" ? String(emp.grossSalary || "") : "",
            hourlySalary:
              emp.salaryType?.toLowerCase() === "hourly" ? String(emp.grossSalary || "") : "",
            basicSalary: (() => {
              const raw =
                emp.basicSalary !== undefined && emp.basicSalary !== null
                  ? String(emp.basicSalary)
                  : emp.payrollConfig?.basicSalary
                    ? String(emp.payrollConfig.basicSalary)
                    : "";
              if (raw && parseFloat(raw) > 0) return raw;
              const gross = Number(emp.grossSalary || 0);
              return gross > 0 ? String(Math.round(gross * 0.5)) : "";
            })(),
            da: (() => {
              const raw =
                emp.da !== undefined && emp.da !== null
                  ? String(emp.da)
                  : emp.payrollConfig?.da
                    ? String(emp.payrollConfig.da)
                    : "";
              if (raw && parseFloat(raw) > 0) return raw;
              const gross = Number(emp.grossSalary || 0);
              return gross > 0 ? String(Math.round(gross * 0.1)) : "";
            })(),
            hra: (() => {
              const raw =
                emp.hra !== undefined && emp.hra !== null
                  ? String(emp.hra)
                  : emp.payrollConfig?.hra
                    ? String(emp.payrollConfig.hra)
                    : "";
              if (raw && parseFloat(raw) > 0) return raw;
              const gross = Number(emp.grossSalary || 0);
              return gross > 0 ? String(Math.round(gross * 0.1)) : "";
            })(),
            conveyanceAllowance: "",
            medicalAllowance: "",
            specialAllowance: "",
            otherAllowance: (() => {
              const raw =
                emp.otherAllowance !== undefined && emp.otherAllowance !== null
                  ? String(emp.otherAllowance)
                  : emp.payrollConfig?.otherAllowance
                    ? String(emp.payrollConfig.otherAllowance)
                    : "";
              if (raw && parseFloat(raw) > 0) return raw;
              const gross = Number(emp.grossSalary || 0);
              if (gross <= 0) return "";
              const b = Math.round(gross * 0.5);
              const d = Math.round(gross * 0.1);
              const h = Math.round(gross * 0.1);
              return String(Math.max(0, gross - b - d - h));
            })(),
            cashInHand: emp.payrollConfig?.cashInHand ? String(emp.payrollConfig.cashInHand) : "",
            overtimeEligible: false,
            minWorkingHours: "",
            maxWorkingHours: "",
            pfApplicable: !!emp.pfApplicable,
            pfNumber: emp.pfNumber || "",
            uanNumber: emp.uanNumber || "",
            esiApplicable: !!emp.esiApplicable,
            esiNumber: emp.esiNumber || "",
            professionalTax: !!emp.professionalTax,
            tdsApplicable: !!emp.tdsApplicable,
            workStateCode: emp.workStateCode || "",
            paymentMode: emp.paymentMode || "BANK",
            bankName: emp.bankName || "",
            bankBranch: emp.bankBranch || "",
            accountNumber: emp.accountNumber || "",
            ifscCode: emp.ifscCode || "",
            accountHolderName: emp.accountHolderName || "",
            createLoginAccount: !!emp.user,
            username: emp.user?.username || "",
            password: "",
            roleId: emp.roleId
              ? String(emp.roleId)
              : emp.user?.roleId
                ? String(emp.user.roleId)
                : "",
            mustChangePw: !!emp.user?.mustChangePw,
            loginEnabled: emp.user ? emp.user.status === "active" : true,
            createdBy: emp.createdByUser?.username || emp.createdBy || "",
            createdAt: emp.createdAt ? new Date(emp.createdAt).toLocaleString() : "",
            updatedBy: emp.updatedByUser?.username || emp.updatedBy || "",
            updatedAt: emp.updatedAt ? new Date(emp.updatedAt).toLocaleString() : "",
          });
        })
        .catch(() => {
          toast.error("Failed to load employee data");
        })
        .finally(() => setIsLoading(false));
    } else {
      // Create mode — fetch next employee code
      employeeService
        .fetchNextCode()
        .then((code: string) => {
          if (code) setForm((p) => ({ ...p, empCode: code }));
        })
        .catch(() => {});
    }
  }, [id, isEdit, loadDepartments, loadRoles]);

  // ── debounced username availability check (create mode only)
  useEffect(() => {
    if (isEdit) return; // skip availability check in edit mode
    if (!form.createLoginAccount || !form.username.trim()) {
      setUsernameStatus("idle");
      return;
    }
    if (form.username.trim().length < 3) {
      setUsernameStatus("idle");
      return;
    }
    setUsernameStatus("checking");
    if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current);
    usernameCheckTimer.current = setTimeout(() => {
      apiClient
        .get(`/users/check-username/${encodeURIComponent(form.username.trim())}`)
        .then((res) => {
          const data = res.data?.data || res.data;
          setUsernameStatus(data?.available ? "available" : "taken");
          if (!data?.available) {
            setErrors((p) => ({ ...p, username: "Username is already taken" }));
          } else {
            setErrors((p) => ({ ...p, username: undefined }));
          }
        })
        .catch(() => {
          setUsernameStatus("idle");
        });
    }, 500);
    return () => {
      if (usernameCheckTimer.current) clearTimeout(usernameCheckTimer.current);
    };
  }, [form.username, form.createLoginAccount, isEdit]);

  // ── field change
  const handleChange = (
    e:
      | React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
      | { target: { name: string; value: any } }
  ) => {
    let { name, value } = e.target;

    // Field-level entry restrictions
    if (name === "aadhaarNumber") {
      value = String(value).replace(/\D/g, "").slice(0, 12);
    } else if (name === "panNumber") {
      value = String(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10);
    } else if (name === "drivingLicense") {
      value = String(value)
        .toUpperCase()
        .replace(/[^A-Z0-9 -]/g, "")
        .slice(0, 16);
    } else if (name === "voterId") {
      value = String(value)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10);
    }

    setForm((p) => {
      const next = { ...p, [name]: value };

      if (name === "sameAsPermanent") {
        const checked = (e as React.ChangeEvent<HTMLInputElement>).target.checked ?? value;
        next.sameAsPermanent = checked;
        if (checked) {
          next.presAddress1 = p.permAddress1;
          next.presAddress2 = p.permAddress2;
          next.presCity = p.permCity;
          next.presState = p.permState;
          next.presPincode = p.permPincode;
        }
      }

      if (
        p.sameAsPermanent &&
        ["permAddress1", "permAddress2", "permCity", "permState", "permPincode"].includes(name)
      ) {
        const map: Record<string, keyof FormState> = {
          permAddress1: "presAddress1",
          permAddress2: "presAddress2",
          permCity: "presCity",
          permState: "presState",
          permPincode: "presPincode",
        };
        (next as any)[map[name]] = value;
      }

      return next;
    });
    if (errors[name as keyof FormState]) {
      setErrors((p) => ({ ...p, [name]: undefined }));
    }
  };

  const handleToggle = (name: keyof FormState) => (v: boolean) => {
    setForm((p) => ({ ...p, [name]: v }));
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Photo must be under 5 MB");
      return;
    }
    const preview = URL.createObjectURL(file);
    setForm((p) => ({ ...p, photoFile: file, photoPreview: preview }));
  };

  // ── derived
  const age = calcAge(form.dateOfBirth);
  const currentExperience = calcExperience(form.dateOfJoining);

  // ── dropdown options
  const departmentOptions = useMemo(
    () => departments.map((d) => ({ value: String(d.id), label: d.name })),
    [departments]
  );

  const roleOptions = useMemo(() => {
    const excluded = ["ROLE_ADMIN", "Super Admin", "System Administrator"];
    return roles
      .filter((r) => !excluded.includes(r.name))
      .map((r) => ({ value: String(r.id), label: r.name }));
  }, [roles]);

  const shiftOptions = useMemo(
    () => shifts.map((s: any) => ({ value: String(s.shiftCode), label: s.shiftName })),
    [shifts]
  );

  // ── validate
  const validate = (): boolean => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.empCode.trim()) e.empCode = "Employee code is required";
    if (!form.fullName.trim()) e.fullName = "Employee name is required";

    // Contact — Mobile & Email are optional; validate format if entered
    if (form.officialMobile.trim()) {
      if (form.officialMobile.replace(/\D/g, "").replace(/^91/, "").length !== 10)
        e.officialMobile = "Enter a valid 10-digit mobile number";
    }

    if (form.createLoginAccount && !form.officialEmail.trim()) {
      e.officialEmail = "Official email is required when login account is enabled";
    } else if (form.officialEmail.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.officialEmail.trim()))
        e.officialEmail = "Enter a valid email address";
    }

    // Identity validation
    if (form.aadhaarNumber.trim()) {
      if (form.aadhaarNumber.trim().length !== 12)
        e.aadhaarNumber = "Aadhaar number must be exactly 12 digits";
    }

    if (form.panNumber.trim()) {
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(form.panNumber.trim()))
        e.panNumber = "Invalid PAN number format (e.g. ABCDE1234F)";
    }

    if (form.drivingLicense.trim()) {
      const clean = form.drivingLicense.trim().replace(/[\s-]/g, "");
      if (clean.length < 10 || clean.length > 16)
        e.drivingLicense = "Invalid Driving License format (10-16 alphanumeric characters)";
    }

    if (form.voterId.trim()) {
      if (!/^[A-Z]{3}[0-9]{7}$/.test(form.voterId.trim()))
        e.voterId = "Invalid Voter ID format (e.g. ABC1234567)";
    }

    if (!form.departmentId) e.departmentId = "Department is required";

    // Login account validation
    if (form.createLoginAccount) {
      if (!form.roleId.trim()) e.roleId = "Role is required when login account is enabled";
      if (!form.username.trim()) e.username = "Username is required";
      else if (form.username.trim().length < 3)
        e.username = "Username must be at least 3 characters";
      else if (!isEdit && usernameStatus === "taken") e.username = "Username is already taken";

      // Password: required in create mode, optional in edit mode
      if (!isEdit) {
        if (!form.password.trim()) e.password = "Password is required";
        else if (form.password.length < 8) e.password = "Password must be at least 8 characters";
      } else {
        if (form.password && form.password.length < 8)
          e.password = "Password must be at least 8 characters";
      }
    }

    // Payroll — validate primary salary field per type
    const st = (form.salaryType || "").toUpperCase();
    if (st === "MONTHLY" && !form.monthlySalary)
      e.monthlySalary = "Monthly gross salary is required";
    if (st === "WEEKLY" && !form.weeklySalary) e.weeklySalary = "Weekly gross salary is required";
    if (st === "DAILY" && !form.dailySalary) e.dailySalary = "Daily wage is required";
    if (st === "HOURLY" && !form.hourlySalary) e.hourlySalary = "Hourly rate is required";

    // PF validation
    if (form.paymentMode === "BANK" && form.pfApplicable) {
      if (!form.uanNumber.trim()) e.uanNumber = "UAN Number is required when PF is applicable";
    }

    // ESI validation
    if (form.paymentMode === "BANK" && form.esiApplicable) {
      if (!form.esiNumber.trim()) e.esiNumber = "ESIC Number is required when ESI is applicable";
    }

    // Bank validation
    if (form.paymentMode === "BANK") {
      if (!form.bankName.trim()) e.bankName = "Bank Name is required for Bank Transfers";
      if (!form.bankBranch.trim()) e.bankBranch = "Bank Branch is required for Bank Transfers";
      if (!form.accountNumber.trim())
        e.accountNumber = "Account Number is required for Bank Transfers";
      if (!form.ifscCode.trim()) e.ifscCode = "IFSC Code is required for Bank Transfers";
      if (!form.accountHolderName.trim())
        e.accountHolderName = "Account Holder Name is required for Bank Transfers";

      // Validate component breakdown sum matches gross salary
      const gross =
        parseFloat(
          form.monthlySalary || form.weeklySalary || form.dailySalary || form.hourlySalary || "0"
        ) || 0;
      if (gross > 0) {
        const basic = parseFloat(form.basicSalary || "0") || 0;
        const da = parseFloat(form.da || "0") || 0;
        const hra = parseFloat(form.hra || "0") || 0;
        const other = parseFloat(form.otherAllowance || "0") || 0;
        const sum = basic + da + hra + other;

        if (Math.abs(sum - gross) > 0.01) {
          e.otherAllowance = `Salary components sum (₹${sum.toLocaleString("en-IN")}) must equal Gross Salary (₹${gross.toLocaleString("en-IN")})`;
        }
      }
    }

    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error(Object.values(e)[0]);
      return false;
    }
    return true;
  };

  // ── submit
  const handleSubmit = async () => {
    if (!validate() || isSubmitting) return;
    if (isEdit && !id) return;
    setIsSubmitting(true);

    // Check duplicate employee code
    try {
      const res = await employeeService.fetchAll();
      const list = Array.isArray(res) ? res : res.data || [];
      const duplicate = list.find((e: any) => {
        const codeMatch = e.empCode?.trim().toLowerCase() === form.empCode.trim().toLowerCase();
        if (!codeMatch) return false;
        // In edit mode, exclude self from duplicate check
        if (isEdit) return String(e.id) !== String(id);
        return true;
      });
      if (duplicate) {
        setErrors((p) => ({ ...p, empCode: "Employee code already exists" }));
        toast.error("Employee code already exists");
        setIsSubmitting(false);
        return;
      }
    } catch (err) {
      // Continue if search check fails
    }

    try {
      const fd = new FormData();
      fd.append("empCode", form.empCode);
      fd.append("fullName", form.fullName);
      if (form.gender) fd.append("gender", form.gender);
      if (form.dateOfBirth) fd.append("dateOfBirth", form.dateOfBirth);
      if (form.bloodGroup) fd.append("bloodGroup", form.bloodGroup);
      if (form.maritalStatus) fd.append("maritalStatus", form.maritalStatus);
      fd.append("status", form.employeeStatus || "active");

      if (form.photoFile) fd.append("photo", form.photoFile);

      fd.append("personalMobile", form.personalMobile || "");
      fd.append("mobile", form.officialMobile || "");
      fd.append("personalEmail", form.personalEmail || "");
      fd.append("email", form.officialEmail || "");
      fd.append("emergencyContactName", form.emergencyContactName || "");
      fd.append("emergencyContactNumber", form.emergencyContactNumber || "");

      // Family
      fd.append("fatherName", form.fatherName || "");
      fd.append("motherName", form.motherName || "");
      fd.append("spouseName", form.spouseName || "");
      fd.append("guardianName", form.guardianName || "");
      fd.append("guardianRelationship", form.guardianRelationship || "");

      // Identity
      fd.append("aadhaarNumber", form.aadhaarNumber || "");
      fd.append("panNumber", form.panNumber || "");
      fd.append("drivingLicense", form.drivingLicense || "");
      fd.append("voterId", form.voterId || "");

      // Address
      fd.append("permanentAddressLine1", form.permAddress1 || "");
      fd.append("permanentAddressLine2", form.permAddress2 || "");
      fd.append("permanentCity", form.permCity || "");
      fd.append("permanentState", form.permState || "");
      fd.append("permanentPincode", form.permPincode || "");
      fd.append("presentAddressLine1", form.presAddress1 || "");
      fd.append("presentAddressLine2", form.presAddress2 || "");
      fd.append("presentCity", form.presCity || "");
      fd.append("presentState", form.presState || "");
      fd.append("presentPincode", form.presPincode || "");

      if (form.departmentId) fd.append("departmentId", form.departmentId);
      if (form.roleId) fd.append("roleId", form.roleId);
      if (form.designation) fd.append("designation", form.designation);
      if (form.employeeType) fd.append("employeeType", form.employeeType);

      if (form.dateOfJoining) fd.append("dateOfJoining", form.dateOfJoining);
      if (form.relievingDate) fd.append("relievingDate", form.relievingDate);
      if (form.previousExperience) fd.append("previousExperience", form.previousExperience);
      if (form.probationPeriod) fd.append("probationPeriod", form.probationPeriod);
      if (form.noticePeriod) fd.append("noticePeriod", form.noticePeriod);

      if (form.shiftId) fd.append("shiftId", form.shiftId);
      fd.append("businessPlaceId", form.businessPlaceId || "");

      if (form.salaryType) fd.append("salaryType", form.salaryType.toLowerCase());
      const st = (form.salaryType || "MONTHLY").toUpperCase();
      if (st === "MONTHLY") {
        if (form.monthlySalary) fd.append("grossSalary", form.monthlySalary);
      } else if (st === "WEEKLY") {
        if (form.weeklySalary) fd.append("grossSalary", form.weeklySalary);
      } else if (st === "DAILY") {
        if (form.dailySalary) fd.append("grossSalary", form.dailySalary);
      } else if (st === "HOURLY") {
        if (form.hourlySalary) fd.append("grossSalary", form.hourlySalary);
      }

      // Bank Transfer salary components
      if (form.paymentMode === "BANK") {
        if (form.basicSalary) fd.append("basicSalary", form.basicSalary);
        if (form.da) fd.append("da", form.da);
        if (form.hra) fd.append("hra", form.hra);
        if (form.otherAllowance) fd.append("otherAllowance", form.otherAllowance);
      }
      if (form.cashInHand) fd.append("cashInHand", form.cashInHand);
      // Statutory
      fd.append("pfApplicable", String(form.pfApplicable));
      if (form.pfNumber) fd.append("pfNumber", form.pfNumber);
      if (form.uanNumber) fd.append("uanNumber", form.uanNumber);
      fd.append("esiApplicable", String(form.esiApplicable));
      if (form.esiNumber) fd.append("esiNumber", form.esiNumber);
      fd.append("professionalTax", String(form.professionalTax));
      if (form.workStateCode) fd.append("workStateCode", form.workStateCode);
      fd.append("tdsApplicable", String(form.tdsApplicable));
      fd.append("paymentMode", form.paymentMode || "CASH");
      if (form.bankName) fd.append("bankName", form.bankName);
      if (form.bankBranch) fd.append("bankBranch", form.bankBranch);
      if (form.accountNumber) fd.append("accountNumber", form.accountNumber);
      if (form.ifscCode) fd.append("ifscCode", form.ifscCode);
      if (form.accountHolderName) fd.append("accountHolderName", form.accountHolderName);

      fd.append("createLoginAccount", String(form.createLoginAccount));
      if (form.createLoginAccount) {
        const loginAccount: any = {
          username: form.username,
          roleId: Number(form.roleId),
          status: form.loginEnabled ? "active" : "suspended",
          mustChangePw: form.mustChangePw,
        };
        if (form.password) loginAccount.password = form.password;
        fd.append("loginAccount", JSON.stringify(loginAccount));
      }

      if (isEdit) {
        if (user?.userId) fd.append("updatedBy", String(user.userId));
        await employeeService.update(id!, fd as any);
        toast.success("Employee updated successfully!");
      } else {
        if (user?.userId) fd.append("createdBy", String(user.userId));
        await employeeService.create(fd as any);
        toast.success("Employee created successfully!");
      }
      navigate("/employees");
    } catch (err: any) {
      toast.error(
        err?.response?.data?.message ||
          err?.message ||
          `Failed to ${isEdit ? "update" : "create"} employee`
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── tab content renderers ────────────────────────────────────────────────

  const renderTab0 = () => (
    <div>
      <SectionHeader icon={FaUser} title="Basic Information" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <TextInput
          label="Employee Code"
          name="empCode"
          value={form.empCode}
          onChange={handleChange}
          required
          error={errors.empCode}
          placeholder="e.g. EMP001"
          disabled={isEdit}
        />
        <TextInput
          label="Employee Name"
          name="fullName"
          value={form.fullName}
          onChange={handleChange}
          required
          error={errors.fullName}
          placeholder="Full name"
        />
        <SelectInput
          label="Gender"
          name="gender"
          value={form.gender}
          onChange={handleChange}
          defaultOptionLabel="Select Gender"
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
            { value: "other", label: "Other" },
          ]}
        />
        <DatePickerCalendar
          label="Date of Birth"
          name="dateOfBirth"
          value={form.dateOfBirth}
          onChange={handleChange}
          placeholder="Select DOB"
          maxDate={new Date()}
        />
        <TextInput
          label="Age (years)"
          name="_age"
          value={age}
          onChange={() => {}}
          disabled
          placeholder="Auto-calculated"
        />
        <SelectInput
          label="Blood Group"
          name="bloodGroup"
          value={form.bloodGroup}
          onChange={handleChange}
          defaultOptionLabel="Select Blood Group"
          options={["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((g) => ({
            value: g,
            label: g,
          }))}
        />
        <SelectInput
          label="Marital Status"
          name="maritalStatus"
          value={form.maritalStatus}
          onChange={handleChange}
          defaultOptionLabel="Select Status"
          options={["Single", "Married", "Divorced", "Widowed"].map((s) => ({
            value: s.toLowerCase(),
            label: s,
          }))}
        />
        <SelectInput
          label="Employee Status"
          name="employeeStatus"
          value={form.employeeStatus}
          onChange={handleChange}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "resigned", label: "Resigned" },
            { value: "retired", label: "Retired" },
            { value: "terminated", label: "Terminated" },
          ]}
        />
      </div>

      {/* Photo upload */}
      <div className="mt-6">
        <SectionHeader icon={FaCamera} title="Profile Photo" />
        <div className="flex items-center gap-6">
          <div
            className="w-28 h-28 rounded-full border-2 border-dashed border-line-soft flex items-center justify-center bg-card-2 overflow-hidden cursor-pointer hover:border-accent transition-colors"
            onClick={() => photoInputRef.current?.click()}
          >
            {form.photoPreview ? (
              <img
                src={form.photoPreview}
                alt="New preview"
                className="w-full h-full object-cover"
              />
            ) : form.existingPhotoUrl ? (
              <img
                src={
                  form.existingPhotoUrl.startsWith("http://") ||
                  form.existingPhotoUrl.startsWith("https://") ||
                  form.existingPhotoUrl.startsWith("data:")
                    ? form.existingPhotoUrl
                    : `${import.meta.env.VITE_API_BASE_URL?.replace("/api", "") || "http://localhost:5000"}/${form.existingPhotoUrl.replace(/^\//, "")}`
                }
                alt="Current photo"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-ink-subtle">
                <FaCamera size={24} className="text-accent" />
                <span className="text-xs font-semibold">Upload Photo</span>
              </div>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="px-4 py-2 text-sm font-bold text-accent bg-accent/15 border border-accent/30 rounded-lg hover:bg-accent/25 transition-colors"
            >
              {form.existingPhotoUrl || form.photoPreview ? "Replace Photo" : "Choose Photo"}
            </button>
            <p className="text-xs text-ink-subtle mt-1.5 font-medium">JPG, PNG, GIF up to 5MB</p>
            {form.photoFile && (
              <p className="text-xs text-[color:var(--color-success)] mt-1">
                New photo selected: {form.photoFile.name}
              </p>
            )}
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderTab1 = () => (
    <div>
      <SectionHeader icon={FaPhone} title="Contact Information" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <IndiaPhoneInput
          label="Personal Mobile Number"
          name="personalMobile"
          value={form.personalMobile}
          onChange={handleChange}
          required={false}
          placeholder="98765 43210"
        />
        <IndiaPhoneInput
          label="Official Mobile Number"
          name="officialMobile"
          value={form.officialMobile}
          onChange={handleChange}
          required={false}
          error={errors.officialMobile}
          placeholder="98765 43210"
        />
        <TextInput
          label="Personal Email Address"
          name="personalEmail"
          type="email"
          value={form.personalEmail}
          onChange={handleChange}
          placeholder="Personal email"
        />
        <TextInput
          label="Official Email Address"
          name="officialEmail"
          type="email"
          value={form.officialEmail}
          onChange={handleChange}
          error={errors.officialEmail}
          placeholder="Official email"
        />
        <TextInput
          label="Emergency Contact Name"
          name="emergencyContactName"
          value={form.emergencyContactName}
          onChange={handleChange}
          placeholder="Emergency contact name"
        />
        <IndiaPhoneInput
          label="Emergency Contact Number"
          name="emergencyContactNumber"
          value={form.emergencyContactNumber}
          onChange={handleChange}
          required={false}
          placeholder="98765 43210"
        />
      </div>
    </div>
  );

  const renderTab2 = () => (
    <div>
      <SectionHeader icon={FaUsers} title="Family Details" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <TextInput
          label="Father Name"
          name="fatherName"
          value={form.fatherName}
          onChange={handleChange}
          placeholder="Father's name"
        />
        <TextInput
          label="Mother Name"
          name="motherName"
          value={form.motherName}
          onChange={handleChange}
          placeholder="Mother's name"
        />
        <TextInput
          label="Husband / Wife Name"
          name="spouseName"
          value={form.spouseName}
          onChange={handleChange}
          placeholder="Spouse's name"
        />
        <TextInput
          label="Guardian Name"
          name="guardianName"
          value={form.guardianName}
          onChange={handleChange}
          placeholder="Guardian's name"
        />
        <TextInput
          label="Guardian Relationship"
          name="guardianRelationship"
          value={form.guardianRelationship}
          onChange={handleChange}
          placeholder="e.g. Uncle, Brother, etc."
        />
      </div>
    </div>
  );

  const renderTab3 = () => (
    <div>
      <SectionHeader icon={FaIdCard} title="Identity Documents" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <TextInput
          label="Aadhaar Number"
          name="aadhaarNumber"
          value={form.aadhaarNumber}
          onChange={handleChange}
          error={errors.aadhaarNumber}
          placeholder="12-digit Aadhaar number"
          maxLength={12}
        />
        <TextInput
          label="PAN Number"
          name="panNumber"
          value={form.panNumber}
          onChange={handleChange}
          error={errors.panNumber}
          placeholder="e.g. ABCDE1234F"
          maxLength={10}
        />
        <TextInput
          label="Driving License Number"
          name="drivingLicense"
          value={form.drivingLicense}
          onChange={handleChange}
          error={errors.drivingLicense}
          placeholder="Driving license number"
          maxLength={16}
        />
        <TextInput
          label="Voter ID"
          name="voterId"
          value={form.voterId}
          onChange={handleChange}
          error={errors.voterId}
          placeholder="Voter ID number"
          maxLength={10}
        />
      </div>
    </div>
  );

  const renderTab4 = () => (
    <div>
      <SectionHeader icon={FaMapMarkerAlt} title="Permanent Address" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <TextInput
          label="Address Line 1"
          name="permAddress1"
          value={form.permAddress1}
          onChange={handleChange}
          placeholder="Street / Building / Plot"
        />
        <TextInput
          label="Address Line 2"
          name="permAddress2"
          value={form.permAddress2}
          onChange={handleChange}
          placeholder="Area / Locality"
        />
        <TextInput
          label="Pincode"
          name="permPincode"
          value={form.permPincode}
          onChange={handleChange}
          placeholder="6-digit pincode"
        />
        <CityStateSelect
          stateLabel="State"
          cityLabel="City"
          stateValue={form.permState}
          cityValue={form.permCity}
          onStateChange={(s) => setForm((p) => ({ ...p, permState: s.name, permCity: "" }))}
          onCityChange={(c) => setForm((p) => ({ ...p, permCity: c.name }))}
        />
      </div>

      <div className="mt-6 mb-4 flex items-center gap-3">
        <input
          id="sameAsPermanentForm"
          type="checkbox"
          checked={form.sameAsPermanent}
          name="sameAsPermanent"
          onChange={(e) =>
            handleChange({ target: { name: "sameAsPermanent", value: e.target.checked } })
          }
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer"
        />
        <label
          htmlFor="sameAsPermanentForm"
          className="text-sm font-semibold text-ink-muted cursor-pointer select-none"
        >
          Same as Permanent Address
        </label>
      </div>

      <SectionHeader icon={FaMapMarkerAlt} title="Present Address" color="text-ink-muted" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <TextInput
          label="Address Line 1"
          name="presAddress1"
          value={form.presAddress1}
          onChange={handleChange}
          placeholder="Street / Building / Plot"
          disabled={form.sameAsPermanent}
        />
        <TextInput
          label="Address Line 2"
          name="presAddress2"
          value={form.presAddress2}
          onChange={handleChange}
          placeholder="Area / Locality"
          disabled={form.sameAsPermanent}
        />
        <TextInput
          label="Pincode"
          name="presPincode"
          value={form.presPincode}
          onChange={handleChange}
          placeholder="6-digit pincode"
          disabled={form.sameAsPermanent}
        />
        <CityStateSelect
          stateLabel="State"
          cityLabel="City"
          stateValue={form.presState}
          cityValue={form.presCity}
          onStateChange={(s) => setForm((p) => ({ ...p, presState: s.name, presCity: "" }))}
          onCityChange={(c) => setForm((p) => ({ ...p, presCity: c.name }))}
          disabled={form.sameAsPermanent}
        />
      </div>
    </div>
  );

  const renderTab5 = () => (
    <div>
      <SectionHeader icon={FaBriefcase} title="Official Information" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <SelectInput
          label="Department"
          name="departmentId"
          value={form.departmentId}
          onChange={handleChange}
          required
          error={errors.departmentId}
          defaultOptionLabel="Select Department"
          options={departmentOptions}
          searchable
        />
        <SelectInput
          label="Role"
          name="roleId"
          value={form.roleId}
          onChange={handleChange}
          required={form.createLoginAccount}
          error={errors.roleId}
          defaultOptionLabel="Select Role"
          options={roleOptions}
          searchable
        />
        <SelectInput
          label="Employee Type"
          name="employeeType"
          value={form.employeeType}
          onChange={handleChange}
          defaultOptionLabel="Select Type"
          options={["Permanent", "Contract", "Intern", "Consultant", "Operator", "Supervisor"].map(
            (t) => ({ value: t.toLowerCase(), label: t })
          )}
        />
        <SelectInput
          label="Employment Status"
          name="employeeStatus"
          value={form.employeeStatus}
          onChange={handleChange}
          options={[
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "resigned", label: "Resigned" },
            { value: "retired", label: "Retired" },
            { value: "terminated", label: "Terminated" },
          ]}
        />
      </div>
    </div>
  );

  const renderTab6 = () => (
    <div>
      <SectionHeader icon={FaCalendarAlt} title="Joining Details" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <DatePickerCalendar
          label="Date of Joining"
          name="dateOfJoining"
          value={form.dateOfJoining}
          onChange={handleChange}
          placeholder="Select joining date"
        />
        <DatePickerCalendar
          label="Relieving Date"
          name="relievingDate"
          value={form.relievingDate}
          onChange={handleChange}
          placeholder="Select relieving date"
        />
        <TextInput
          label="Previous Experience"
          name="previousExperience"
          value={form.previousExperience}
          onChange={handleChange}
          placeholder="e.g. 2 years 3 months"
        />
      </div>
    </div>
  );

  const renderTab7 = () => (
    <div>
      <SectionHeader icon={FaClock} title="Shift Assignment" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4">
        <SelectInput
          label="Shift"
          name="shiftId"
          value={form.shiftId}
          onChange={handleChange}
          defaultOptionLabel="Select Shift"
          options={shiftOptions}
          searchable
        />
        <TextInput
          label="Business Place ID"
          name="businessPlaceId"
          value={form.businessPlaceId}
          onChange={handleChange}
          placeholder="For the registers' business-place filter"
        />
      </div>
    </div>
  );

  const selectedShift = useMemo(() => {
    if (!form.shiftId) return null;
    return (
      shifts.find(
        (s: any) =>
          String(s.shiftCode || s.id) === String(form.shiftId) ||
          String(s.id) === String(form.shiftId)
      ) || null
    );
  }, [form.shiftId, shifts]);

  const renderTab8 = () => (
    <div className="space-y-6">
      <SalaryStructureSection
        form={form}
        onChange={handleChange}
        onToggle={(name) => handleToggle(name as any)}
        errors={errors}
        selectedShift={selectedShift}
      />
    </div>
  );

  const renderTab9 = () => (
    <div>
      <div className="flex items-center justify-between mb-5 pb-2 border-b border-line-soft">
        <div className="flex items-center gap-2">
          <FaKey className="text-accent text-lg" />
          <h3 className="text-base font-semibold text-ink">Login Account</h3>
        </div>
        <Toggle
          label={
            isEdit
              ? form.createLoginAccount
                ? "Manage Login Account"
                : "Create Login Account"
              : "Create Login Account"
          }
          value={form.createLoginAccount}
          onChange={handleToggle("createLoginAccount")}
        />
      </div>

      {form.createLoginAccount && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 md:gap-x-10 lg:gap-x-16 gap-y-3 md:gap-y-4 rounded-[14px] bg-card-2 p-5">
          <div className="flex flex-col gap-1">
            <TextInput
              label="Username"
              name="username"
              value={form.username}
              onChange={handleChange}
              required
              error={errors.username}
              placeholder="Login username"
            />
            {!isEdit && form.username.trim().length >= 3 && usernameStatus !== "idle" && (
              <div
                className={`flex items-center gap-1.5 text-xs font-medium ${
                  usernameStatus === "checking"
                    ? "text-ink-muted"
                    : usernameStatus === "available"
                      ? "text-[color:var(--color-success)]"
                      : "text-[color:var(--color-danger)]"
                }`}
              >
                {usernameStatus === "checking" && (
                  <>
                    <FaSpinner className="animate-spin" size={11} /> Checking availability...
                  </>
                )}
                {usernameStatus === "available" && (
                  <>
                    <FaCheck size={11} /> Username is available
                  </>
                )}
                {usernameStatus === "taken" && (
                  <>
                    <FaTimes size={11} /> Username is already taken
                  </>
                )}
              </div>
            )}
          </div>
          <TextInput
            label="Official Email Address"
            name="officialEmail"
            type="email"
            value={form.officialEmail}
            onChange={handleChange}
            required={form.createLoginAccount}
            error={errors.officialEmail}
            placeholder="official@company.com"
          />
          <div className="flex flex-col gap-2">
            <TextInput
              label="Password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={form.password}
              onChange={handleChange}
              required={!isEdit}
              error={errors.password}
              placeholder={isEdit ? "Leave blank to keep current password" : "Minimum 8 characters"}
              trailingIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="text-ink-muted hover:text-ink focus:outline-none cursor-pointer"
                  tabIndex={-1}
                  title={showPassword ? "Hide Password" : "Show Password"}
                >
                  {showPassword ? <FaEyeSlash size={16} /> : <FaEye size={16} />}
                </button>
              }
            />
            <button
              type="button"
              onClick={() => setForm((p) => ({ ...p, password: generatePassword() }))}
              className="flex items-center gap-2 text-xs font-semibold text-accent hover:underline self-start"
            >
              <FaRandom size={11} /> Generate Random Password
            </button>
          </div>
          <div className="flex flex-col gap-4">
            <Toggle
              label="Password Reset Required"
              value={form.mustChangePw}
              onChange={handleToggle("mustChangePw")}
            />
            <Toggle
              label="Login Enabled"
              value={form.loginEnabled}
              onChange={handleToggle("loginEnabled")}
            />
          </div>
        </div>
      )}
    </div>
  );

  const tabRenderers = [
    renderTab0,
    renderTab1,
    renderTab2,
    renderTab3,
    renderTab4,
    renderTab5,
    renderTab6,
    renderTab7,
    renderTab8,
    renderTab9,
  ];

  // ─── render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] space-y-5 py-1 sm:py-2">
        <PageHeader
          title={isEdit ? "Edit Employee" : "Create Employee"}
          subtitle="Loading employee data…"
        />
        <SkeletonTile lines={6} label="Loading employee data" />
      </div>
    );
  }

  const saveLabel = isSubmitting ? "Saving..." : isEdit ? "Save Changes" : "Save Employee";

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 py-1 sm:py-2">
      <PageHeader
        title={isEdit ? "Edit Employee" : "Create Employee"}
        back={() => navigate(-1)}
        breadcrumbs={[
          { label: "Employees", to: "/employees" },
          { label: isEdit ? "Edit" : "New employee" },
        ]}
        subtitle={
          isEdit && (form.empCode || form.fullName) ? (
            <>
              {form.empCode && <span className="font-semibold text-accent">{form.empCode}</span>}
              {form.fullName && <span> — {form.fullName}</span>}
            </>
          ) : (
            "Personal details, job, pay, statutory numbers and login — one tab at a time."
          )
        }
      >
        <div
          role="tablist"
          aria-label="Employee sections"
          className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]"
        >
          {TABS.map((tab, index) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className="sl-chip sl-chip-lg shrink-0"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-card text-[11px] font-bold text-ink-muted"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Icon size={13} aria-hidden="true" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </PageHeader>

      {/* Tab content */}
      <div className="sl-tile min-h-[350px] p-5 sm:p-6">{tabRenderers[activeTab]()}</div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line-soft bg-card/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <ActionPill
            variant="secondary"
            icon={<FaChevronLeft size={12} />}
            disabled={activeTab === 0}
            onClick={() => setActiveTab((p) => Math.max(0, p - 1))}
          >
            Previous
          </ActionPill>
          <span className="px-1 text-sm font-medium tabular-nums text-ink-muted">
            {activeTab + 1} / {TABS.length}
          </span>
          {activeTab < TABS.length - 1 && (
            <ActionPill
              variant="secondary"
              iconRight={<FaChevronRight size={12} />}
              onClick={() => setActiveTab((p) => Math.min(TABS.length - 1, p + 1))}
            >
              Next
            </ActionPill>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ActionPill variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </ActionPill>
          <ActionPill
            icon={<FaSave size={15} />}
            disabled={isSubmitting}
            loading={isSubmitting}
            loadingText="Saving..."
            onClick={handleSubmit}
          >
            {saveLabel}
          </ActionPill>
        </div>
      </div>
    </div>
  );
};

export default EmployeeForm;
