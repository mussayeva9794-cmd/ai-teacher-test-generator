// Interface languages. Generated test content keeps the language the teacher chose.
export const LOCALES = ["kk", "ru", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_COOKIE = "mugalim_lang";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Short labels for the switcher, written in each language itself. */
export const LOCALE_LABELS: Record<Locale, { short: string; name: string }> = {
  kk: { short: "ҚАЗ", name: "Қазақша" },
  ru: { short: "РУС", name: "Русский" },
  en: { short: "ENG", name: "English" },
};

/** BCP 47 tags for dates and numbers. */
export const INTL_LOCALES: Record<Locale, string> = { kk: "kk-KZ", ru: "ru-RU", en: "en-GB" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * A saved choice wins. Without one, Kazakh is picked when the browser prefers
 * it over Russian; otherwise Russian. English is never auto-selected: many
 * phones in Kazakhstan run an English system language for Russian speakers.
 */
export function negotiateLocale(saved: string | null | undefined, acceptLanguage: string | null | undefined): Locale {
  if (isLocale(saved)) return saved;
  const preferred = String(acceptLanguage || "").split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { base: tag.split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.base && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { base } of preferred) {
    if (base === "kk") return "kk";
    if (base === "ru") return "ru";
  }
  return DEFAULT_LOCALE;
}
