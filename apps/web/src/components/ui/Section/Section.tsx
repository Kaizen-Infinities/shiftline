// src/components/ui/Section/Section.tsx
import React from "react";

export interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode; // optional right-aligned header action, e.g. an "Add Item" button
}

/** Form/detail section: a tile with an `.sl-h2` heading, optional icon and a right-hand action. */
const Section: React.FC<SectionProps> = ({ title, icon, children, className = "", action }) => (
  <section className={`sl-tile mb-4 p-4 sm:p-5 ${className}`}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-chip text-accent"
          >
            {icon}
          </span>
        )}
        <h2 className="sl-h2 m-0 truncate">{title}</h2>
      </div>

      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>

    {children}
  </section>
);

export default Section;
