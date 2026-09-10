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
      className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500"
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
    className={`rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-60 ${className ?? ""}`}
  />
);

export const SecondaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => (
  <button
    {...props}
    type={props.type ?? "button"}
    className={`rounded-xl border border-line-soft bg-card-2 px-4 py-2.5 text-sm font-semibold text-ink hover:bg-card disabled:opacity-60 ${className ?? ""}`}
  />
);

export const Actions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-5">
    {children}
  </div>
);
