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
import { useT } from "../../i18n/I18nProvider";
import LanguageSwitch from "../../components/layout/LanguageSwitch";

const formatDate = (date?: string | null, fallback = "N/A") =>
  date
    ? new Date(date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : fallback;

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
  const { t } = useT();
  const na = t("common.notAvailable");

  if (loading || !employee) {
    return (
      <div
        className="flex max-w-[1024px] flex-col gap-6 pt-2"
        aria-busy="true"
        aria-label={t("profile.loading")}
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
      label: t("profile.empCode"),
      value: employee.empCode || na,
      mono: true,
    },
    {
      icon: <Briefcase size={18} />,
      label: t("profile.department"),
      value: employee.department?.name || na,
    },
    {
      icon: <CalendarDays size={18} />,
      label: t("profile.joined"),
      value: formatDate(employee.dateOfJoining, na),
    },
    {
      icon: <ShieldCheck size={18} />,
      label: t("profile.role"),
      value: employee.designation?.name || na,
    },
    { icon: <Phone size={18} />, label: t("profile.mobile"), value: employee.mobile || na },
    { icon: <Mail size={18} />, label: t("profile.email"), value: employee.email || na },
    {
      icon: <CalendarDays size={18} />,
      label: t("profile.accountCreated"),
      value: formatDate(employee.createdAt, na),
    },
  ];

  return (
    <div className="sl-page sl-page-form">
      <section className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-bold text-[color:var(--color-white)] shadow-[0_5px_0_color-mix(in_srgb,var(--color-brand)_65%,var(--color-black))]">
          {getInitials(employee.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="sl-h1">{t("profile.title")}</h1>
          <p className="sl-muted mt-1">
            {employee.fullName || na} · {employee.department?.name || t("profile.employee")}
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
        <h2 className="sl-h2 mb-4">{t("profile.yourDetails")}</h2>
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <RecordRow key={r.label} {...r} />
          ))}
        </dl>
      </section>

      <section className="sl-tile p-5 sm:p-6" data-testid="profile-language">
        <h2 className="sl-h2 mb-1">{t("profile.preferences")}</h2>
        <p className="sl-muted mb-4 text-sm">{t("language.help")}</p>
        <LanguageSwitch className="max-w-xs" />
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
