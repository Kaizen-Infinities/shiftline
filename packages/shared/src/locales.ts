/**
 * UI languages a user may pick (TN-04). English is the source language and the fallback for
 * any string a translation lacks; Tamil is the first extra locale.
 */
export const SUPPORTED_LOCALES = ["en", "ta"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);

/** Normalises whatever is stored or sent to a supported locale (unknown values become English). */
export const toLocale = (value: unknown): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);
