import React from "react";
import { Languages } from "lucide-react";
import { toast } from "react-toastify";
import { SUPPORTED_LOCALES, type Locale } from "@shiftline/shared";

import { useT } from "../../i18n/I18nProvider";
import { translate } from "../../i18n/translate";

/** Each language is named in itself, so a Tamil speaker finds "தமிழ்" in an English UI. */
const NATIVE_NAME: Record<Locale, string> = { en: "English", ta: "தமிழ்" };

interface LanguageSwitchProps {
  /** Show the "Language" caption with an icon above the buttons. */
  showLabel?: boolean;
  /** Tell the person it worked (off on the login page, where the change is obvious). */
  announce?: boolean;
  className?: string;
}

/** English / தமிழ் segmented switch (TN-04). Saves to the user's profile when signed in. */
const LanguageSwitch: React.FC<LanguageSwitchProps> = ({
  showLabel = true,
  announce = true,
  className = "",
}) => {
  const { locale, setLocale, saving, t } = useT();

  const pick = async (next: Locale) => {
    if (next === locale || saving) return;
    try {
      await setLocale(next);
      if (announce) toast.success(translate(next, "language.saved"));
    } catch {
      toast.error(t("language.failed"));
    }
  };

  return (
    <div className={className}>
      {showLabel && (
        <span className="mb-1.5 flex items-center gap-2 px-1 text-xs font-semibold text-ink-subtle">
          <Languages size={15} aria-hidden />
          {t("language.label")}
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={t("language.label")}
        className="grid grid-cols-2 gap-1 rounded-full border border-line-soft bg-card-2 p-1"
      >
        {SUPPORTED_LOCALES.map((code) => {
          const selected = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={selected}
              lang={code}
              disabled={saving}
              onClick={() => void pick(code)}
              data-testid={`language-${code}`}
              className={`min-h-[36px] rounded-full px-3 text-sm font-semibold transition-colors disabled:opacity-60 ${
                selected
                  ? "bg-card text-ink shadow-[var(--shadow-sm)]"
                  : "text-ink-subtle hover:text-ink"
              }`}
            >
              {NATIVE_NAME[code]}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LanguageSwitch;
