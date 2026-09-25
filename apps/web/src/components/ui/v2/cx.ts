/** Joins class names, skipping empty and falsy values. */
export const cx = (...values: Array<string | false | null | undefined | 0>): string =>
  values.filter(Boolean).join(" ");

export default cx;
