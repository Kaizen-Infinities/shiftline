import React from "react";
import { cx } from "./cx";

export interface SectionLabelProps {
  children: React.ReactNode;
  /** Right-aligned extra, e.g. a "See all" link. */
  action?: React.ReactNode;
  /** Heading level or element; defaults to `h2`. */
  as?: React.ElementType;
  id?: string;
  className?: string;
}

/** Small slate label above a group of tiles or rows ("Admin", "Money"). */
export const SectionLabel: React.FC<SectionLabelProps> = ({
  children,
  action,
  as: Component = "h2",
  id,
  className,
}) => (
  <div className={cx("mb-2 flex items-center justify-between gap-3", className)}>
    <Component id={id} className="sl-section-label m-0">
      {children}
    </Component>
    {action && <div className="text-[13px] font-medium">{action}</div>}
  </div>
);

export default SectionLabel;
