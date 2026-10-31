"use client";

import type { BloomLevel, Question, QuestionType } from "@/lib/types";
import { BLOOM_LEVELS, isWrittenType, questionProblem } from "@/lib/question-validation";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { TRUE_FALSE_OPTIONS } from "@/lib/true-false";
import { DEFAULT_NORMS, DICTATION_MODES, MAX_REFERENCE_LENGTH, type DictationMode, type GradeNorms } from "@/lib/dictation";
import { writtenVariant } from "@/lib/written-work";

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
  if (isWrittenType(type)) {
    const lang = language === "kazakh" || language === "english" ? language : "russian";
    return { ...writtenVariant(type, lang, "", "").questions[0], id };
  }
  const base = { id, type, question: "", explanation: "", skill_tag: "", correct_answer: "" };
  if (type === "multiple_choice") return { ...base, options: ["", "", "", ""] };
  if (type === "multiple_select") return { ...base, options: ["", "", "", ""], correct_answers: [] };
  if (type === "ordering") return { ...base, items: ["", "", ""] };
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
  const editableOptions = question.type === "multiple_choice" || question.type === "multiple_select";
  const minOptions = question.type === "multiple_select" ? 3 : 2;
  const written = isWrittenType(question.type);
  return <div className={problem ? "panel stack question-editor has-problem" : "panel stack question-editor"}>
    <div className="row"><span className="eyebrow">{p.question(index + 1)}</span><div className="row editor-actions"><span className="pill">{question.skill_tag || t.create[TYPE_LABEL[question.type]]}</span>{!written && <button type="button" className="btn ghost" disabled={disabled || regenerating} onClick={onRegenerate}>{regenerating ? p.regenerating : p.regenerate}</button>}<button type="button" className="btn ghost danger" disabled={disabled || !canDelete} onClick={onDelete}>{p.deleteQuestion}</button></div></div>
    {problem && <p className="error small" role="status">{p.problems[problem]}</p>}
    {/* Locked while AI writes its replacement, so no edit is overwritten by it. */}
    <fieldset className="editor-fields" disabled={regenerating}>
    <label className="field">{p.wording}<textarea value={question.question} onChange={e => edit(q => { q.question = e.target.value; })} /></label>
    {question.source_reference && <p className="small muted">{p.source(question.source_reference)}</p>}
    {question.options?.map((option, optionIndex) => <div className="option-edit" key={optionIndex}><label className="field">{p.option(optionIndex + 1)}<input value={option} disabled={question.type === "true_false"} onChange={e => edit(q => { const old = q.options![optionIndex]; q.options![optionIndex] = e.target.value; if (old && q.correct_answer === old) q.correct_answer = e.target.value; if (old && q.correct_answers) q.correct_answers = q.correct_answers.map(answer => answer === old ? e.target.value : answer); })} /></label>{editableOptions && question.options!.length > minOptions && <button type="button" className="btn ghost" aria-label={p.removeOption(optionIndex + 1)} onClick={() => edit(q => { const [removed] = q.options!.splice(optionIndex, 1); if (q.correct_answer === removed) q.correct_answer = ""; if (q.correct_answers) q.correct_answers = q.correct_answers.filter(answer => answer !== removed); })}>×</button>}</div>)}
    {editableOptions && (question.options?.length || 0) < 6 && <button type="button" className="btn add-row" onClick={() => edit(q => { q.options = [...(q.options || []), ""]; })}>{p.addOption}</button>}
    {question.type === "matching" && <>{question.pairs?.map((pair, pairIndex) => <div className="pair-edit" key={pairIndex}><label className="field">{p.left}<input value={pair.left} onChange={e => edit(q => { q.pairs![pairIndex].left = e.target.value; })} /></label><label className="field">{p.right}<input value={pair.right} onChange={e => edit(q => { q.pairs![pairIndex].right = e.target.value; })} /></label>{question.pairs!.length > 2 && <button type="button" className="btn ghost" aria-label={p.removePair(pairIndex + 1)} onClick={() => edit(q => { q.pairs!.splice(pairIndex, 1); })}>×</button>}</div>)}{(question.pairs?.length || 0) < 8 && <button type="button" className="btn add-row" onClick={() => edit(q => { q.pairs = [...(q.pairs || []), { left: "", right: "" }]; })}>{p.addPair}</button>}</>}
    {question.type === "ordering" && <><p className="muted small">{p.orderNote}</p>{question.items?.map((item, itemIndex) => <div className="item-edit" key={itemIndex}><label className="field">{p.item(itemIndex + 1)}<input value={item} onChange={e => edit(q => { q.items![itemIndex] = e.target.value; })} /></label><button type="button" className="btn ghost" aria-label={p.moveUp(itemIndex + 1)} disabled={itemIndex === 0} onClick={() => edit(q => { const items = q.items!; [items[itemIndex - 1], items[itemIndex]] = [items[itemIndex], items[itemIndex - 1]]; })}>↑</button><button type="button" className="btn ghost" aria-label={p.moveDown(itemIndex + 1)} disabled={itemIndex === question.items!.length - 1} onClick={() => edit(q => { const items = q.items!; [items[itemIndex + 1], items[itemIndex]] = [items[itemIndex], items[itemIndex + 1]]; })}>↓</button><button type="button" className="btn ghost" aria-label={p.removeItem(itemIndex + 1)} disabled={question.items!.length <= 3} onClick={() => edit(q => { q.items!.splice(itemIndex, 1); })}>×</button></div>)}{(question.items?.length || 0) < 10 && <button type="button" className="btn add-row" onClick={() => edit(q => { q.items = [...(q.items || []), ""]; })}>{p.addItem}</button>}</>}
    {question.type === "multiple_select" && <fieldset className="field correct-many"><legend>{p.correctMany}</legend>{question.options?.map((option, i) => <label className="option" key={i}><input type="checkbox" checked={Boolean(option) && (question.correct_answers || []).includes(option)} disabled={!option.trim()} onChange={e => edit(q => { const set = new Set(q.correct_answers || []); if (e.target.checked) set.add(option); else set.delete(option); q.correct_answers = q.options!.filter(item => set.has(item)); })} />{option || p.option(i + 1)}</label>)}</fieldset>}
    {SINGLE_ANSWER.has(question.type) && <label className="field">{p.correct}{question.options ? <select value={question.correct_answer} onChange={e => edit(q => { q.correct_answer = e.target.value; })}><option value="" disabled>{p.chooseCorrect}</option>{question.options.map((option, i) => <option value={option} key={i}>{option || p.option(i + 1)}</option>)}</select> : <input value={question.correct_answer} onChange={e => edit(q => { q.correct_answer = e.target.value; })} />}</label>}
    {question.type === "dictation" && <DictationFields t={t} question={question} edit={edit} />}
    {question.type === "essay" && <EssayFields t={t} question={question} edit={edit} />}
    {!written && <><label className="field">{p.bloomLevel}<select value={question.bloom_level || ""} onChange={e => edit(q => { if (e.target.value) q.bloom_level = e.target.value as BloomLevel; else delete q.bloom_level; })}><option value="">{p.bloomNone}</option>{BLOOM_LEVELS.map(level => <option key={level} value={level}>{t.labels.bloom[level]}</option>)}</select></label>
    <label className="field">{p.explanation}<textarea value={question.explanation || ""} onChange={e => edit(q => { q.explanation = e.target.value; })} /></label></>}
    </fieldset>
  </div>;
}

const SINGLE_ANSWER = new Set<QuestionType>(["multiple_choice", "true_false", "short_answer"]);

const TYPE_LABEL = {
  multiple_choice: "typeMultipleChoice",
  true_false: "typeTrueFalse",
  short_answer: "typeShortAnswer",
  matching: "typeMatching",
  multiple_select: "typeMultipleSelect",
  ordering: "typeOrdering",
  dictation: "typeDictation",
  essay: "typeEssay",
} as const satisfies Record<QuestionType, keyof Dictionary["create"]>;

type FieldProps = { t: Dictionary; question: Question; edit: Props["edit"] };

const GRADES = [["five", 5], ["four", 4], ["three", 3]] as const;
const LIMITS = ["spelling", "punctuation", "total"] as const;

function DictationFields({ t, question, edit }: FieldProps) {
  const w = t.written;
  const mode = question.dictation_mode ?? "dictation";
  const norms: GradeNorms = question.grade_norms ?? DEFAULT_NORMS[mode];
  const setLimit = (grade: keyof GradeNorms, limit: typeof LIMITS[number], value: string) => edit(q => {
    const next = structuredClone(q.grade_norms ?? DEFAULT_NORMS[mode]);
    next[grade][limit] = Math.max(0, Math.min(50, Math.floor(Number(value) || 0)));
    q.grade_norms = next;
  });
  return <>
    <label className="field">{w.kind}<select value={mode} onChange={e => edit(q => { const next = e.target.value as DictationMode; q.dictation_mode = next; q.grade_norms = structuredClone(DEFAULT_NORMS[next]); })}>{DICTATION_MODES.map(item => <option key={item} value={item}>{w.kinds[item]}</option>)}</select></label>
    <label className="field">{w.text[mode]}<textarea className="written-answer" value={question.correct_answer} maxLength={MAX_REFERENCE_LENGTH} onChange={e => edit(q => { q.correct_answer = e.target.value; })} /></label>
    <fieldset className="field written-fieldset"><legend>{w.normsTitle}</legend>
      <div className="dict-norms"><span />{LIMITS.map(limit => <span key={limit} className="small muted">{w.limits[limit]}</span>)}
        {GRADES.map(([grade, value]) => <div key={grade} style={{ display: "contents" }}><span className="small">{w.gradeLimit(value)}</span>{LIMITS.map(limit => <input key={limit} type="number" min={0} max={50} aria-label={`${w.gradeLimit(value)}: ${w.limits[limit]}`} value={norms[grade][limit]} onChange={e => setLimit(grade, limit, e.target.value)} />)}</div>)}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{w.normsHint}</p>
    </fieldset>
  </>;
}

function EssayFields({ t, question, edit }: FieldProps) {
  const w = t.written;
  const criteria = question.criteria ?? [];
  return <>
    <label className="field">{w.teacherNotes}<textarea value={question.correct_answer} maxLength={MAX_REFERENCE_LENGTH} onChange={e => edit(q => { q.correct_answer = e.target.value; })} /></label>
    <label className="field">{w.minWordsLabel}<input type="number" min={0} max={3000} value={question.min_words ?? 0} onChange={e => edit(q => { q.min_words = Math.max(0, Math.min(3000, Math.floor(Number(e.target.value) || 0))); })} /></label>
    <fieldset className="field written-fieldset"><legend>{w.criteriaTitle}</legend>
      {criteria.map((item, i) => <div className="criterion-edit" key={i}>
        <label className="field">{w.criterion(i + 1)}<input value={item.name} maxLength={200} onChange={e => edit(q => { q.criteria![i].name = e.target.value; })} /></label>
        <label className="field">{w.maxPoints}<input type="number" min={1} max={20} value={item.points} onChange={e => edit(q => { q.criteria![i].points = Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 1))); })} /></label>
        <button type="button" className="btn ghost" aria-label={w.removeCriterion(i + 1)} disabled={criteria.length <= 1} onClick={() => edit(q => { q.criteria!.splice(i, 1); })}>×</button>
      </div>)}
      {criteria.length < 10 && <button type="button" className="btn add-row" onClick={() => edit(q => { q.criteria = [...(q.criteria ?? []), { name: "", points: 1 }]; })}>{w.addCriterion}</button>}
    </fieldset>
  </>;
}
