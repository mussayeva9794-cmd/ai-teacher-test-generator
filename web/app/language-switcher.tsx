"use client";

import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";
import { useI18n } from "./i18n-provider";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return <label className="lang-switch">
    <span className="sr-only">{t.common.language}</span>
    <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t.common.language}>
      {LOCALES.map((code) => <option key={code} value={code} lang={code}>{LOCALE_LABELS[code].short}</option>)}
    </select>
  </label>;
}
