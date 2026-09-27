import React from "react";

import { Chip, StatTile, Tile, type ChipTone } from "../../components/ui/v2";

/** Shared bits for the platform console pages (P1-02), in the UI v2 look. */
export const input = "sl-input h-11 py-0 text-sm";
export const btn = "sl-pill-sm";
export const primary = "sl-btn-blue sl-pill-sm";
export const secondary = "sl-btn sl-pill-sm";
export const danger = "sl-btn-soft-danger sl-pill-sm";
export const th = "sl-th bg-card-2 px-3 py-2.5 text-left first:rounded-l-xl last:rounded-r-xl";
export const td = "px-3 py-2.5 text-sm text-ink";

export const message = (err: unknown) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  (err as Error)?.message ??
  "Something went wrong";

export const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

const TONE: Record<string, ChipTone> = {
  ACTIVE: "success",
  TRIALING: "info",
  PAST_DUE: "warning",
  SUSPENDED: "danger",
  CANCELLED: "muted",
  active: "success",
  suspended: "danger",
  locked: "warning",
};
const LABEL: Record<string, string> = {
  ACTIVE: "Active",
  TRIALING: "Trialing",
  PAST_DUE: "Past due",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
  active: "Active",
  suspended: "Suspended",
  locked: "Locked",
};

/** A status as a chip with a dot; unknown values show as they came, muted. */
export const Badge: React.FC<{ value: string | null | undefined }> = ({ value }) =>
  value ? (
    <Chip tone={TONE[value] ?? "muted"} size="sm" dot>
      {LABEL[value] ?? value}
    </Chip>
  ) : (
    <span className="text-ink-subtle">—</span>
  );

export const Stat: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
}> = ({ label, value, hint, icon }) => (
  <StatTile label={label} value={value} hint={hint} icon={icon} />
);

export const Section: React.FC<{
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, right, children, icon }) => (
  <Tile title={title} actions={right} icon={icon}>
    {children}
  </Tile>
);
