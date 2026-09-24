import React from "react";

/** Small form primitives shared by the onboarding steps (Tailwind, theme tokens). */

export const Field: React.FC<{
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, hint, className, children }) => (
  <label
    className={`block text-xs font-bold uppercase tracking-wider text-ink-muted ${className ?? ""}`}
  >
    {label}
    {children}
    {hint && (
      <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-ink-muted/80">
        {hint}
      </span>
    )}
  </label>
);

export const StepHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="mb-6">
    <h2 className="text-xl font-bold text-ink">{title}</h2>
    <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
  </div>
);

export const ErrorBox: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div
      role="alert"
      className="mt-4 rounded-sm border border-[color:var(--color-danger)]/40 bg-card-2 px-3 py-2 text-sm text-[color:var(--color-danger)] font-medium"
    >
      {message}
    </div>
  ) : null;

export const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => (
  <button
    {...props}
    className={`min-h-10 rounded-sm bg-accent px-5 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${className ?? ""}`}
  />
);

export const SecondaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => (
  <button
    {...props}
    type={props.type ?? "button"}
    className={`min-h-10 rounded-sm border border-line bg-card-2 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-card disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className ?? ""}`}
  />
);

export const Actions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
    {children}
  </div>
);
