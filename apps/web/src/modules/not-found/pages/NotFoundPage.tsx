import React from "react";
import { FiAlertCircle } from "react-icons/fi";
import BackButton from "../../../components/ui/BackButton/BackButton";

const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md flex flex-col items-center text-center bg-card border border-line rounded-sm p-10">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-sm border-2 border-accent text-accent">
          <FiAlertCircle style={{ fontSize: "1.75rem" }} />
        </div>

        <div className="text-xs font-bold uppercase tracking-[0.2em] text-ink-subtle mb-2">
          Error 404
        </div>

        <h1 className="text-2xl font-bold text-ink mb-3">Page not found</h1>

        <p className="text-ink-muted mb-8 leading-relaxed">
          The page you are looking for might have been removed, renamed, or is temporarily
          unavailable.
        </p>

        <BackButton to="/dashboard" text="Go to Dashboard" />
      </div>
    </div>
  );
};

export default NotFoundPage;
