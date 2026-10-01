import React, { useState } from "react";
import { FiX } from "react-icons/fi";

const DISMISS_KEY = "shiftline-beta-notice-dismissed";
// Where feedback goes; set VITE_FEEDBACK_EMAIL for the deployment. Without it the notice
// still shows, just without the mail link.
const FEEDBACK_EMAIL = (import.meta.env.VITE_FEEDBACK_EMAIL as string | undefined)?.trim();

const readDismissed = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

/** A slim, dismissible line under the top of the app shell: Shiftline is in beta. */
const BetaNotice: React.FC = () => {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode or blocked storage: it just shows again next time.
    }
  };

  return (
    <div
      role="note"
      aria-label="Beta notice"
      className="flex items-center justify-center gap-3 border-b border-line-soft bg-chip px-4 py-1.5 text-[13px] text-chip-fg"
    >
      <span className="sl-chip !bg-card !px-2 !py-0 text-[10px] font-bold uppercase tracking-[0.08em]">
        Beta
      </span>
      <span className="min-w-0 truncate">
        Shiftline is in beta — tell us what breaks.
        {FEEDBACK_EMAIL && (
          <>
            {" "}
            <a
              href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Shiftline beta feedback")}`}
              className="font-semibold underline underline-offset-2"
            >
              Send feedback
            </a>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss beta notice"
        className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full hover:bg-card"
      >
        <FiX aria-hidden="true" />
      </button>
    </div>
  );
};

export default BetaNotice;
