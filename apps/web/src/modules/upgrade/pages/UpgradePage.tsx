import React from "react";
import { useSearchParams } from "react-router-dom";
import { FEATURES } from "@shiftline/shared";
import { Sparkles } from "lucide-react";

import StatusMessage from "../../../components/layout/StatusMessage";
import { useEntitlement } from "../../../hooks/useEntitlement";

/** Shown when a screen's feature is not in the tenant's plan (P1-01). */
const UpgradePage: React.FC = () => {
  const [params] = useSearchParams();
  const key = params.get("feature") ?? "";
  const feature = FEATURES.find((f) => f.key === key);
  const { planName, readOnly } = useEntitlement();

  return (
    <StatusMessage
      testId="upgrade-page"
      icon={<Sparkles size={30} aria-hidden />}
      code={readOnly ? "Subscription" : "Not in your plan"}
      title={
        readOnly ? "Subscription paused" : `${feature?.name ?? "This feature"} is not in your plan`
      }
      secondary={
        planName && !readOnly ? (
          <span className="text-ink-muted">
            You are on the <span className="sl-chip">{planName}</span> plan. Ask your account owner
            to contact Kaizen Infinities to add it.
          </span>
        ) : null
      }
    >
      {readOnly
        ? "Your subscription is not active. You can view and export data, but changes are blocked until it is renewed."
        : (feature?.description ??
          "The screen you opened belongs to a feature your company has not subscribed to.")}
    </StatusMessage>
  );
};

export default UpgradePage;
