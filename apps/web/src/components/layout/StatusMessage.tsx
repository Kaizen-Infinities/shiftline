import React from "react";
import { Link } from "react-router-dom";

import { CenteredPage } from "./AuthLayout";

interface StatusMessageProps {
  icon: React.ReactNode;
  code?: string;
  title: string;
  children: React.ReactNode;
  /** Primary action; defaults to the dashboard. */
  action?: { label: string; to: string };
  secondary?: React.ReactNode;
  testId?: string;
}

/** Full-page message (404, 403, upgrade): one tile, one green way forward. */
const StatusMessage: React.FC<StatusMessageProps> = ({
  icon,
  code,
  title,
  children,
  action = { label: "Go to Dashboard", to: "/dashboard" },
  secondary,
  testId,
}) => (
  <CenteredPage>
    <div
      className="sl-tile flex w-full flex-col items-center !rounded-[24px] px-7 py-10 text-center sm:px-10"
      data-testid={testId}
    >
      <span className="sl-icon-tile !h-16 !w-16 !rounded-[20px]">{icon}</span>
      {code && <span className="sl-chip sl-chip-muted mt-6">{code}</span>}
      <h1 className="sl-h1 mt-4">{title}</h1>
      <div className="sl-muted mt-3 leading-relaxed">{children}</div>
      <Link to={action.to} className="sl-cta mt-8">
        {action.label}
      </Link>
      {secondary && <div className="mt-4 text-sm">{secondary}</div>}
    </div>
  </CenteredPage>
);

export default StatusMessage;
