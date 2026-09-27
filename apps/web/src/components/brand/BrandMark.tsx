import React from "react";

/**
 * The Shiftline mark: a blue rounded tile standing on a darker raised edge, carrying a white
 * arrow that shifts up and to the right, folded like a paper plane. Colours come from the
 * theme tokens, so the mark follows light and dark mode. `public/favicon.svg` is the same
 * drawing with fixed colours.
 */
export interface BrandMarkProps {
  /** Rendered width and height in pixels. */
  size?: number;
  /** Accessible name; omit when a visible wordmark sits next to the mark. */
  title?: string;
  className?: string;
}

export const BrandMark: React.FC<BrandMarkProps> = ({ size = 40, title, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 48 48"
    className={className}
    role={title ? "img" : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    focusable="false"
  >
    {/* Raised edge */}
    <rect
      x="0"
      y="4"
      width="48"
      height="44"
      rx="13"
      style={{ fill: "color-mix(in srgb, var(--color-brand) 62%, var(--color-black))" }}
    />
    {/* Tile */}
    <rect x="0" y="0" width="48" height="44" rx="13" style={{ fill: "var(--color-brand)" }} />
    {/* Soft top light, for the concept's slight isometric feel */}
    <path
      d="M13 0h22a13 13 0 0 1 13 13v2H0v-2A13 13 0 0 1 13 0Z"
      style={{ fill: "var(--color-white)", opacity: 0.1 }}
    />
    {/* The arrow: a paper plane heading up and to the right, its lower wing shaded as a fold */}
    <path d="M36.5 9.5 9.5 20.2l11.3 3.9Z" style={{ fill: "var(--color-white)" }} />
    <path d="M36.5 9.5 20.8 24.1l4.6 11.2Z" style={{ fill: "var(--color-white)", opacity: 0.78 }} />
    <path d="M20.8 24.1v7.4l3-3.6Z" style={{ fill: "var(--color-white)", opacity: 0.55 }} />
  </svg>
);

/** Who makes Shiftline: shown under the wordmark and in footers. */
export const MAKER = {
  short: "Applied Softwares",
  full: "Applied Softwares, a division of Kaizen Infinities",
  url: "https://kaizeninfinities.com/",
} as const;

/** Mark and wordmark side by side, as in the sidebar and on the sign-in page. */
export const BrandLockup: React.FC<{
  size?: number;
  className?: string;
  wordmarkClassName?: string;
}> = ({ size = 40, className = "", wordmarkClassName = "" }) => (
  <span className={`inline-flex items-center gap-3 ${className}`}>
    <BrandMark size={size} />
    <span className="flex flex-col leading-none">
      <span
        className={`text-[1.3rem] font-bold tracking-[-0.02em] text-ink leading-none ${wordmarkClassName}`}
      >
        Shiftline
      </span>
      <span className="mt-1 text-[11px] font-medium tracking-[0.01em] text-ink-subtle">
        by {MAKER.short}
      </span>
    </span>
  </span>
);

export default BrandMark;
