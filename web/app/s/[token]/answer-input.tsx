"use client";

import type { Question } from "@/lib/types";
import { MAX_WRITTEN_ANSWER_LENGTH } from "@/lib/dictation";
import { isWrittenType } from "@/lib/question-validation";
import { useT } from "../../i18n-provider";

export type StudentQuestion = Omit<Question, "correct_answer" | "explanation"> & { match_options?: string[]; copy_text?: string };

const wordCount = (text: string) => text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length ?? 0;

type Props = {
  question: StudentQuestion;
  answer: unknown;
  number: number;
  onAnswer: (answer: unknown) => void;
};

/** The answer controls for one question; the page owns saving and timing. */
export function AnswerInput({ question: q, answer, number, onAnswer }: Props) {
  const t = useT();
  const st = t.student;
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
  if (isWrittenType(q.type)) {
    const text = String(answer || "");
    const w = t.written;
    // The keyboard must not fix spelling for the student, and nothing can be pasted in.
    return <div className="stack">
      {q.copy_text && <div className="panel soft"><div className="eyebrow">{w.copyText}</div><p className="copy-text">{q.copy_text}</p></div>}
      <p className="notice small" style={{ margin: 0 }}>{w.keyboardHint}</p>
      <label className="field">{w.typeHere}<textarea className="written-answer" value={text} maxLength={MAX_WRITTEN_ANSWER_LENGTH} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
        onChange={e => onAnswer(e.target.value)} onPaste={e => e.preventDefault()} onDrop={e => e.preventDefault()} /></label>
      {q.type === "essay" && <p className="muted small" style={{ margin: 0 }} aria-live="polite">{w.wordCount(wordCount(text))}{q.min_words ? ` · ${w.minWords(q.min_words)}` : ""}</p>}
      {q.type === "essay" && q.criteria?.length ? <details className="small"><summary>{w.criteriaTitle}</summary><ul>{q.criteria.map((item, i) => <li key={i}>{item.name} — {w.points(item.points)}</li>)}</ul></details> : null}
    </div>;
  }
  return <label className="field">{st.yourAnswer}<textarea value={String(answer || "")} onChange={e => onAnswer(e.target.value)} placeholder={st.answerPlaceholder} /></label>;
}
