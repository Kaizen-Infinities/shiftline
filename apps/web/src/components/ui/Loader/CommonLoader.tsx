import React from "react";

interface CommonLoaderProps {
  text: string;
  fullScreen?: boolean;
}

/** Loading placeholder in the concept's grey slabs; `text` is announced to screen readers. */
const CommonLoader: React.FC<CommonLoaderProps> = ({ text, fullScreen = true }) => {
  if (fullScreen) {
    return (
      <div role="status" aria-live="polite" className="relative min-h-screen w-full px-1 py-6">
        <span className="sr-only">{text}</span>
        <div aria-hidden="true" className="mx-auto flex max-w-[1600px] flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-2.5">
              <div className="sl-skeleton h-7 w-56" />
              <div className="sl-skeleton h-3.5 w-80 max-w-[60vw]" />
            </div>
            <div className="sl-skeleton hidden h-11 w-36 !rounded-full sm:block" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="sl-tile flex flex-col gap-3 p-5">
                <div className="sl-skeleton h-3 w-1/3" />
                <div className="sl-skeleton h-7 w-2/3" />
              </div>
            ))}
          </div>
          <div className="sl-tile flex flex-col gap-4 p-5">
            {[72, 88, 64, 80, 56].map((w, i) => (
              <div key={i} className="sl-skeleton h-3.5" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
        <p aria-hidden="true" className="mt-6 text-center text-[13px] font-medium text-ink-subtle">
          {text}
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex min-h-[250px] w-full flex-1 flex-col justify-center gap-3.5 px-2 py-8"
    >
      <span className="sr-only">{text}</span>
      {[82, 64, 90, 48].map((w, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="sl-skeleton h-3.5"
          style={{ width: `${w}%`, opacity: 1 - i * 0.14 }}
        />
      ))}
      <p
        aria-hidden="true"
        className="m-0 mt-1 text-center text-[13px] font-medium text-ink-subtle"
      >
        {text}
      </p>
    </div>
  );
};

export default CommonLoader;
