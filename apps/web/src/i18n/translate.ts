import type { Locale } from "@shiftline/shared";

import { en, type MessageKey, type Messages } from "./en";
import { ta } from "./ta";

/** Every dictionary, keyed by locale. English is the source of keys and the fallback. */
export const DICTIONARIES: Record<Locale, Messages> = { en, ta };

export type TranslateVars = Record<string, string | number>;

/** Numbers stay in Indian-English digits whatever the UI language (TN-04). */
const numberFormat = new Intl.NumberFormat("en-IN");

const interpolate = (template: string, vars?: TranslateVars): string =>
  vars
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = vars[name];
        if (value === undefined) return match;
        return typeof value === "number" ? numberFormat.format(value) : value;
      })
    : template;

/**
 * Looks a key up in the locale's dictionary; a missing or blank translation falls back to the
 * English text, and an unknown key (a dynamic nav id, say) to `fallback` or the key itself.
 */
export const lookup = (locale: Locale, key: string): string | undefined => {
  const own = (DICTIONARIES[locale] as Record<string, string | undefined>)[key];
  if (own && own.trim()) return own;
  const source = (en as Record<string, string | undefined>)[key];
  return source && source.trim() ? source : undefined;
};

export const translate = (locale: Locale, key: MessageKey, vars?: TranslateVars): string =>
  interpolate(lookup(locale, key) ?? key, vars);

/** For keys built at run time (nav ids): returns `fallback` when the key has no entry. */
export const translateDynamic = (
  locale: Locale,
  key: string,
  fallback: string,
  vars?: TranslateVars
): string => interpolate(lookup(locale, key) ?? fallback, vars);

export const hasMessage = (key: string): key is MessageKey => key in en;
