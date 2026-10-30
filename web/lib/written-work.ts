import type { Question, TestVariant } from "./types";
import { DEFAULT_NORMS, type DictationMode } from "./dictation";

export const WRITTEN_KINDS = ["dictation", "words", "copy", "essay"] as const;
export type WrittenKind = typeof WRITTEN_KINDS[number];
type Language = "russian" | "kazakh" | "english";

// Written in the language of the work, which can differ from the site's language.
const TEXT: Record<Language, { kind: Record<WrittenKind, string>; task: Record<Exclude<WrittenKind, "essay">, string>; criteria: string[] }> = {
  russian: {
    kind: { dictation: "Диктант", words: "Словарный диктант", copy: "Списывание", essay: "Эссе" },
    task: {
      dictation: "Напишите текст под диктовку учителя.",
      words: "Запишите слова под диктовку, каждое с новой строки.",
      copy: "Перепишите текст без ошибок.",
    },
    criteria: ["Содержание и раскрытие темы", "Структура и логика", "Грамотность"],
  },
  kazakh: {
    kind: { dictation: "Диктант", words: "Сөздік диктант", copy: "Көшіріп жазу", essay: "Эссе" },
    task: {
      dictation: "Мұғалімнің айтуымен мәтінді жазыңыз.",
      words: "Сөздерді айтуымен жазыңыз, әрқайсысын жаңа жолдан.",
      copy: "Мәтінді қатесіз көшіріп жазыңыз.",
    },
    criteria: ["Мазмұны және тақырыптың ашылуы", "Құрылымы және логикасы", "Сауаттылық"],
  },
  english: {
    kind: { dictation: "Dictation", words: "Word dictation", copy: "Copying", essay: "Essay" },
    task: {
      dictation: "Write the text as your teacher dictates it.",
      words: "Write each word your teacher dictates on a new line.",
      copy: "Copy the text without mistakes.",
    },
    criteria: ["Content and task achievement", "Organisation and coherence", "Language accuracy"],
  },
};

const CRITERIA_POINTS = [4, 3, 3];

export const writtenKindLabel = (kind: WrittenKind, language: string) => TEXT[(language in TEXT ? language : "russian") as Language].kind[kind];

/**
 * A one-question variant for a written work. A dictation keeps the teacher's
 * text as its answer key; an essay keeps the teacher's notes there (never sent to students).
 */
export function writtenVariant(kind: WrittenKind, language: Language, title: string, text: string): TestVariant {
  const words = TEXT[language];
  const base = { id: `written-${kind}`, explanation: "", skill_tag: words.kind[kind] };
  const question: Question = kind === "essay"
    ? { ...base, type: "essay", question: text, correct_answer: "", criteria: words.criteria.map((name, i) => ({ name, points: CRITERIA_POINTS[i] })), min_words: 0 }
    : { ...base, type: "dictation", question: words.task[kind], correct_answer: text, dictation_mode: kind as DictationMode, grade_norms: structuredClone(DEFAULT_NORMS[kind as DictationMode]) };
  return { title, instructions: "", questions: [question] };
}
