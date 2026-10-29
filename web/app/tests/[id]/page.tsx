"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import type { ClassRow, QuestionType, TestRow, TestVariant, ShareSettings } from "@/lib/types";
import { isValidVariant } from "@/lib/question-validation";
import { blankQuestion, QuestionEditor } from "./question-editor";
import { BoardQr } from "./board-qr";
import { ClassAnalytics } from "./class-analytics";
import { RubricEditor } from "./rubric-editor";
import { answerText } from "@/lib/answer-format";
import { csvCell } from "@/lib/csv-export";
import { hasExplicitShareScope, normalizeEmailAllowlist } from "@/lib/share-access";
import { testMeta, variantLabel } from "@/lib/labels";
import { TeacherHeader } from "../../teacher-nav";
import { useI18n } from "../../i18n-provider";
import { serverMessage } from "@/lib/i18n/server-message";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type LinkRow = { id: string; token: string; url: string; variant_name: string; class_id: string | null; is_active: boolean; settings: ShareSettings; created_at: string };
type Attempt = { id: string; student_name: string; student_email?: string | null; csv_student_name?: string; csv_student_email?: string; variant_name: string; percentage: number | null; answers: Record<string, unknown>; result: { requires_manual_review?: boolean; manually_reviewed_by?: string; per_question_scoring?: string; per_question: { id: string; skill_tag: string; score: number | null; requires_manual_review?: boolean }[] }; submitted_at: string; integrity?: Integrity | null };
type Integrity = { leaves: number; pastes: number; copies: number; auto_submitted: boolean; away_seconds: number; question_seconds: Record<string, number> };
type AttemptSummary = { count: number; graded_count: number; pending_review: number; average: number };
type Suggestion = { attempt_id: string; percentage: number; questions: { id: string; score: number; comment: string }[] };
type AttemptsResponse = { attempts: Attempt[]; summary: AttemptSummary; page: number; page_size: number; total_pages: number; has_more: boolean };

function questionScoreLabel(t: Dictionary, attempt: Attempt, question: Attempt["result"]["per_question"][number]) {
  if (attempt.result?.per_question_scoring === "unscored" || attempt.result?.manually_reviewed_by || question.score === null) return t.testPage.scoreNotPerQuestion;
  if (question.requires_manual_review) return t.testPage.scoreNeedsReview;
  return `${Math.round(question.score * 100)}%`;
}

function integrityLabel(t: Dictionary, integrity: Integrity | null | undefined) {
  if (!integrity) return "—";
  const p = t.testPage;
  const parts = [
    integrity.auto_submitted ? p.integrityAuto : "",
    integrity.leaves ? p.integrityLeaves(integrity.leaves, integrity.away_seconds) : "",
    integrity.pastes ? p.integrityPastes(integrity.pastes) : "",
    integrity.copies ? p.integrityCopies(integrity.copies) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : p.integrityNone;
}

function SourcesPanel({ variant, t }: { variant: TestVariant; t: Dictionary }) {
  if (!variant.sources?.length) return null;
  return <section className="panel stack"><div><div className="eyebrow">{t.testPage.sourcesEyebrow}</div><h3 style={{ margin: "6px 0" }}>{t.testPage.sourcesTitle}</h3></div>{variant.sources.map((source, index) => <div className="list-item" key={`${source.label}-${index}`}><b>{source.label}</b>{source.pages && <div className="muted small">{source.pages}</div>}{source.url && <a className="small" href={source.url} target="_blank" rel="noreferrer">{t.testPage.sourcesOpen}</a>}</div>)}<p className="small muted">{t.testPage.sourcesNote}</p></section>;
}

export default function TestPage() {
  const { id } = useParams<{ id: string }>();
  const { t, intl, date } = useI18n();
  const p = t.testPage;
  const err = (cause: unknown, fallback: string) => serverMessage(t, cause instanceof Error ? cause.message : "", fallback);
  const [test, setTest] = useState<TestRow | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [summary, setSummary] = useState<AttemptSummary>({ count: 0, graded_count: 0, pending_review: 0, average: 0 });
  const [resultsPage, setResultsPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [reviewScores, setReviewScores] = useState<Record<string, string>>({});
  const [tab, setTab] = useState("review");
  const [variantName, setVariantName] = useState("Variant A");
  const [settings, setSettings] = useState<ShareSettings>({ allowed_students: [], deadline_at: null, timer_minutes: 0, one_question_at_a_time: true, randomize: true, reveal_score: false, reveal_answers: false, strict_mode: false, leave_limit: 2, question_seconds: 90, require_fullscreen: true });
  const [allowedText, setAllowedText] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [classLoadError, setClassLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState("");
  const [qrLink, setQrLink] = useState<LinkRow | null>(null);
  // Every attempt, loaded on request for the class analytics.
  const [allAttempts, setAllAttempts] = useState<Attempt[] | null>(null);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [newType, setNewType] = useState<QuestionType>("multiple_choice");
  const [error, setError] = useState("");
  const [resultsError, setResultsError] = useState("");
  const [message, setMessage] = useState("");
  // What the server last confirmed; edits that differ from it are unsaved.
  const savedSnapshot = useRef("");
  const dirtyRef = useRef(false);
  const snapshot = (row: TestRow) => JSON.stringify({ title: row.title, variants: row.variants });
  const dirty = Boolean(test) && snapshot(test!) !== savedSnapshot.current;
  dirtyRef.current = dirty;
  const canLeave = () => !dirtyRef.current || window.confirm(p.confirmLeave);

  async function refresh() {
    try {
      const [testResult, linkResult] = await Promise.all([
        api<{ test: TestRow }>(`/api/tests/${id}`),
        api<{ links: LinkRow[] }>(`/api/tests/${id}/share`),
      ]);
      if (!dirtyRef.current) { setTest(testResult.test); savedSnapshot.current = snapshot(testResult.test); }
      setLinks(linkResult.links);
      try {
        const attemptResult = await api<AttemptsResponse>(`/api/tests/${id}/attempts?page=${resultsPage}`);
        setAttempts(attemptResult.attempts); setSummary(attemptResult.summary); setTotalPages(attemptResult.total_pages);
        setResultsError("");
      } catch (cause) {
        setResultsError(err(cause, p.resultsFailed));
      }
      try {
        const classResult = await api<{ classes: ClassRow[] }>("/api/classes");
        setClasses(classResult.classes);
        setClassLoadError("");
      } catch {
        setClasses([]);
        setClassLoadError(p.classesUnavailable);
      }
    } catch (cause) { setError(err(cause, p.loadFailed)); }
  }
  useEffect(() => { void refresh(); }, [id, resultsPage]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (tab !== "results") return;
    const timer = setInterval(() => {
      api<AttemptsResponse>(`/api/tests/${id}/attempts?page=${resultsPage}`)
        .then(result => { setAttempts(result.attempts); setSummary(result.summary); setTotalPages(result.total_pages); setResultsError(""); })
        .catch(cause => setResultsError(err(cause, p.resultsRefreshFailed)));
    }, 10000);
    return () => clearInterval(timer);
  }, [tab, id, resultsPage]);

  function editVariant(mutator: (variant: TestVariant) => void) {
    setTest(current => {
      if (!current) return current;
      const variants = structuredClone(current.variants);
      mutator(variants[variantName]);
      return { ...current, variants };
    });
  }
  async function regenerateQuestion({ id: questionId, question: wording, type, skill_tag }: TestVariant["questions"][number]) {
    if (!test || !window.confirm(p.confirmRegenerate)) return;
    const variant = variantName;
    setRegenerating(questionId); setError(""); setMessage("");
    try {
      const { question } = await api<{ question: TestVariant["questions"][number] }>(`/api/tests/${id}/regenerate`, {
        method: "POST", body: JSON.stringify({ variant_name: variant, question_id: questionId, question: wording, type, skill_tag }),
      });
      setTest(current => {
        if (!current) return current;
        const variants = structuredClone(current.variants);
        const at = variants[variant].questions.findIndex(item => item.id === questionId);
        if (at >= 0) {
          variants[variant].questions[at] = question;
          // The old criterion and descriptor described the old question.
          const assessment = variants[variant].assessment;
          if (assessment) assessment.rows = assessment.rows.filter(row => row.task !== at + 1);
        }
        return { ...current, variants };
      });
      setMessage(p.regenerated);
    } catch (cause) { setError(err(cause, p.regenerateFailed)); }
    finally { setRegenerating(""); }
  }
  async function save(status?: TestRow["status"]) {
    if (!test) return;
    // Name the first broken variant instead of letting the server reject the whole save.
    const broken = Object.keys(test.variants).find(name => !isValidVariant(test.variants[name]));
    if (broken) { setVariantName(broken); setError(p.fixProblems(variantLabel(broken, t))); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/tests/${id}`, { method: "PATCH", body: JSON.stringify({ variants: test.variants, title: test.title, ...(status ? { status } : {}) }) });
      // Mark only what was sent as saved; edits made while the request was
      // in flight stay in the editor and stay unsaved.
      savedSnapshot.current = snapshot(test);
      setTest(current => current ? { ...current, status: status || current.status } : current); setMessage(p.saved);
    } catch (cause) { setError(err(cause, p.saveFailed)); }
    finally { setBusy(false); }
  }
  async function createLink() {
    setError(""); setMessage("");
    const allowedStudents = selectedClassId
      ? []
      : normalizeEmailAllowlist(allowedText.split(/[\s,;]+/).filter(Boolean));
    if (!allowedStudents) {
      setError(p.checkEmails);
      return;
    }
    const allowAnyStudent = !selectedClassId && allowedStudents.length === 0;
    if (!hasExplicitShareScope(selectedClassId || null, allowedStudents, allowAnyStudent)) {
      setError(p.chooseScope);
      return;
    }
    if (allowAnyStudent && !window.confirm(p.confirmOpenLink)) return;
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>(`/api/tests/${id}/share`, { method: "POST", body: JSON.stringify({ variant_name: variantName, class_id: selectedClassId || null, allow_any_student: allowAnyStudent, settings: { ...settings, allowed_students: allowedStudents } }) });
      const copied = await navigator.clipboard.writeText(url).then(() => true).catch(() => false);
      setMessage(copied ? p.linkCreated(url) : p.linkCreatedManual(url)); await refresh();
    } catch (cause) { setError(err(cause, p.linkFailed)); }
    finally { setBusy(false); }
  }
  async function toggleLink(link: LinkRow) {
    try { await api(`/api/links/${link.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !link.is_active }) }); await refresh(); }
    catch (cause) { setError(err(cause, p.linkToggleFailed)); }
  }
  async function saveManualReview(attemptId: string) {
    setBusy(true); setError("");
    try {
      await api(`/api/tests/${id}/attempts/review`, {
        method: "PATCH",
        body: JSON.stringify({ attempt_id: attemptId, percentage: Number(reviewScores[attemptId]) }),
      });
      setReviewScores(current => { const next = { ...current }; delete next[attemptId]; return next; });
      await refresh();
      setMessage(p.reviewSaved);
    } catch (cause) { setError(err(cause, p.reviewFailed)); }
    finally { setBusy(false); }
  }
  async function suggestScores() {
    if (!window.confirm(p.suggestNote)) return;
    setSuggesting(true); setResultsError(""); setMessage("");
    try {
      const result = await api<{ suggestions: Suggestion[] }>(`/api/tests/${id}/attempts/suggest`, { method: "POST", body: JSON.stringify({ exclude: Object.keys(suggestions) }) });
      setSuggestions(current => ({ ...current, ...Object.fromEntries(result.suggestions.map(item => [item.attempt_id, item])) }));
      setMessage(result.suggestions.length ? p.suggestDone(result.suggestions.length) : p.suggestNone);
    } catch (cause) { setResultsError(err(cause, p.suggestFailed)); }
    finally { setSuggesting(false); }
  }
  async function toggleAnalytics() {
    if (allAttempts) { setAllAttempts(null); return; }
    setAnalyticsBusy(true); setResultsError("");
    try { setAllAttempts((await api<AttemptsResponse>(`/api/tests/${id}/attempts?all=true`)).attempts); }
    catch (cause) { setResultsError(err(cause, p.analyticsFailed)); }
    finally { setAnalyticsBusy(false); }
  }
  async function exportCsv() {
    setExporting(true); setResultsError("");
    let exportRows = attempts;
    try { exportRows = (await api<AttemptsResponse>(`/api/tests/${id}/attempts?all=true`)).attempts; }
    catch (cause) { setResultsError(err(cause, p.exportFailed)); setExporting(false); return; }
    const headers = p.csvHeaders;
    const csv = [headers, ...exportRows.map(a => [a.csv_student_name ?? a.student_name, a.csv_student_email ?? "", variantLabel(a.variant_name, t), a.percentage ?? p.awaitingReview, date(a.submitted_at, "dateTime"), a.integrity?.leaves ?? "", a.integrity?.away_seconds ?? "", a.integrity?.pastes ?? "", a.integrity?.copies ?? "", a.integrity ? (a.integrity.auto_submitted ? p.csvYes : p.csvNo) : ""])]
      .map(row => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `results-${id}.csv`; anchor.click(); URL.revokeObjectURL(url); setExporting(false);
  }
  const currentVariant = test?.variants?.[variantName];
  // Answers are shown as text; the question (for its type) comes from the attempt's variant.
  const answerLine = (attempt: Attempt, questionId: string) => {
    const question = test?.variants?.[attempt.variant_name]?.questions.find(item => item.id === questionId);
    const value = attempt.answers[questionId];
    return question ? answerText(question, value) : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  };
  return <div className="wrap"><TeacherHeader current="tests" canLeave={canLeave} />
    {!test ? <div className="panel">{error || p.loading}</div> : <><section className="page-head"><div className="eyebrow">{p.eyebrow(t.status[test.status])}</div><h1>{test.title}</h1><div className="row head-meta">{testMeta(test) ? <p className="muted">{testMeta(test)}</p> : <span />}<Link className="btn" href={`/tests/${id}/print`} onClick={event => { if (!canLeave()) event.preventDefault(); }}>{p.printTest}</Link></div></section>
      <div className={tab === "review" ? "toolbar save-bar" : "toolbar"}><div className="tabs">{[["review",p.tabReview],["share",p.tabShare],["results",p.tabResults]].map(([value,label]) => <button className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>{tab === "review" && <div className="row save-actions"><span className={dirty ? "save-state dirty" : "save-state"} role="status">{dirty ? p.unsaved : p.allSaved}</span><button className={dirty ? "btn primary" : "btn"} disabled={busy || !dirty || Boolean(regenerating)} onClick={() => save()}>{p.save}</button>{test.status === "draft" && <button className="btn primary" disabled={busy || Boolean(regenerating)} onClick={() => save("published")}>{p.publish}</button>}{test.status === "published" && <button className="btn ghost" disabled={busy || Boolean(regenerating)} onClick={() => { if (window.confirm(p.confirmArchive)) void save("archived"); }}>{p.archive}</button>}{test.status === "archived" && <button className="btn primary" disabled={busy || Boolean(regenerating)} onClick={() => save("published")}>{p.restore}</button>}</div>}</div>
      {error && <div className="error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}{message && <div className="success" role="status" style={{ marginBottom: 16 }}>{message}</div>}
      {tab !== "results" && <div className="tabs" style={{ marginBottom: 18 }}>{Object.keys(test.variants).map(name => <button key={name} className={variantName === name ? "active" : ""} onClick={() => setVariantName(name)}>{variantLabel(name, t)}</button>)}</div>}
      {tab === "review" && currentVariant && <div className="stack"><div className="panel"><label className="field">{p.testTitle}<input value={test.title} onChange={e => setTest({ ...test, title: e.target.value })} /></label><p className="muted small" style={{ margin: "14px 0 0" }}>{p.reviewHint}</p></div><SourcesPanel variant={currentVariant} t={t} />{currentVariant.assessment ? <RubricEditor t={t} variant={currentVariant} edit={mutator => editVariant(v => { if (v.assessment) mutator(v.assessment); })} /> : Object.values(test.variants).some(v => v.assessment) && <p className="notice small">{p.rubricMissing}</p>}{currentVariant.questions.map((question, index) => <QuestionEditor key={question.id} t={t} question={question} index={index} canDelete={currentVariant.questions.length > 1} regenerating={regenerating === question.id} disabled={busy || Boolean(regenerating)} edit={mutator => editVariant(v => mutator(v.questions[index]))} onDelete={() => { if (window.confirm(p.confirmDeleteQuestion)) editVariant(v => { v.questions.splice(index, 1); if (v.assessment) v.assessment.rows = v.assessment.rows.filter(row => row.task !== index + 1).map(row => row.task > index + 1 ? { ...row, task: row.task - 1 } : row); }); }} onRegenerate={() => void regenerateQuestion(question)} />)}<div className="panel row add-question"><label className="field">{p.newQuestionType}<select value={newType} onChange={e => setNewType(e.target.value as QuestionType)}><option value="multiple_choice">{t.create.typeMultipleChoice}</option><option value="true_false">{t.create.typeTrueFalse}</option><option value="short_answer">{t.create.typeShortAnswer}</option><option value="matching">{t.create.typeMatching}</option><option value="multiple_select">{t.create.typeMultipleSelect}</option><option value="ordering">{t.create.typeOrdering}</option></select></label><button type="button" className="btn" disabled={busy || currentVariant.questions.length >= 50} onClick={() => editVariant(v => { v.questions.push(blankQuestion(newType, test.language, `manual-${crypto.randomUUID().slice(0, 8)}`)); })}>{p.addQuestion}</button></div></div>}
      {tab === "share" && <div className="grid cols-2"><div className="panel stack"><h3>{p.newLink(variantLabel(variantName, t))}</h3>{test.status !== "published" ? <div className="notice">{p.publishFirst}</div> : <><p className="small muted">{p.shareLead}</p><div className="eyebrow settings-group">{p.whoTakes}</div><label className="field">{p.audience}<select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}><option value="">{p.audienceEmails}</option>{classes.filter(row => row.is_active).map(row => <option key={row.id} value={row.id}>{row.name} ({row.web_class_members.length})</option>)}</select></label>{selectedClassId ? <div className="notice">{p.classOnly(classes.find(row => row.id === selectedClassId)?.name || "")}{classes.find(row => row.id === selectedClassId)?.web_class_members.length === 0 && <p className="error" style={{ marginTop: 10 }}>{p.classEmpty}</p>}</div> : <><label className="field">{p.allowed}<textarea value={allowedText} onChange={e => setAllowedText(e.target.value)} placeholder={p.allowedPlaceholder} /></label><p className="muted small">{p.allowedHint}</p></>}{classLoadError && <div className="notice">{classLoadError} <Link href="/classes">{p.openClasses}</Link></div>}<div className="eyebrow settings-group">{p.time}</div><div className="grid cols-2"><label className="field">{p.timer}<input type="number" min={0} max={240} value={settings.timer_minutes} onChange={e => setSettings({ ...settings, timer_minutes: Number(e.target.value) })} /></label><label className="field">{p.deadline}<input type="datetime-local" lang={intl} value={settings.deadline_at ? new Date(Date.parse(settings.deadline_at) - new Date(settings.deadline_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={e => setSettings({ ...settings, deadline_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label></div>{settings.deadline_at && Number.isFinite(Date.parse(settings.deadline_at)) && <p className="muted small">{p.closesAt(date(settings.deadline_at, "dayTimeLong"))}</p>}{settings.timer_minutes > 0 && <p className="notice small">{p.timerNote}</p>}<div className="eyebrow settings-group">{p.howTaken}</div><label className="option"><input type="checkbox" checked={settings.strict_mode} onChange={e => setSettings({ ...settings, strict_mode: e.target.checked, ...(e.target.checked ? { one_question_at_a_time: true } : {}) })} />{p.strict}</label>{settings.strict_mode && <div className="stack strict-settings"><div className="grid cols-2"><label className="field">{p.leaveLimit}<select value={settings.leave_limit === null ? "off" : String(settings.leave_limit)} onChange={e => setSettings({ ...settings, leave_limit: e.target.value === "off" ? null : Number(e.target.value) })}><option value="0">{p.leaveImmediately}</option><option value="1">{p.leaveAfter(2)}</option><option value="2">{p.leaveAfter(3)}</option><option value="3">{p.leaveAfter(4)}</option><option value="off">{p.leaveOff}</option></select></label><label className="field">{p.questionSeconds}<input type="number" min={0} max={600} step={5} value={settings.question_seconds} onChange={e => setSettings({ ...settings, question_seconds: Number(e.target.value) })} /></label></div><label className="option"><input type="checkbox" checked={settings.require_fullscreen} onChange={e => setSettings({ ...settings, require_fullscreen: e.target.checked })} />{p.requireFullscreen}</label>{settings.require_fullscreen && <p className="muted small">{p.fullscreenNote}</p>}<p className="notice small">{p.strictNote}</p></div>}<label className="option"><input type="checkbox" checked={settings.randomize} onChange={e => setSettings({ ...settings, randomize: e.target.checked })} />{p.randomize}</label><label className="option"><input type="checkbox" checked={settings.one_question_at_a_time || settings.strict_mode} disabled={settings.strict_mode} onChange={e => setSettings({ ...settings, one_question_at_a_time: e.target.checked })} />{p.oneByOne}</label>{settings.one_question_at_a_time && !settings.strict_mode && <p className="muted small">{p.oneByOneHint}</p>}<label className="option"><input type="checkbox" checked={settings.reveal_score} onChange={e => setSettings({ ...settings, reveal_score: e.target.checked })} />{p.revealScore}</label><label className="option"><input type="checkbox" checked={settings.reveal_answers} onChange={e => setSettings({ ...settings, reveal_answers: e.target.checked })} />{p.revealAnswers}</label>{settings.reveal_answers && <p className="notice small">{p.revealAnswersNote}</p>}<button className="btn primary" onClick={createLink} disabled={busy || (Boolean(selectedClassId) && !classes.some(row => row.id === selectedClassId && row.is_active)) || (Boolean(selectedClassId) && !classes.find(row => row.id === selectedClassId)?.web_class_members.length)}>{p.createLink}</button></>}</div><div className="panel"><h3>{p.activeLinks}</h3>{links.length ? links.map(link => <div className="list-item" key={link.id}><div className="row"><b>{variantLabel(link.variant_name, t)}</b><span className="row" style={{ gap: 6 }}>{link.settings?.strict_mode && <span className="pill">{p.strictPill}</span>}<span className="pill">{link.is_active ? p.linkOpen : p.linkClosed}</span></span></div><p className="small muted">{date(link.created_at, "dateTime")}{link.class_id ? p.linkClass(classes.find(row => row.id === link.class_id)?.name || p.linkClassFallback) : p.linkNoClass}</p><p className="small"><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a></p><div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(link.url).then(() => setMessage(p.copied)).catch(() => setError(p.copyFailed))}>{p.copy}</button>{link.is_active && <button className="btn" onClick={() => setQrLink(link)}>{p.showQr}</button>}<button className="btn ghost" onClick={() => toggleLink(link)}>{link.is_active ? p.closeLink : p.openLink}</button></div></div>) : <p className="muted">{p.noLinks}</p>}</div></div>}
      {tab === "results" && <div className="stack">{resultsError && <div className="error" role="alert">{resultsError}<p className="small">{p.resultsStale}</p></div>}<div className="panel kpi-row"><div><div className="metric">{summary.count}</div><div className="muted small">{p.submittedCount}</div></div><div><div className="metric">{summary.graded_count ? `${summary.average}%` : "—"}</div><div className="muted small">{summary.graded_count ? p.averageChecked(summary.graded_count) : p.average}</div></div><div><div className="metric">{summary.pending_review}</div><div className="muted small">{p.pendingReview}</div></div><div className="kpi-refresh"><button className="btn" onClick={refresh}>{p.refresh}</button><p className="muted small">{p.autoRefresh}</p></div></div>{summary.count > 0 && <div className="panel stack"><div className="row"><h3 style={{ margin: 0 }}>{p.analytics}</h3><button className="btn" disabled={analyticsBusy} aria-expanded={Boolean(allAttempts)} onClick={() => void toggleAnalytics()}>{analyticsBusy ? p.analyticsLoading : allAttempts ? p.analyticsHide : p.analyticsShow}</button></div>{allAttempts && <ClassAnalytics t={t} test={test} attempts={allAttempts} />}</div>}<div className="panel"><div className="row"><h3>{p.journal}</h3><div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>{summary.pending_review > 0 && <button className="btn" disabled={suggesting} onClick={() => void suggestScores()}>{suggesting ? p.suggesting : p.suggestGrades}</button>}<button className="btn" onClick={() => void exportCsv()} disabled={!attempts.length || exporting || Boolean(resultsError)}>{exporting ? p.exporting : p.export}</button></div></div>{attempts.length ? <div><div className="results-list"><div className="results-head" aria-hidden="true"><span>{p.colStudent}</span><span>{p.colVariant}</span><span>{p.colScore}</span><span>{p.colIntegrity}</span><span>{p.colSubmitted}</span></div>{attempts.map(a => <details className="result-row" key={a.id}><summary><span className="result-name">{a.student_name}{a.student_email && <span className="student-email muted small">{a.student_email}</span>}</span><span className="result-variant">{variantLabel(a.variant_name, t)}</span><b className="result-score">{a.percentage === null ? p.awaitingReview : `${a.percentage}%`}</b><span className={a.integrity && (a.integrity.leaves || a.integrity.pastes || a.integrity.auto_submitted) ? "result-integrity integrity-flag" : "result-integrity muted"}>{integrityLabel(t, a.integrity)}</span><span className="result-date muted">{date(a.submitted_at, "dayTime")}</span></summary><div className="result-detail">{a.integrity && <p className="small">{p.integritySignals(integrityLabel(t, a.integrity))}</p>}{(a.result?.per_question_scoring === "unscored" || a.result?.manually_reviewed_by) && <p className="muted small">{p.manualTotal}</p>}{a.result?.per_question?.map((q,i) => <div className="list-item" key={q.id}><b>{p.question(i + 1)}</b> · {q.skill_tag || p.noSkill} · {questionScoreLabel(t, a, q)}{a.integrity?.question_seconds?.[q.id] !== undefined && <span className="muted small">{p.secondsOnQuestion(a.integrity.question_seconds[q.id])}</span>}<div className="muted small">{p.answer(answerLine(a, q.id) || p.noAnswer)}</div>{a.result?.requires_manual_review && suggestions[a.id]?.questions.find(item => item.id === q.id) && (() => { const hint = suggestions[a.id].questions.find(item => item.id === q.id)!; return <div className="ai-hint small"><b>{p.aiSays(Math.round(hint.score * 100))}</b> {hint.comment}</div>; })()}</div>)}{a.result?.requires_manual_review && <div className="row" style={{ marginTop: 16 }}><label className="field">{p.finalScore}<input type="number" min="0" max="100" value={reviewScores[a.id] ?? ""} onChange={e => setReviewScores(current => ({ ...current, [a.id]: e.target.value }))} /></label>{suggestions[a.id] && <button className="btn" onClick={() => setReviewScores(current => ({ ...current, [a.id]: String(suggestions[a.id].percentage) }))}>{p.useSuggestion(suggestions[a.id].percentage)}</button>}<button className="btn primary" disabled={busy || reviewScores[a.id] === undefined || reviewScores[a.id] === ""} onClick={() => void saveManualReview(a.id)}>{p.saveReview}</button></div>}</div></details>)}</div><div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}><span className="muted small">{p.pageOf(totalPages ? resultsPage + 1 : 0, totalPages, summary.count)}</span><div className="row"><button className="btn" disabled={resultsPage === 0} onClick={() => setResultsPage(page => Math.max(0, page - 1))}>{t.common.back}</button><button className="btn" disabled={resultsPage + 1 >= totalPages} onClick={() => setResultsPage(page => page + 1)}>{t.common.next}</button></div></div></div> : <p className="muted">{resultsError ? p.noFreshData : p.noAttempts}</p>}</div></div>}
      {qrLink && <BoardQr url={qrLink.url} title={test.title} onClose={() => setQrLink(null)} />}
    </>}
  </div>;
}
