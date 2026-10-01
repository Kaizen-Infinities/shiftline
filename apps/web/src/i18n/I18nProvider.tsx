import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, toLocale, type Locale } from "@shiftline/shared";

import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { setUserLocale } from "../features/auth/authSlice";
import { profileService } from "../services/profileService";
import type { MessageKey } from "./en";
import { translate, translateDynamic, type TranslateVars } from "./translate";

/**
 * UI language (TN-04). The signed-in user's `locale` (from the login and profile responses)
 * decides; before sign-in the last language picked on this browser does, so the login page
 * greets a Tamil-speaking operator in Tamil. Accounting screens simply do not call `t()`.
 */

const STORAGE_KEY = "shiftline-locale";
const TAMIL_FONT_ID = "sl-font-noto-sans-tamil";
const TAMIL_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@400;500;600;700&display=swap";

const readStoredLocale = (): Locale => {
  try {
    return toLocale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
};

const storeLocale = (locale: Locale) => {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private windows and blocked storage: the server copy still holds the choice.
  }
};

/** Loads Noto Sans Tamil from Google Fonts the first time Tamil is shown, never for English. */
const ensureTamilFont = () => {
  if (typeof document === "undefined" || document.getElementById(TAMIL_FONT_ID)) return;
  const link = document.createElement("link");
  link.id = TAMIL_FONT_ID;
  link.rel = "stylesheet";
  link.href = TAMIL_FONT_HREF;
  document.head.appendChild(link);
};

export type TFunction = (key: MessageKey, vars?: TranslateVars) => string;

interface I18nContextValue {
  locale: Locale;
  t: TFunction;
  /** Nav and other run-time keys; `fallback` is shown when the key has no entry. */
  tDynamic: (key: string, fallback: string, vars?: TranslateVars) => string;
  /** Changes the language: saved on the server for a signed-in user, on this browser always. */
  setLocale: (locale: Locale) => Promise<void>;
  saving: boolean;
}

const fallbackContext: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
  tDynamic: (key, fallback, vars) => translateDynamic(DEFAULT_LOCALE, key, fallback, vars),
  setLocale: async () => {},
  saving: false,
};

const I18nContext = createContext<I18nContextValue>(fallbackContext);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const isSuperAdmin = useAppSelector((s) => !!s.auth.user?.isSuperAdmin);
  const [guestLocale, setGuestLocale] = useState<Locale>(readStoredLocale);
  const [saving, setSaving] = useState(false);

  // Platform admins stay in English; everyone else follows their saved preference.
  const locale: Locale = user
    ? isSuperAdmin
      ? DEFAULT_LOCALE
      : toLocale(user.locale)
    : guestLocale;

  useEffect(() => {
    document.documentElement.lang = locale;
    if (locale === "ta") ensureTamilFont();
    if (user && !isSuperAdmin) storeLocale(locale);
  }, [locale, user, isSuperAdmin]);

  const setLocale = useCallback(
    async (next: Locale) => {
      storeLocale(next);
      setGuestLocale(next);
      if (!user || isSuperAdmin) return;
      const previous = toLocale(user.locale);
      dispatch(setUserLocale(next));
      setSaving(true);
      try {
        await profileService.updateMyLocale(next);
      } catch (err) {
        dispatch(setUserLocale(previous));
        storeLocale(previous);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [dispatch, user, isSuperAdmin]
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: (key, vars) => translate(locale, key, vars),
      tDynamic: (key, fallback, vars) => translateDynamic(locale, key, fallback, vars),
      setLocale,
      saving,
    }),
    [locale, setLocale, saving]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/** The translator for the current UI language: `const { t } = useT(); t("login.title")`. */
export const useT = () => useContext(I18nContext);
