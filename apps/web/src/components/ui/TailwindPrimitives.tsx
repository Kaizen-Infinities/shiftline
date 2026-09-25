import React, { createContext, useContext, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

type PrimitiveProps = React.HTMLAttributes<HTMLElement> & Record<string, unknown>;

const join = (...values: Array<string | undefined | false>) => values.filter(Boolean).join(" ");

const stripLayoutProps = (props: PrimitiveProps) => {
  const { xs, sm, md, lg, xl, xxl, fluid, ...htmlProps } = props;
  void xs;
  void sm;
  void md;
  void lg;
  void xl;
  void xxl;
  void fluid;
  return htmlProps;
};

/** Page-width wrapper with the standard gutters. */
export const Container = ({ className, ...props }: PrimitiveProps) => (
  <div
    className={join("mx-auto w-full max-w-[1920px] px-3 sm:px-4 lg:px-6", className)}
    {...stripLayoutProps(props)}
  />
);

/** Twelve-column grid row. */
export const Row = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("grid grid-cols-12 gap-4", className)} {...stripLayoutProps(props)} />
);

/** Grid column; full width unless the caller adds `col-span-*` classes. */
export const Col = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("col-span-12 min-w-0", className)} {...stripLayoutProps(props)} />
);

const CardRoot = ({ className, ...props }: PrimitiveProps) => (
  <section
    className={join("sl-tile overflow-hidden text-ink", className)}
    {...stripLayoutProps(props)}
  />
);
const CardHeader = ({ className, ...props }: PrimitiveProps) => (
  <header
    className={join(
      "border-b border-line-soft px-4 py-3.5 font-semibold text-ink sm:px-5",
      className
    )}
    {...props}
  />
);
const CardBody = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("p-4 sm:p-5", className)} {...props} />
);
/** White rounded tile with optional `Card.Header` and `Card.Body`. */
export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody });

interface ModalContextValue {
  titleId: string;
  onHide?: () => void;
}
const ModalContext = createContext<ModalContextValue | null>(null);

const MODAL_WIDTH: Record<string, string> = {
  sm: "max-w-md",
  lg: "max-w-3xl",
  xl: "max-w-5xl",
};

const ModalRoot = ({
  show,
  onHide,
  children,
  className,
  size,
  centered,
  ...props
}: PrimitiveProps & {
  show?: unknown;
  onHide?: () => void;
  size?: unknown;
  centered?: unknown;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!show) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onHide?.();
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return event.preventDefault();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [show, onHide]);

  if (!show) return null;
  void centered;
  const width = (typeof size === "string" && MODAL_WIDTH[size]) || "max-w-2xl";
  const dialog = (
    <ModalContext.Provider value={{ titleId, onHide }}>
      <div
        className="sl-backdrop z-[100] flex items-center justify-center overflow-y-auto p-3 sm:p-6"
        onMouseDown={(event) => event.target === event.currentTarget && onHide?.()}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={join(
            "sl-dialog my-auto max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto outline-none",
            width,
            className
          )}
          {...stripLayoutProps(props)}
        >
          {React.Children.map(children as React.ReactNode, (child) =>
            React.isValidElement(child)
              ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
                  "data-modal-title-id": titleId,
                })
              : child
          )}
        </div>
      </div>
    </ModalContext.Provider>
  );
  return dialog;
};
const ModalHeader = ({
  className,
  closeButton,
  children,
  onHide,
  ...props
}: PrimitiveProps & { closeButton?: unknown; onHide?: () => void }) => {
  const context = useContext(ModalContext);
  const close = onHide ?? context?.onHide;
  return (
    <header className={join("sl-dialog-header items-center", className)} {...props}>
      {children}
      {closeButton ? (
        <button
          type="button"
          onClick={close}
          aria-label="Close dialog"
          className="sl-icon-btn sl-icon-btn-md sl-icon-btn-ghost -mr-2 shrink-0"
        >
          <X size={18} aria-hidden="true" />
        </button>
      ) : null}
    </header>
  );
};
const ModalTitle = ({ className, id, ...props }: PrimitiveProps) => {
  const context = useContext(ModalContext);
  return (
    <h2
      id={(id as string | undefined) ?? context?.titleId}
      className={join("sl-dialog-title", className)}
      {...props}
    />
  );
};
const ModalBody = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("sl-dialog-body", className)} {...props} />
);
const ModalFooter = ({ className, ...props }: PrimitiveProps) => (
  <footer className={join("sl-dialog-footer", className)} {...props} />
);
/** Dialog with a soft blurred backdrop, 24px card, focus trap and Escape to close. */
export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Title: ModalTitle,
  Body: ModalBody,
  Footer: ModalFooter,
});

const BUTTON_VARIANT: Record<string, string> = {
  primary: "sl-cta",
  success: "sl-cta",
  secondary: "sl-btn",
  light: "sl-btn",
  "outline-primary": "sl-btn",
  "outline-secondary": "sl-btn",
  "outline-success": "sl-btn",
  "outline-dark": "sl-btn",
  danger: "sl-btn-danger",
  "outline-danger": "sl-btn-soft-danger",
  info: "sl-btn-blue",
  dark: "sl-btn-blue",
  link: "sl-btn-ghost",
};
const BUTTON_SIZE: Record<string, string> = { sm: "sl-pill-sm", lg: "sl-pill-lg" };

/** Pill button; `variant` picks the pill (primary/success = green CTA, secondary = white, danger). */
export const Button = ({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
  <button
    type={type}
    className={join(
      BUTTON_VARIANT[variant ?? "primary"] ?? "sl-cta",
      BUTTON_SIZE[size ?? ""] ?? "sl-pill-md",
      className
    )}
    {...props}
  />
);

const TONE_BY_BG: Record<string, string> = {
  success: "sl-chip-success",
  warning: "sl-chip-warning",
  danger: "sl-chip-danger",
  info: "sl-chip-info",
  secondary: "sl-chip-muted",
  light: "sl-chip-muted",
  dark: "sl-chip-muted",
};
/** Small chip; `bg` picks the tone (success, warning, danger, info, secondary). */
export const Badge = ({ className, bg, ...props }: PrimitiveProps & { bg?: unknown }) => (
  <span
    className={join(
      "sl-chip sl-chip-sm",
      typeof bg === "string" ? TONE_BY_BG[bg] : undefined,
      className
    )}
    {...props}
  />
);

const ALERT_TONE: Record<string, string> = {
  success: "border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10",
  warning: "border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning)]/10",
  danger: "border-[color:var(--color-danger)]/30 bg-[color:var(--color-danger)]/10",
  info: "border-[color:var(--color-info)]/30 bg-[color:var(--color-info)]/10",
};
/** Tinted notice tile; `variant` picks the tone. */
export const Alert = ({ className, variant, ...props }: PrimitiveProps & { variant?: unknown }) => (
  <div
    role="alert"
    className={join(
      "rounded-[14px] border p-3.5 text-sm text-ink",
      (typeof variant === "string" && ALERT_TONE[variant]) || "border-line-soft bg-card-2",
      className
    )}
    {...props}
  />
);
/** Thin rounded progress track with a blue fill. */
export const ProgressBar = ({
  now = 0,
  label,
  className,
  ...props
}: PrimitiveProps & { now?: number; label?: React.ReactNode }) => (
  <div className={join("h-2.5 overflow-hidden rounded-full bg-line-soft", className)} {...props}>
    <div
      className="h-full rounded-full bg-accent transition-[width]"
      style={{ width: `${Math.min(100, Math.max(0, now))}%` }}
      aria-label={typeof label === "string" ? label : undefined}
      role="progressbar"
      aria-valuenow={now}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {label}
    </div>
  </div>
);

/** Plain table with the concept header band, hairline rows and horizontal scroll. */
export const Table = ({
  className,
  hover,
  bordered,
  responsive,
  size,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  hover?: boolean;
  bordered?: boolean;
  responsive?: boolean;
  size?: string;
}) => {
  void bordered;
  void responsive;
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={join(
          "w-full min-w-[640px] border-collapse text-left text-sm text-ink",
          "[&_th]:bg-card-2 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.06em] [&_th]:text-ink-subtle [&_th]:whitespace-nowrap",
          "[&_td]:border-b [&_td]:border-line-soft [&_tr:last-child>td]:border-b-0",
          size === "sm"
            ? "[&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2"
            : "[&_td]:px-4 [&_td]:py-3 [&_th]:px-4 [&_th]:py-3",
          hover && "[&_tbody_tr:hover]:bg-nav-hover",
          className
        )}
        {...props}
      />
    </div>
  );
};

const FormGroup = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("space-y-1.5", className)} {...props} />
);
const FormLabel = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={join("sl-label", className)} {...props} />
);
const fieldClass = "sl-input min-h-11";
const FormControl = ({
  className,
  as,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { as?: string }) =>
  as === "textarea" ? (
    <textarea
      className={join(fieldClass, "py-2.5", className)}
      {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
    />
  ) : (
    <input className={join(fieldClass, className)} {...props} />
  );
const FormSelect = ({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={join(fieldClass, "cursor-pointer pr-9", className)} {...props}>
    {children}
  </select>
);
const FormText = ({ className, ...props }: PrimitiveProps) => (
  <small className={join("block text-[13px] text-ink-subtle", className)} {...props} />
);
const FormCheck = ({
  className,
  label,
  type = "checkbox",
  id,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) => (
  <label
    htmlFor={id}
    className={join(
      "inline-flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-medium text-ink",
      className
    )}
  >
    <input id={id} type={type} className="sl-check" {...props} />
    {label}
  </label>
);
/** Form with Group, Label, Control, Select, Text and Check parts in the concept field style. */
export const Form = Object.assign(
  ({ className, ...props }: React.FormHTMLAttributes<HTMLFormElement>) => (
    <form className={className} {...props} />
  ),
  {
    Group: FormGroup,
    Label: FormLabel,
    Control: FormControl,
    Select: FormSelect,
    Text: FormText,
    Check: FormCheck,
  }
);
