import React from "react";

/** Small form primitives shared by the onboarding steps (UI v2 `.sl-*` classes, theme tokens). */

export const Field: React.FC<{
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, hint, className, children }) => (
  <label className={`block text-sm font-semibold text-ink-muted ${className ?? ""}`}>
    {label}
    {children}
    {hint && <span className="mt-1.5 block text-xs font-normal text-ink-subtle">{hint}</span>}
  </label>
);

export const StepHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <div className="mb-7">
    <h2 className="sl-h1 !text-[1.5rem]">{title}</h2>
    <p className="sl-muted mt-1.5 max-w-2xl text-sm leading-relaxed">{subtitle}</p>
  </div>
);

export const ErrorBox: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div role="alert" className="sl-chip-danger mt-5 rounded-[14px] px-4 py-3 text-sm font-medium">
      {message}
    </div>
  ) : null;

export const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => <button {...props} className={`sl-cta ${className ?? ""}`} />;

export const SecondaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
  className,
  ...props
}) => <button {...props} type={props.type ?? "button"} className={`sl-btn ${className ?? ""}`} />;

export const Actions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-6">
    {children}
  </div>
);
