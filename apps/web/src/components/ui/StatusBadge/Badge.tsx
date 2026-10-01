// src/components/ui/StatusBadge/StatusBadge.tsx
import React from "react";

import { useT } from "../../../i18n/I18nProvider";

export type StatusTone = "default" | "muted" | "success" | "warning" | "danger" | "info";

interface StatusBadgeProps {
  status: string;
  className?: string;
  customText?: string;
  /**
   * Legacy explicit colours. Hex/rgb pairs are read as a tone (so they follow the theme);
   * `var(...)` / `color-mix(...)` values are applied as given.
   */
  customColor?: { bg: string; text: string };
  /** Explicit chip tone; wins over the status lookup and `customColor`. */
  tone?: StatusTone;
  title?: string;
  style?: React.CSSProperties;
  /**
   * TN-04: show the status in the viewer's language (shop-floor and store screens only;
   * accounting screens leave it off and stay English).
   */
  translate?: boolean;
}

/** Status → chip tone. Anything unknown is a muted chip. */
const statusTones: Record<string, StatusTone> = {
  // ========== DRAFT & GENERAL ==========
  DRAFT: "muted",
  OPEN: "default",
  PARTIALLY_RECEIVED: "warning",
  CLOSED: "muted",
  MONTHLY: "default",
  WEEKLY: "warning",

  // ========== MD APPROVAL FLOW ==========
  PENDING_MD_APPROVAL: "warning",
  MD_APPROVED: "success",
  MD_REJECTED: "danger",

  // ========== CUSTOMER APPROVAL FLOW ==========
  PENDING_CUSTOMER_APPROVAL: "warning",
  CUSTOMER_APPROVED: "success",
  CUSTOMER_REJECTED: "danger",

  // ========== CONFIRMED & QUOTATION ==========
  CONFIRMED: "default",
  QUOTATION_IN_PROGRESS: "info",
  QUOTATION_COMPLETED: "info",

  // ========== PRODUCTION FLOW ==========
  PLANNED: "default",
  MATERIAL_PENDING: "warning",
  MATERIAL_RESERVED: "warning",
  MATERIAL_ISSUED: "warning",
  SCHEDULED: "success",
  IN_PROGRESS: "default",
  ON_HOLD: "danger",
  IN_PRODUCTION: "default",
  STOPPED: "danger",
  POST_PRODUCTION: "info",

  // ========== COMPLETION & DISPATCH ==========
  FG_RECEIVED: "success",
  READY_FOR_DISPATCH: "success",
  PARTIALLY_DISPATCHED: "warning",
  DISPATCHED: "success",
  PENDING_GATE_APPROVAL: "warning",
  PENDING_STORE_RECEIPT: "default",
  WAREHOUSE_RECEIVED: "success",
  GATE_REJECTED: "danger",
  STORE_REJECTED: "danger",

  // ========== FINAL STATES ==========
  COMPLETED: "success",
  SHORT_CLOSED: "warning",
  PARTIAL_COMPLETED: "default",
  COMPLETED_WITH_SHORTFALL: "danger",
  CANCELLED: "muted",

  // ========== LEGACY/COMMON STATUSES (for other modules) ==========
  ACTIVE: "success",
  INACTIVE: "danger",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  AVAILABLE: "success",
  INSUFFICIENT: "danger",

  // Production Orders
  RM_AVAILABLE: "success",
  RM_PENDING: "warning",
  SCHEDULE_DELETED: "danger",

  // ========== SALES ORDER WORKFLOW ==========
  QUOTED: "info",
  INVOICED: "success",

  // ========== INVOICE PAYMENT STATUSES ==========
  UNPAID: "danger",
  PARTIALLY_PAID: "warning",
  PAID: "success",

  // Priorities
  HIGH: "danger",
  URGENT: "danger",
  MEDIUM: "warning",
  LOW: "success",
};

const TONE_CLASS: Record<StatusTone, string> = {
  default: "",
  muted: "sl-chip-muted",
  success: "sl-chip-success",
  warning: "sl-chip-warning",
  danger: "sl-chip-danger",
  info: "sl-chip-info",
};

/** Reads "#065f46" / "rgb(6,95,70)" / "rgba(…)" into [r, g, b]; null for anything else. */
const parseColor = (value: string): [number, number, number] | null => {
  const v = value.trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
};

/** Maps a legacy text colour to the nearest chip tone by hue, so it follows the theme. */
const toneFromColor = (value: string): StatusTone | null => {
  const rgb = parseColor(value);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.2) return "muted";
  let hue = 0;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  if (hue < 18 || hue >= 330) return "danger";
  if (hue < 65) return "warning";
  if (hue < 175) return "success";
  if (hue < 250) return "default";
  return "info";
};

/** Status chip: the status name in words, coloured by what it means (done, waiting, blocked). */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className = "",
  customText,
  customColor,
  tone,
  title,
  style,
  translate = false,
}) => {
  const { tDynamic } = useT();
  const normalizedStatus = (status || "").toUpperCase().replace(/\s+/g, "_");

  // Explicit tone → legacy colour pair read as a tone → status lookup → muted.
  const legacyTone = customColor ? toneFromColor(customColor.text) : null;
  const inlineColor =
    customColor && !legacyTone && !tone
      ? { backgroundColor: customColor.bg, color: customColor.text }
      : undefined;
  const resolvedTone: StatusTone =
    tone ?? legacyTone ?? (customColor ? "muted" : (statusTones[normalizedStatus] ?? "muted"));

  // Format display text: "PENDING_MD_APPROVAL" → "Pending MD Approval"
  let displayText = customText;
  if (!displayText) {
    if (normalizedStatus === "POST_PRODUCTION") {
      displayText = "Post Production";
    } else {
      displayText = (status || "UNKNOWN")
        .replace(/_/g, " ")
        .toLowerCase()
        .split(" ")
        .map((word) => {
          // Keep common acronyms uppercase
          if (["md", "rm", "fg", "wip", "grn"].includes(word)) {
            return word.toUpperCase();
          }
          return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(" ");
    }
  }

  if (translate && !customText) displayText = tDynamic(`status.${normalizedStatus}`, displayText);

  return (
    <span
      className={`sl-chip sl-chip-sm ${inlineColor ? "" : TONE_CLASS[resolvedTone]} ${className}`}
      title={title}
      style={{ ...inlineColor, ...style }}
    >
      <span className="sl-chip-dot" aria-hidden="true" />
      {displayText}
    </span>
  );
};

export default StatusBadge;
