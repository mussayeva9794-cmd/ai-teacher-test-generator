"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { checkDictation, readDictationRecord, schoolGrade, type Marks } from "@/lib/dictation";
import type { Question } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { serverMessage } from "@/lib/i18n/server-message";
import { DictationMarkup } from "../../dictation-markup";

const sameMarks = (a: Marks, b: Marks) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** A submitted dictation: the marked text, the grade, and the teacher's marks on each mistake. */
export function DictationCheck({ t, testId, attemptId, questionId, record: stored, answer, locked, onSaved }: {
  t: Dictionary; testId: string; attemptId: string; questionId: string; record: unknown; answer: unknown; locked: boolean; onSaved: () => Promise<void> | void;
}) {
  const w = t.written;
  const record = readDictationRecord(stored);
  const saved = record?.marks ?? {};
  const [marks, setMarks] = useState<Marks>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const check = useMemo(() => record && checkDictation(record.reference, answer, record.mode, record.norms, marks), [stored, answer, marks]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!record || !check) return null;
  const dirty = !sameMarks(marks, saved);
  async function save() {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/tests/${testId}/attempts/dictation`, { method: "PATCH", body: JSON.stringify({ attempt_id: attemptId, question_id: questionId, marks }) });
      await onSaved();
      setMessage(w.marksSaved);
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", w.marksFailed)); }
    finally { setBusy(false); }
  }
  return <div className="stack" style={{ gap: 10, marginTop: 8 }}>
    <p style={{ margin: 0 }}><b>{w.grade(check.grade)}</b> · {w.errorsSummary(check.spelling, check.punctuation)}</p>
    {check.empty ? <p className="muted small">{t.testPage.noAnswer}</p> : check.errors.length === 0 ? <><DictationMarkup ops={check.ops} errors={check.errors} /><p className="success small">{w.noErrors}</p></> : <>
      <DictationMarkup ops={check.ops} errors={check.errors} marks={marks} onMark={locked ? undefined : (item, next) => setMarks(current => {
        // An unmarked mistake counts in full (a repeat not at all); only differences from that are stored.
        const fallback = item.repeat ? "ignored" : "counted";
        const updated = { ...current };
        if (next === fallback) delete updated[String(item.id)]; else updated[String(item.id)] = next;
        return updated;
      })} />
      <p className="dict-legend small muted"><span><span className="dict-err dict-counted"><del>{w.legendWrong}</del><ins>{w.legendRight}</ins></span> {w.status.counted}</span><span><span className="dict-err dict-minor">{w.legendSample}</span> {w.status.minor}</span><span><span className="dict-err dict-ignored">{w.legendSample}</span> {w.status.ignored}</span></p>
      {locked ? <p className="notice small">{w.manualLocked}</p> : <p className="muted small" style={{ margin: 0 }}>{w.markHint}</p>}
      {!locked && dirty && <div className="row" style={{ justifyContent: "flex-start" }}><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? w.saving : w.saveMarks}</button><button type="button" className="btn ghost" disabled={busy} onClick={() => setMarks(saved)}>{w.resetMarks}</button></div>}
    </>}
    {message && <p className="success small" role="status">{message}</p>}
    {error && <p className="error small" role="alert">{error}</p>}
  </div>;
}

/**
 * Points for each essay criterion. Only a helper: the total the teacher saves
 * is still the work's final score, and it can be passed over in one press when
 * the essay is the whole work.
 */
export function EssayScorer({ t, question, answer, onUse }: { t: Dictionary; question: Question; answer: unknown; onUse?: (percentage: number) => void }) {
  const w = t.written;
  const criteria = question.criteria ?? [];
  const [points, setPoints] = useState<number[]>(() => criteria.map(() => 0));
  const max = criteria.reduce((sum, item) => sum + item.points, 0);
  const got = criteria.reduce((sum, item, i) => sum + Math.min(item.points, points[i] ?? 0), 0);
  const percentage = max ? Math.round(got / max * 10000) / 100 : 0;
  const text = typeof answer === "string" ? answer : "";
  return <div className="stack" style={{ gap: 10, marginTop: 8 }}>
    {text.trim() ? <p className="dict-text">{text}</p> : <p className="muted small">{t.testPage.noAnswer}</p>}
    {criteria.length > 0 && <fieldset className="field written-fieldset"><legend>{w.essayScore}</legend>
      {criteria.map((item, i) => <label className="criterion-score small" key={i}><span>{item.name}</span><input type="number" min={0} max={item.points} value={points[i] ?? 0} aria-label={`${item.name}: ${w.points(item.points)}`}
        onChange={e => { const value = Math.max(0, Math.min(item.points, Math.floor(Number(e.target.value) || 0))); setPoints(current => current.map((old, at) => at === i ? value : old)); }} /><span className="muted">/ {item.points}</span></label>)}
      <p style={{ margin: 0 }}><b>{w.essayTotal(got, max, percentage, schoolGrade(percentage))}</b></p>
      {onUse && <button type="button" className="btn" style={{ justifySelf: "start" }} onClick={() => onUse(percentage)}>{w.useEssayTotal}</button>}
    </fieldset>}
  </div>;
}
