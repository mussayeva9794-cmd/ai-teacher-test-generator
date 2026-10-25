import { INTL_LOCALES, type Locale } from "./config";

// Browsers ship incomplete Kazakh date data ("М10 24", ISO-like strings), so
// Kazakh dates are assembled here; Russian and English use Intl.
const KK_MONTHS = ["қаңтар", "ақпан", "наурыз", "сәуір", "мамыр", "маусым", "шілде", "тамыз", "қыркүйек", "қазан", "қараша", "желтоқсан"];

/**
 * date      20.10.2026
 * dateTime  20.10.2026, 14:30
 * dayTime   20 қазан, 14:30 / 20 окт., 14:30 / 20 Oct, 14:30
 * dayTimeLong 20 қазан, 14:30 / 20 октября, 14:30 / 20 October, 14:30
 */
export type DateStyle = "date" | "dateTime" | "dayTime" | "dayTimeLong";

const INTL_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  date: { day: "2-digit", month: "2-digit", year: "numeric" },
  dateTime: { dateStyle: "short", timeStyle: "short" },
  dayTime: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  dayTimeLong: { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" },
};

export function formatDate(locale: Locale, value: string | number | Date, style: DateStyle = "date"): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  if (locale !== "kk") return date.toLocaleString(INTL_LOCALES[locale], INTL_OPTIONS[style]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const numeric = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (style === "date") return numeric;
  if (style === "dateTime") return `${numeric}, ${time}`;
  return `${date.getDate()} ${KK_MONTHS[date.getMonth()]}, ${time}`;
}
