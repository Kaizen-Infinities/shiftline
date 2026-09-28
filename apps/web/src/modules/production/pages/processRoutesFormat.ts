import { humanize } from "../ui";

/** Formatting shared by the process route and lot board screens (TN-06). */
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, "")}%`;
export const stepLabel = (name: string) => humanize(name);
