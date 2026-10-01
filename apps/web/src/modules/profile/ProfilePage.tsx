import React from "react";
import {
  Briefcase,
  Mail,
  Phone,
  CalendarDays,
  BadgeCheck,
  ShieldCheck,
  Shield,
} from "lucide-react";

import { useProfile } from "../../hooks/useProfile";

const formatDate = (date?: string | null) =>
  date
    ? new Date(date).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "N/A";

const getInitials = (name?: string | null) => {
  if (!name) return "—";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

const ProfilePage: React.FC = () => {
  const { employee, loading } = useProfile();

  if (loading || !employee) {
    return (
      <div
        className="flex max-w-[1024px] flex-col gap-6 pt-2"
        aria-busy="true"
        aria-label="Loading profile"
      >
        <div className="flex items-center gap-5">
          <span className="sl-skeleton h-20 w-20 !rounded-full" />
          <span className="sl-skeleton h-9 w-72" />
        </div>
        <div className="sl-skeleton h-72 !rounded-[18px]" />
      </div>
    );
  }

  const rows: { icon: React.ReactNode; label: string; value: string; mono?: boolean }[] = [
    {
      icon: <BadgeCheck size={18} />,
      label: "Employee Code",
      value: employee.empCode || "N/A",
      mono: true,
    },
    {
      icon: <Briefcase size={18} />,
      label: "Department",
      value: employee.department?.name || "N/A",
    },
    {
      icon: <CalendarDays size={18} />,
      label: "Date of Joining",
      value: formatDate(employee.dateOfJoining),
    },
    {
      icon: <ShieldCheck size={18} />,
      label: "System Role",
      value: employee.designation?.name || "N/A",
    },
    { icon: <Phone size={18} />, label: "Mobile Number", value: employee.mobile || "N/A" },
    { icon: <Mail size={18} />, label: "Email Address", value: employee.email || "N/A" },
    {
      icon: <CalendarDays size={18} />,
      label: "Account Created",
      value: formatDate(employee.createdAt),
    },
  ];

  return (
    <div className="sl-page sl-page-form">
      <section className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-bold text-[color:var(--color-white)] shadow-[0_5px_0_color-mix(in_srgb,var(--color-brand)_65%,var(--color-black))]">
          {getInitials(employee.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="sl-h1">My profile</h1>
          <p className="sl-muted mt-1">
            {employee.fullName || "N/A"} · {employee.department?.name || "Employee"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="sl-chip sl-chip-success">
            <span className="h-2 w-2 rounded-full bg-[color:var(--color-success)]" aria-hidden />
            {(employee.status || "ACTIVE").charAt(0).toUpperCase() +
              (employee.status || "ACTIVE").slice(1).toLowerCase()}
          </span>
          <span className="sl-chip">
            <Shield size={14} aria-hidden />
            <span className="font-mono tracking-wider">{employee.empCode || "USER"}</span>
          </span>
        </div>
      </section>

      <section className="sl-tile p-5 sm:p-6">
        <h2 className="sl-h2 mb-4">Your details</h2>
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <RecordRow key={r.label} {...r} />
          ))}
        </dl>
      </section>
    </div>
  );
};

const RecordRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}> = ({ icon, label, value, mono }) => (
  <div className="flex items-center gap-3 rounded-[14px] bg-card-2 p-3">
    <span className="sl-icon-tile !h-10 !w-10 !rounded-[12px]" aria-hidden>
      {icon}
    </span>
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
      <dd
        className={
          "truncate text-sm font-semibold text-ink " + (mono ? "font-mono tracking-wider" : "")
        }
      >
        {value}
      </dd>
    </div>
  </div>
);

export default ProfilePage;
