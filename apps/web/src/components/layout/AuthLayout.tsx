import React from "react";
import {
  BadgeCheck,
  Boxes,
  CalendarCheck,
  Factory,
  IndianRupee,
  LayoutDashboard,
  Receipt,
  ShieldCheck,
  Users,
} from "lucide-react";

import { BrandLockup, BrandMark } from "../brand/BrandMark";

/**
 * The concept art, drawn with tiles instead of an image: floating white pill rows with the
 * active one pale blue, a small section label, green raised pills and pale-blue chips, and grey
 * slabs for everything still to come — tilted slightly, as if seen from above.
 */
export const AuthScene: React.FC<{ className?: string }> = ({ className = "" }) => {
  const rows = [
    { icon: LayoutDashboard, label: "Dashboard", active: true },
    { icon: Receipt, label: "Sales invoices" },
    { icon: Factory, label: "Production" },
    { icon: Boxes, label: "Inventory" },
  ];
  const admin = [
    { icon: ShieldCheck, label: "GST & Compliance" },
    { icon: Users, label: "People" },
  ];
  return (
    <div className={`pointer-events-none select-none ${className}`} aria-hidden>
      <div className="sl-iso-stage grid w-[34rem] grid-cols-[13.5rem_1fr] gap-5">
        <div className="flex flex-col gap-3">
          {rows.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className={`sl-nav-item sl-iso-lift ${active ? "is-active" : ""} !py-3`}
            >
              <Icon size={18} className={active ? "text-accent" : "text-ink-muted"} />
              <span className="text-sm">{label}</span>
            </div>
          ))}
          <div className="sl-section-label mt-2">Admin</div>
          {admin.map(({ icon: Icon, label }) => (
            <div key={label} className="sl-nav-item sl-iso-lift !py-3">
              <Icon size={18} className="text-ink-muted" />
              <span className="text-sm">{label}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-4 pt-1">
          <div className="sl-float flex flex-col gap-3">
            <span className="sl-cta w-fit">
              <IndianRupee size={16} /> Run Payroll
            </span>
            <span className="sl-cta w-fit">
              <BadgeCheck size={16} /> Pay Taxes
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="sl-chip">TDS</span>
            <span className="sl-chip">PF</span>
            <span className="sl-chip">PT</span>
            <span className="sl-chip">GSTR-1</span>
          </div>
          <div className="sl-tile sl-iso-lift flex items-center gap-3 p-4">
            <span className="sl-icon-tile">
              <CalendarCheck size={20} />
            </span>
            <span className="flex flex-1 flex-col gap-2">
              <span className="sl-skeleton h-3 w-3/4 !animate-none" />
              <span className="sl-skeleton h-3 w-1/2 !animate-none" />
            </span>
          </div>
          <div className="sl-skeleton h-24 !animate-none rounded-[18px]" />
          <div className="grid grid-cols-2 gap-3">
            <div className="sl-skeleton h-16 !animate-none rounded-[18px]" />
            <div className="sl-skeleton h-16 !animate-none rounded-[18px]" />
          </div>
        </div>
      </div>
    </div>
  );
};

interface AuthLayoutProps {
  children: React.ReactNode;
  /** Left panel greeting (large screens). */
  headline?: React.ReactNode;
  subline?: React.ReactNode;
  footer?: React.ReactNode;
  /** Brand to show above the card on small screens (tenant logo when known). */
  logoUrl?: string | null;
  logoAlt?: string;
}

/** Split sign-in layout: the concept scene on the left, the form tile on the right. */
const AuthLayout: React.FC<AuthLayoutProps> = ({
  children,
  headline,
  subline,
  footer,
  logoUrl,
  logoAlt,
}) => (
  <div className="flex min-h-screen bg-page text-ink">
    <div className="relative hidden min-h-screen flex-col overflow-hidden px-12 py-10 lg:flex lg:w-[54%] xl:px-16">
      <BrandLockup size={44} />
      <div className="mt-14 max-w-xl">
        <h1 className="sl-welcome !text-[2.75rem] leading-[1.1]">
          {headline ?? (
            <>
              Welcome to <strong>Shiftline</strong>
            </>
          )}
        </h1>
        {subline && (
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-muted">{subline}</p>
        )}
      </div>
      <div className="relative flex flex-1 items-center justify-center py-8">
        <AuthScene />
      </div>
      {footer && <div className="text-xs text-ink-subtle">{footer}</div>}
    </div>

    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-10">
      <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
        {logoUrl ? (
          <img src={logoUrl} alt={logoAlt ?? ""} className="h-12 object-contain" />
        ) : (
          <BrandMark size={52} title="Shiftline" />
        )}
      </div>
      {children}
    </main>
  </div>
);

export default AuthLayout;

/** A centred single tile for simple public pages (404, 403, reset, status). */
export const CenteredPage: React.FC<{ children: React.ReactNode; wide?: boolean }> = ({
  children,
  wide,
}) => (
  <div className="flex min-h-screen flex-col items-center bg-page px-4 py-10 text-ink">
    <div className="mb-10 self-stretch sm:self-center">
      <BrandLockup size={40} />
    </div>
    <div
      className={`flex w-full flex-1 flex-col items-center justify-center ${wide ? "max-w-2xl" : "max-w-md"}`}
    >
      {children}
    </div>
  </div>
);
