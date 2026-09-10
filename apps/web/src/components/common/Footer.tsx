import React from "react";
import PrefetchProgressBar from "../../providers/PrefetchProgressBar";

const Footer: React.FC = () => {
  const nowYear = new Date().getFullYear();
  return (
    <footer className="flex flex-wrap items-center justify-center px-3 sm:px-6 py-2 sm:py-3 bg-card border-t border-line text-xs sm:text-sm text-ink-subtle shrink-0 gap-x-4 gap-y-1 sm:justify-between">
      <p className="shrink-0 text-center">© {nowYear} Shiftline. All rights reserved.</p>

      {/* Center — prefetch progress (only visible on /accounts routes while a
          background burst is in flight). Hidden otherwise. */}
      <div className="order-last flex w-full justify-center min-w-0 sm:order-none sm:w-auto sm:flex-1">
        <PrefetchProgressBar />
      </div>

      <p className="shrink-0 text-center">
        Developed by{" "}
        <a
          href="https://kaizeninfinities.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-semibold"
        >
          Kaizen Infinities
        </a>
      </p>
    </footer>
  );
};

export default Footer;
