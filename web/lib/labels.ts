// Display labels for values stored in English in the database. Stored values
// ("Variant A", "russian") stay unchanged; only what people read is localized.
import { ru } from "./i18n/dictionaries/ru";
import type { Dictionary } from "./i18n/dictionaries";

const LANGUAGES: Record<string, string> = { russian: "Русский", kazakh: "Қазақша", english: "English" };

export function languageLabel(code: string | null | undefined): string {
  return LANGUAGES[String(code || "").toLowerCase()] || String(code || "");
}

/** "Variant A" as stored → "Вариант A" / "A нұсқасы" / "Variant A". Russian by default. */
export function variantLabel(name: string | null | undefined, t: Dictionary = ru): string {
  const text = String(name || "");
  const match = /^Variant\s+(\S+)$/.exec(text);
  return match ? t.labels.variant(match[1]) : text;
}

function comparable(value: string | null | undefined): string {
  return String(value || "").toLocaleLowerCase("ru").replace(/[«»"'.,:;!?()-]/g, " ").replace(/\s+/g, " ").trim();
}

/** The topic is worth showing only when it adds something the title does not already say. */
export function distinctTopic(topic: string | null | undefined, title: string | null | undefined): string {
  const t = comparable(topic);
  if (!t) return "";
  const name = comparable(title);
  return name === t || name.includes(t) ? "" : String(topic).trim();
}

/** "Тема · 11 класс · Русский", skipping empty or repeated parts. */
export function testMeta(test: { topic?: string | null; title?: string | null; grade_level?: string | null; language?: string | null }): string {
  return [distinctTopic(test.topic, test.title), String(test.grade_level || "").trim(), languageLabel(test.language)]
    .filter(Boolean).join(" · ");
}
