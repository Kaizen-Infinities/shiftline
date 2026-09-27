import React from "react";
import PrefetchProgressBar from "../../providers/PrefetchProgressBar";
import { MAKER } from "../brand/BrandMark";

const Footer: React.FC = () => {
  const nowYear = new Date().getFullYear();
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-[13px] text-ink-subtle sm:px-6">
      <p className="shrink-0">© {nowYear} Shiftline. All rights reserved.</p>

      {/* Center — prefetch progress (only visible on /accounts routes while a
          background burst is in flight). Hidden otherwise. */}
      <div className="flex-1 flex justify-center min-w-0">
        <PrefetchProgressBar />
      </div>

      <p className="shrink-0">
        Made by{" "}
        <a
          href={MAKER.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent hover:underline"
        >
          {MAKER.full}
        </a>
      </p>
    </footer>
  );
};

export default Footer;
