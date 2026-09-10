import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import ThemeToggle from "../common/ThemeToggle";

interface PublicShellProps {
  children: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  companyName?: string | null;
  logoUrl?: string | null;
  compact?: boolean;
}

const PublicShell = ({
  children,
  eyebrow,
  title,
  description,
  companyName,
  logoUrl,
  compact,
}: PublicShellProps) => (
  <main className="relative min-h-dvh overflow-hidden bg-page text-ink">
    <div
      aria-hidden="true"
      className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.12),transparent_38%)]"
    />
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
      <Link
        to="/login"
        className="flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <img src={logoUrl || "/favicon.svg"} alt="" className="size-9 rounded-lg object-contain" />
        <span className="text-base font-extrabold tracking-tight">
          {companyName || "Shiftline"}
        </span>
      </Link>
      <ThemeToggle />
    </header>
    <div
      className={`relative z-10 mx-auto grid min-h-[calc(100dvh-76px)] max-w-7xl items-center gap-10 px-4 py-8 sm:px-6 lg:px-8 ${compact ? "max-w-2xl" : "lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)]"}`}
    >
      {!compact && (
        <section className="hidden max-w-2xl lg:block" aria-labelledby="public-shell-title">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.2em] text-accent">
            Manufacturing, in rhythm
          </p>
          <h1
            id="public-shell-title"
            className="text-5xl font-black leading-[1.08] tracking-tight xl:text-6xl"
          >
            Run every shift with clarity.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-ink-muted">
            Production, inventory, sales, purchasing, people, finance, and compliance—connected in
            one secure workspace.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3" aria-label="Platform capabilities">
            {[
              ["Live", "Shop-floor visibility"],
              ["Secure", "Role-based access"],
              ["Indian", "Finance and compliance"],
            ].map(([value, label]) => (
              <div
                key={value}
                className="rounded-xl border border-line bg-card/70 p-4 shadow-sm backdrop-blur"
              >
                <strong className="block text-accent">{value}</strong>
                <span className="mt-1 block text-xs leading-5 text-ink-muted">{label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <section
        className="w-full rounded-2xl border border-line bg-card/95 p-5 shadow-2xl backdrop-blur sm:p-8"
        aria-labelledby="public-form-title"
      >
        {eyebrow && (
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-accent">
            {eyebrow}
          </p>
        )}
        <h2 id="public-form-title" className="text-2xl font-black tracking-tight sm:text-3xl">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{description}</p>
        <div className="mt-7">{children}</div>
      </section>
    </div>
  </main>
);

export default PublicShell;
