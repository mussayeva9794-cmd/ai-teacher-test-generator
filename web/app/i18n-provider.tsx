"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { INTL_LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from "@/lib/i18n/config";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";
import { formatDate, type DateStyle } from "@/lib/i18n/format";

type I18n = {
  locale: Locale; t: Dictionary; intl: string; setLocale: (locale: Locale) => void;
  date: (value: string | number | Date, style?: DateStyle) => string;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const router = useRouter();
  const [locale, setState] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    document.documentElement.lang = next;
    setState(next);
    // Server-rendered pages and the document title follow the cookie on refresh.
    router.refresh();
  }, [router]);
  const value = useMemo(() => ({
    locale, t: dictionaries[locale], intl: INTL_LOCALES[locale], setLocale,
    date: (input: string | number | Date, style?: DateStyle) => formatDate(locale, input, style),
  }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}

/** The active dictionary. */
export function useT(): Dictionary {
  return useI18n().t;
}
