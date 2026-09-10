import React, { createContext, useContext, useEffect, useId, useRef } from "react";

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

export const Container = ({ className, ...props }: PrimitiveProps) => (
  <div
    className={join("mx-auto w-full max-w-[1920px] px-3 sm:px-4 lg:px-6", className)}
    {...stripLayoutProps(props)}
  />
);

export const Row = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("grid grid-cols-12 gap-4", className)} {...stripLayoutProps(props)} />
);

const spans = {
  base: [
    "",
    "col-span-1",
    "col-span-2",
    "col-span-3",
    "col-span-4",
    "col-span-5",
    "col-span-6",
    "col-span-7",
    "col-span-8",
    "col-span-9",
    "col-span-10",
    "col-span-11",
    "col-span-12",
  ],
  sm: [
    "",
    "sm:col-span-1",
    "sm:col-span-2",
    "sm:col-span-3",
    "sm:col-span-4",
    "sm:col-span-5",
    "sm:col-span-6",
    "sm:col-span-7",
    "sm:col-span-8",
    "sm:col-span-9",
    "sm:col-span-10",
    "sm:col-span-11",
    "sm:col-span-12",
  ],
  md: [
    "",
    "md:col-span-1",
    "md:col-span-2",
    "md:col-span-3",
    "md:col-span-4",
    "md:col-span-5",
    "md:col-span-6",
    "md:col-span-7",
    "md:col-span-8",
    "md:col-span-9",
    "md:col-span-10",
    "md:col-span-11",
    "md:col-span-12",
  ],
  lg: [
    "",
    "lg:col-span-1",
    "lg:col-span-2",
    "lg:col-span-3",
    "lg:col-span-4",
    "lg:col-span-5",
    "lg:col-span-6",
    "lg:col-span-7",
    "lg:col-span-8",
    "lg:col-span-9",
    "lg:col-span-10",
    "lg:col-span-11",
    "lg:col-span-12",
  ],
  xl: [
    "",
    "xl:col-span-1",
    "xl:col-span-2",
    "xl:col-span-3",
    "xl:col-span-4",
    "xl:col-span-5",
    "xl:col-span-6",
    "xl:col-span-7",
    "xl:col-span-8",
    "xl:col-span-9",
    "xl:col-span-10",
    "xl:col-span-11",
    "xl:col-span-12",
  ],
} as const;

const spanClass = (breakpoint: keyof typeof spans, value: unknown) =>
  typeof value === "number" && value >= 1 && value <= 12 ? spans[breakpoint][value] : undefined;

export const Col = ({ className, xs, sm, md, lg, xl, ...props }: PrimitiveProps) => (
  <div
    className={join(
      "col-span-12 min-w-0",
      spanClass("base", xs),
      spanClass("sm", sm),
      spanClass("md", md),
      spanClass("lg", lg),
      spanClass("xl", xl),
      className
    )}
    {...stripLayoutProps(props)}
  />
);

const CardRoot = ({ className, ...props }: PrimitiveProps) => (
  <section
    className={join(
      "overflow-hidden rounded-xl border border-line bg-card text-ink shadow-sm",
      className
    )}
    {...stripLayoutProps(props)}
  />
);
const CardHeader = ({ className, ...props }: PrimitiveProps) => (
  <header
    className={join("border-b border-line bg-head px-4 py-3 font-semibold", className)}
    {...props}
  />
);
const CardBody = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("p-4", className)} {...props} />
);
export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody });

const ModalContext = createContext<{ onHide?: () => void; titleId: string }>({ titleId: "" });

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
  void size;
  void centered;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onHide?.()}
    >
      <ModalContext.Provider value={{ onHide, titleId }}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={join(
            "my-auto max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-line bg-card text-ink shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent",
            className
          )}
          {...stripLayoutProps(props)}
        >
          {children as React.ReactNode}
        </div>
      </ModalContext.Provider>
    </div>
  );
};
const ModalHeader = ({
  className,
  closeButton,
  children,
  onHide,
  ...props
}: PrimitiveProps & { closeButton?: unknown; onHide?: () => void }) => {
  const modal = useContext(ModalContext);
  return (
    <header
      className={join(
        "flex items-center justify-between gap-3 border-b border-line px-4 py-3",
        className
      )}
      {...props}
    >
      {children}
      {closeButton ? (
        <button
          type="button"
          onClick={onHide ?? modal.onHide}
          aria-label="Close dialog"
          className="rounded-md p-2 text-ink-muted hover:bg-card-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ✕
        </button>
      ) : null}
    </header>
  );
};
const ModalTitle = ({ className, ...props }: PrimitiveProps) => {
  const { titleId } = useContext(ModalContext);
  return (
    <h2 id={titleId} className={join("text-lg font-semibold text-ink", className)} {...props} />
  );
};
const ModalBody = ({ className, ...props }: PrimitiveProps) => (
  <div className={join("p-4", className)} {...props} />
);
const ModalFooter = ({ className, ...props }: PrimitiveProps) => (
  <footer
    className={join("flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3", className)}
    {...props}
  />
);
export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Title: ModalTitle,
  Body: ModalBody,
  Footer: ModalFooter,
});

export const Button = ({
  className,
  variant,
  size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
  <button
    className={join(
      "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 font-semibold text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
);

export const Badge = ({ className, bg, ...props }: PrimitiveProps & { bg?: unknown }) => (
  <span
    className={join(
      "inline-flex rounded-full bg-card-2 px-2.5 py-1 text-xs font-semibold text-ink",
      className
    )}
    {...props}
  />
);
export const Alert = ({ className, variant, ...props }: PrimitiveProps & { variant?: unknown }) => (
  <div
    role="alert"
    className={join("rounded-lg border border-line bg-card-2 p-3 text-sm text-ink", className)}
    {...props}
  />
);
export const ProgressBar = ({
  now = 0,
  label,
  className,
  ...props
}: PrimitiveProps & { now?: number; label?: React.ReactNode }) => (
  <div className={join("h-2.5 overflow-hidden rounded-full bg-card-2", className)} {...props}>
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
  void hover;
  void bordered;
  void responsive;
  void size;
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={join(
          "w-full min-w-[640px] border-collapse text-left text-sm text-ink [&_th]:bg-head [&_th]:font-semibold [&_td]:border-b [&_td]:border-line-soft [&_td]:p-3 [&_th]:p-3",
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
  <label className={join("block text-sm font-medium text-ink", className)} {...props} />
);
const fieldClass =
  "min-h-10 w-full rounded-md border border-line bg-card px-3 py-2 text-ink outline-none placeholder:text-ink-subtle focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50";
const FormControl = ({
  className,
  as,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { as?: string }) =>
  as === "textarea" ? (
    <textarea
      className={join(fieldClass, className)}
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
  <select className={join(fieldClass, className)} {...props}>
    {children}
  </select>
);
const FormText = ({ className, ...props }: PrimitiveProps) => (
  <small className={join("text-sm text-ink-muted", className)} {...props} />
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
      "inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-ink",
      className
    )}
  >
    <input
      id={id}
      type={type}
      className="size-4 accent-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      {...props}
    />
    {label}
  </label>
);
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
