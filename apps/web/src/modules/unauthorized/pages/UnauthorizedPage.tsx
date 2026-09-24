import React from "react";
import { FiLock } from "react-icons/fi";
import BackButton from "../../../components/ui/BackButton/BackButton";

const UnauthorizedPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md flex flex-col items-center text-center bg-card border border-line rounded-sm p-10">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-sm border-2 border-accent text-accent">
          <FiLock style={{ fontSize: "1.75rem" }} />
        </div>

        <div className="text-xs font-bold uppercase tracking-[0.2em] text-ink-subtle mb-2">
          Error 403
        </div>

        <h1 className="text-2xl font-bold text-ink mb-3">Access denied</h1>

        <p className="text-ink-muted mb-8 leading-relaxed">
          You don't have permission to view this page. Contact your administrator to request access.
        </p>

        <BackButton to="/dashboard" text="Go to Dashboard" />
      </div>
    </div>
  );
};

export default UnauthorizedPage;
