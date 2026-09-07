import React from "react";
import { FaHistory } from "react-icons/fa";
import { Link } from "react-router-dom";

import { usePermission } from "../../../hooks/usePermission";

/**
 * "History" link to the audit trail for one record (P1-10d). Renders nothing for users without
 * `audit-reports.view`. `entity` is the table name the audit trigger records.
 */
const HistoryLink: React.FC<{ entity: string; entityId: string; className?: string }> = ({
  entity,
  entityId,
  className = "",
}) => {
  const { can } = usePermission();
  if (!can("audit-reports.view")) return null;
  return (
    <Link
      to={`/reports/audit?entity=${encodeURIComponent(entity)}&entityId=${encodeURIComponent(entityId)}`}
      title="History (audit trail)"
      className={`inline-flex items-center justify-center rounded border border-line bg-card-2 p-1 text-ink-muted hover:bg-line hover:text-ink ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <FaHistory className="h-3 w-3" />
    </Link>
  );
};

export default HistoryLink;
