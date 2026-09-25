import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

import type { Crumb } from "../../navigation/nav.types";

/**
 * Where you are, from the navigation config. On small screens only the last crumb shows, as
 * the page title of the top bar; the same element serves both widths.
 */
const Breadcrumbs: React.FC<{ crumbs: Crumb[] }> = ({ crumbs }) => {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li
              key={`${crumb.label}-${i}`}
              className={`items-center gap-1.5 ${last ? "flex min-w-0" : "hidden shrink-0 lg:flex"}`}
            >
              {last ? (
                <span
                  aria-current="page"
                  className="truncate text-base font-semibold tracking-[-0.01em] text-ink lg:text-[0.9375rem]"
                >
                  {crumb.label}
                </span>
              ) : crumb.path ? (
                <Link
                  to={crumb.path}
                  className="truncate rounded-md font-medium text-ink-subtle hover:text-ink"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-ink-subtle">{crumb.label}</span>
              )}
              {!last && <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-subtle" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumbs;
