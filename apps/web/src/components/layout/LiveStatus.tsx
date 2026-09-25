import React, { useEffect, useState } from "react";

import { useSocket } from "../../providers/SocketProvider";

/**
 * A quiet "Live" chip: green while the real-time connection is up, amber when the browser is
 * offline or the socket has dropped (screens then fall back to polling and refresh).
 */
const LiveStatus: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { isConnected } = useSocket();
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
  const label = live ? "Live" : online ? "Reconnecting" : "Offline";
  return (
    <span
      role="status"
      title={live ? "Real-time updates are on" : "Real-time updates are paused"}
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
