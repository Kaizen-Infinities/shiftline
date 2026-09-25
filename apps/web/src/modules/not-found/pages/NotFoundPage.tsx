import React from "react";
import { Compass } from "lucide-react";

import StatusMessage from "../../../components/layout/StatusMessage";

const NotFoundPage: React.FC = () => (
  <StatusMessage icon={<Compass size={30} aria-hidden />} code="Error 404" title="Page not found">
    The page you are looking for might have been removed, renamed, or is temporarily unavailable.
    Press <span className="sl-kbd">Ctrl</span> <span className="sl-kbd">K</span> in the app to
    search for any screen.
  </StatusMessage>
);

export default NotFoundPage;
