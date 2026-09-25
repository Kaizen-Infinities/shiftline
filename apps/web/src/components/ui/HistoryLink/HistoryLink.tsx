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
      aria-label="History (audit trail)"
      className={`sl-icon-btn sl-icon-btn-hover-primary ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <FaHistory className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
};

export default HistoryLink;
