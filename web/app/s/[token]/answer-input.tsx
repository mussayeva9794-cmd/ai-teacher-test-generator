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
  if (q.type === "multiple_select") {
    const chosen = Array.isArray(answer) ? answer as string[] : [];
    const toggle = (option: string, on: boolean) => onAnswer(q.options!.filter(item => item === option ? on : chosen.includes(item)));
    return <div className="stack" role="group" aria-label={st.answerTo(number)}><p className="muted small" style={{ margin: 0 }}>{st.selectAllHint}</p>{q.options?.map((option, i) => <label className="option" key={i}><input type="checkbox" checked={chosen.includes(option)} onChange={e => toggle(option, e.target.checked)} />{option}</label>)}</div>;
  }
  if (q.type === "ordering") {
    // Until the student moves something the shown order is the starting order.
    const order = Array.isArray(answer) && answer.length === q.items?.length ? answer as string[] : q.items || [];
    const move = (from: number, to: number) => { const next = [...order]; [next[from], next[to]] = [next[to], next[from]]; onAnswer(next); };
    return <div className="stack" role="group" aria-label={st.answerTo(number)}><p className="muted small" style={{ margin: 0 }}>{st.orderHint}</p><ol className="order-list">{order.map((item, i) => <li key={item}><span>{item}</span><button type="button" className="btn ghost" aria-label={st.moveUp(item)} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button><button type="button" className="btn ghost" aria-label={st.moveDown(item)} disabled={i === order.length - 1} onClick={() => move(i, i + 1)}>↓</button></li>)}</ol></div>;
  }
  if (q.type === "matching") {
    const given = answer && typeof answer === "object" ? answer as Record<string, string> : {};
    const set = (left: string, right: string) => onAnswer({ ...given, [left]: right });
    const used = new Set(Object.values(given).filter(Boolean));
    return <div className="stack match-grid" role="group" aria-label={st.answerTo(number)}>{q.pairs?.map((pair, i) => <label className="match-row" key={i}><span className="match-left">{pair.left}</span><select value={given[pair.left] || ""} onChange={e => set(pair.left, e.target.value)}><option value="">{st.matchingChoose}</option>{(q.match_options || []).map(option => <option key={option} value={option}>{used.has(option) && given[pair.left] !== option ? `${option} ✓` : option}</option>)}</select></label>)}</div>;
  }
  return <label className="field">{st.yourAnswer}<textarea value={String(answer || "")} onChange={e => onAnswer(e.target.value)} placeholder={st.answerPlaceholder} /></label>;
}
