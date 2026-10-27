"use client";

import type { Question } from "@/lib/types";
import { useT } from "../../i18n-provider";

export type StudentQuestion = Omit<Question, "correct_answer" | "explanation"> & { match_options?: string[] };

type Props = {
  question: StudentQuestion;
  answer: unknown;
  number: number;
  onAnswer: (answer: unknown) => void;
};

/** The answer controls for one question; the page owns saving and timing. */
export function AnswerInput({ question: q, answer, number, onAnswer }: Props) {
  const st = useT().student;
  if (q.type === "multiple_choice" || q.type === "true_false") {
    return <div className="stack" role="group" aria-label={st.answerTo(number)}>{q.options?.map((option, i) => <label className="option" key={i}><input type="radio" name={`q-${q.id}`} checked={answer === option} onChange={() => onAnswer(option)} />{option}</label>)}</div>;
  }
  if (q.type === "matching") {
    const given = answer && typeof answer === "object" ? answer as Record<string, string> : {};
    const set = (left: string, right: string) => onAnswer({ ...given, [left]: right });
    // Older links were created before choices were sent; keep free text there.
    if (!q.match_options?.length) {
      return <div className="stack">{q.pairs?.map((pair, i) => <label className="field" key={i}>{pair.left}<input value={String(given[pair.left] || "")} onChange={e => set(pair.left, e.target.value)} placeholder={st.matchingPlaceholder} /></label>)}</div>;
    }
    const used = new Set(Object.values(given).filter(Boolean));
    return <div className="stack match-grid" role="group" aria-label={st.answerTo(number)}>{q.pairs?.map((pair, i) => <label className="match-row" key={i}><span className="match-left">{pair.left}</span><select value={given[pair.left] || ""} onChange={e => set(pair.left, e.target.value)}><option value="">{st.matchingChoose}</option>{q.match_options!.map(option => <option key={option} value={option}>{used.has(option) && given[pair.left] !== option ? `${option} ✓` : option}</option>)}</select></label>)}</div>;
  }
  return <label className="field">{st.yourAnswer}<textarea value={String(answer || "")} onChange={e => onAnswer(e.target.value)} placeholder={st.answerPlaceholder} /></label>;
}
