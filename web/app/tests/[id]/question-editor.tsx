"use client";

import type { Question, QuestionType } from "@/lib/types";
import { questionProblem } from "@/lib/question-validation";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { TRUE_FALSE_OPTIONS } from "@/lib/true-false";

type Props = {
  t: Dictionary;
  question: Question;
  index: number;
  canDelete: boolean;
  regenerating: boolean;
  disabled: boolean;
  edit: (mutator: (question: Question) => void) => void;
  onDelete: () => void;
  onRegenerate: () => void;
};

/** A blank question of the chosen type for the "add question" action. */
export function blankQuestion(type: QuestionType, language: string, id: string): Question {
  const base = { id, type, question: "", explanation: "", skill_tag: "", correct_answer: "" };
  if (type === "multiple_choice") return { ...base, options: ["", "", "", ""] };
  if (type === "true_false") {
    const options = TRUE_FALSE_OPTIONS[language as keyof typeof TRUE_FALSE_OPTIONS] || TRUE_FALSE_OPTIONS.russian;
    return { ...base, options: [...options], correct_answer: options[0] };
  }
  if (type === "matching") return { ...base, pairs: [{ left: "", right: "" }, { left: "", right: "" }] };
  return base;
}

export function QuestionEditor({ t, question, index, canDelete, regenerating, disabled, edit, onDelete, onRegenerate }: Props) {
  const p = t.testPage;
  const problem = questionProblem(question);
  return <div className={problem ? "panel stack question-editor has-problem" : "panel stack question-editor"}>
    <div className="row"><span className="eyebrow">{p.question(index + 1)}</span><div className="row editor-actions"><span className="pill">{question.skill_tag || t.create[TYPE_LABEL[question.type]]}</span><button type="button" className="btn ghost" disabled={disabled || regenerating} onClick={onRegenerate}>{regenerating ? p.regenerating : p.regenerate}</button><button type="button" className="btn ghost danger" disabled={disabled || !canDelete} onClick={onDelete}>{p.deleteQuestion}</button></div></div>
    {problem && <p className="error small" role="status">{p.problems[problem]}</p>}
    <label className="field">{p.wording}<textarea value={question.question} onChange={e => edit(q => { q.question = e.target.value; })} /></label>
    {question.source_reference && <p className="small muted">{p.source(question.source_reference)}</p>}
    {question.options?.map((option, optionIndex) => <div className="option-edit" key={optionIndex}><label className="field">{p.option(optionIndex + 1)}<input value={option} disabled={question.type === "true_false"} onChange={e => edit(q => { const old = q.options![optionIndex]; q.options![optionIndex] = e.target.value; if (q.correct_answer === old) q.correct_answer = e.target.value; })} /></label>{question.type === "multiple_choice" && question.options!.length > 2 && <button type="button" className="btn ghost" aria-label={p.removeOption(optionIndex + 1)} onClick={() => edit(q => { const [removed] = q.options!.splice(optionIndex, 1); if (q.correct_answer === removed) q.correct_answer = ""; })}>×</button>}</div>)}
    {question.type === "multiple_choice" && (question.options?.length || 0) < 6 && <button type="button" className="btn add-row" onClick={() => edit(q => { q.options = [...(q.options || []), ""]; })}>{p.addOption}</button>}
    {question.type === "matching" && <>{question.pairs?.map((pair, pairIndex) => <div className="pair-edit" key={pairIndex}><label className="field">{p.left}<input value={pair.left} onChange={e => edit(q => { q.pairs![pairIndex].left = e.target.value; })} /></label><label className="field">{p.right}<input value={pair.right} onChange={e => edit(q => { q.pairs![pairIndex].right = e.target.value; })} /></label>{question.pairs!.length > 2 && <button type="button" className="btn ghost" aria-label={p.removePair(pairIndex + 1)} onClick={() => edit(q => { q.pairs!.splice(pairIndex, 1); })}>×</button>}</div>)}{(question.pairs?.length || 0) < 8 && <button type="button" className="btn add-row" onClick={() => edit(q => { q.pairs = [...(q.pairs || []), { left: "", right: "" }]; })}>{p.addPair}</button>}</>}
    {question.type !== "matching" && <label className="field">{p.correct}{question.options ? <select value={question.correct_answer} onChange={e => edit(q => { q.correct_answer = e.target.value; })}><option value="" disabled>{p.chooseCorrect}</option>{question.options.map((option, i) => <option value={option} key={i}>{option || p.option(i + 1)}</option>)}</select> : <input value={question.correct_answer} onChange={e => edit(q => { q.correct_answer = e.target.value; })} />}</label>}
    <label className="field">{p.explanation}<textarea value={question.explanation || ""} onChange={e => edit(q => { q.explanation = e.target.value; })} /></label>
  </div>;
}

const TYPE_LABEL = {
  multiple_choice: "typeMultipleChoice",
  true_false: "typeTrueFalse",
  short_answer: "typeShortAnswer",
  matching: "typeMatching",
} as const satisfies Record<QuestionType, keyof Dictionary["create"]>;
