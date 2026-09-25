import React from "react";
import { LockKeyhole } from "lucide-react";

import StatusMessage from "../../../components/layout/StatusMessage";

const UnauthorizedPage: React.FC = () => (
  <StatusMessage
    icon={<LockKeyhole size={30} aria-hidden />}
    code="Error 403"
    title="Access denied"
  >
    You don't have permission to view this page. Contact your administrator to request access.
  </StatusMessage>
);

export default UnauthorizedPage;
