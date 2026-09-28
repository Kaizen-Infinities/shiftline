import React, { useEffect, useState } from "react";

import { useSocket } from "../../providers/SocketProvider";
import { useT } from "../../i18n/I18nProvider";

/**
 * A quiet "Live" chip: green while the real-time connection is up, amber when the browser is
 * offline or the socket has dropped (screens then fall back to polling and refresh).
 */
const LiveStatus: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { isConnected } = useSocket();
  const { t } = useT();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const live = online && isConnected;
  const label = live ? t("shell.live") : online ? t("shell.reconnecting") : t("shell.offline");
  return (
    <span
      role="status"
      title={live ? t("shell.liveOn") : t("shell.livePaused")}
      className={`sl-chip ${live ? "sl-chip-success" : "sl-chip-warning"} ${className}`}
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${
          live ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-warning)]"
        }`}
      />
      {label}
    </span>
  );
};

export default LiveStatus;
