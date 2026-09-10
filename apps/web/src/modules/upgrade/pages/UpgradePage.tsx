import React from "react";
import { useSearchParams } from "react-router-dom";
import { FEATURES } from "@shiftline/shared";
import { FiLock } from "react-icons/fi";
import BackButton from "../../../components/ui/BackButton/BackButton";
import { useEntitlement } from "../../../hooks/useEntitlement";

/** Shown when a screen's feature is not in the tenant's plan (P1-01). */
const UpgradePage: React.FC = () => {
  const [params] = useSearchParams();
  const key = params.get("feature") ?? "";
  const feature = FEATURES.find((f) => f.key === key);
  const { planName, readOnly } = useEntitlement();

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4 text-ink">
      <div
        className="text-center max-w-md w-full flex flex-col items-center"
        data-testid="upgrade-page"
      >
        <div className="flex items-center justify-center w-24 h-24 mx-auto mb-6 bg-amber-500/15 rounded-full">
          <FiLock className="text-amber-500" style={{ fontSize: "2.5rem" }} />
        </div>
        <h1 className="text-2xl font-bold mb-3">
          {readOnly
            ? "Subscription paused"
            : `${feature?.name ?? "This feature"} is not in your plan`}
        </h1>
        <p className="text-ink-muted mb-2 leading-relaxed">
          {readOnly
            ? "Your subscription is not active. You can view and export data, but changes are blocked until it is renewed."
            : (feature?.description ??
              "The screen you opened belongs to a feature your company has not subscribed to.")}
        </p>
        {planName && !readOnly && (
          <p className="text-sm text-ink-muted mb-8">
            You are on the <strong>{planName}</strong> plan. Ask your account owner to contact
            Kaizen Infinities to add it.
          </p>
        )}
        <BackButton to="/dashboard" text="Go to Dashboard" />
      </div>
    </div>
  );
};

export default UpgradePage;
