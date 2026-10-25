"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import type { ClassRow, TestRow, TestVariant, ShareSettings } from "@/lib/types";
import { csvCell } from "@/lib/csv-export";
import { hasExplicitShareScope, normalizeEmailAllowlist } from "@/lib/share-access";
import { testMeta, variantLabel } from "@/lib/labels";
import { TeacherHeader } from "../../teacher-nav";

type LinkRow = { id: string; token: string; url: string; variant_name: string; class_id: string | null; is_active: boolean; settings: ShareSettings; created_at: string };
type Attempt = { id: string; student_name: string; csv_student_name?: string; variant_name: string; percentage: number | null; answers: Record<string, unknown>; result: { requires_manual_review?: boolean; manually_reviewed_by?: string; per_question_scoring?: string; per_question: { id: string; skill_tag: string; score: number | null; requires_manual_review?: boolean }[] }; submitted_at: string; integrity?: Integrity | null };
type Integrity = { leaves: number; pastes: number; copies: number; auto_submitted: boolean; away_seconds: number; question_seconds: Record<string, number> };
type AttemptSummary = { count: number; graded_count: number; pending_review: number; average: number };
type AttemptsResponse = { attempts: Attempt[]; summary: AttemptSummary; page: number; page_size: number; total_pages: number; has_more: boolean };

function questionScoreLabel(attempt: Attempt, question: Attempt["result"]["per_question"][number]) {
  if (attempt.result?.per_question_scoring === "unscored" || attempt.result?.manually_reviewed_by || question.score === null) return "Не оценено по вопросу";
  if (question.requires_manual_review) return "Требует ручной проверки";
  return `${Math.round(question.score * 100)}%`;
}

function integrityLabel(integrity: Integrity | null | undefined) {
  if (!integrity) return "—";
  const parts = [
    integrity.auto_submitted ? "автосдача" : "",
    integrity.leaves ? `уходов: ${integrity.leaves}${integrity.away_seconds ? ` (${integrity.away_seconds} с)` : ""}` : "",
    integrity.pastes ? `вставок: ${integrity.pastes}` : "",
    integrity.copies ? `копирований: ${integrity.copies}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "без нарушений";
}

function SourcesPanel({ variant }: { variant: TestVariant }) {
  if (!variant.sources?.length) return null;
  return <section className="panel stack"><div><div className="eyebrow">Источник для генерации</div><h3 style={{ margin: "6px 0" }}>Материалы преподавателя</h3></div>{variant.sources.map((source, index) => <div className="list-item" key={`${source.label}-${index}`}><b>{source.label}</b>{source.pages && <div className="muted small">{source.pages}</div>}{source.url && <a className="small" href={source.url} target="_blank" rel="noreferrer">Открыть ссылку на источник</a>}</div>)}<p className="small muted">Это описание материала, добавленного преподавателем. AI не загружает содержимое ссылки самостоятельно.</p></section>;
}

export default function TestPage() {
  const { id } = useParams<{ id: string }>();
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
  const [settings, setSettings] = useState<ShareSettings>({ allowed_students: [], deadline_at: null, timer_minutes: 0, one_question_at_a_time: true, randomize: true, reveal_score: false, strict_mode: false, leave_limit: 2, question_seconds: 90 });
  const [allowedText, setAllowedText] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [classLoadError, setClassLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resultsError, setResultsError] = useState("");
  const [message, setMessage] = useState("");
  // What the server last confirmed; edits that differ from it are unsaved.
  const savedSnapshot = useRef("");
  const dirtyRef = useRef(false);
  const snapshot = (row: TestRow) => JSON.stringify({ title: row.title, variants: row.variants });
  const dirty = Boolean(test) && snapshot(test!) !== savedSnapshot.current;
  dirtyRef.current = dirty;
  const canLeave = () => !dirtyRef.current || window.confirm("Есть несохранённые изменения в вопросах. Уйти без сохранения?");

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
        setResultsError(cause instanceof Error ? cause.message : "Не удалось загрузить результаты.");
      }
      try {
        const classResult = await api<{ classes: ClassRow[] }>("/api/classes");
        setClasses(classResult.classes);
        setClassLoadError("");
      } catch {
        setClasses([]);
        setClassLoadError("Чтобы использовать классы, сначала примените миграцию школьных классов в Supabase.");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить тест."); }
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
        .catch(cause => setResultsError(cause instanceof Error ? cause.message : "Не удалось обновить результаты."));
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
  async function save(status?: TestRow["status"]) {
    if (!test) return; setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/tests/${id}`, { method: "PATCH", body: JSON.stringify({ variants: test.variants, title: test.title, ...(status ? { status } : {}) }) });
      savedSnapshot.current = snapshot(test);
      setTest({ ...test, status: status || test.status }); setMessage("Изменения сохранены.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить изменения."); }
    finally { setBusy(false); }
  }
  async function createLink() {
    setError(""); setMessage("");
    const allowedStudents = selectedClassId
      ? []
      : normalizeEmailAllowlist(allowedText.split(/[\s,;]+/).filter(Boolean));
    if (!allowedStudents) {
      setError("Проверьте список учеников: не более 100 корректных email-адресов.");
      return;
    }
    const allowAnyStudent = !selectedClassId && allowedStudents.length === 0;
    if (!hasExplicitShareScope(selectedClassId || null, allowedStudents, allowAnyStudent)) {
      setError("Выберите класс или укажите учеников, которым будет доступен тест.");
      return;
    }
    if (allowAnyStudent && !window.confirm("Список учеников пуст. Ссылка будет доступна любому вошедшему ученику. Создать открытую ссылку?")) return;
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>(`/api/tests/${id}/share`, { method: "POST", body: JSON.stringify({ variant_name: variantName, class_id: selectedClassId || null, allow_any_student: allowAnyStudent, settings: { ...settings, allowed_students: allowedStudents } }) });
      const copied = await navigator.clipboard.writeText(url).then(() => true).catch(() => false);
      setMessage(`${copied ? "Ссылка создана и скопирована" : "Ссылка создана; скопируйте её вручную"}: ${url}`); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать ссылку."); }
    finally { setBusy(false); }
  }
  async function toggleLink(link: LinkRow) {
    try { await api(`/api/links/${link.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !link.is_active }) }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось изменить ссылку."); }
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
      setMessage("Оценка сохранена.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить оценку."); }
    finally { setBusy(false); }
  }
  async function exportCsv() {
    setExporting(true); setResultsError("");
    let exportRows = attempts;
    try { exportRows = (await api<AttemptsResponse>(`/api/tests/${id}/attempts?all=true`)).attempts; }
    catch (cause) { setResultsError(cause instanceof Error ? cause.message : "Не удалось загрузить все результаты для CSV."); setExporting(false); return; }
    const headers = ["Ученик", "Вариант", "Оценка (%)", "Сдано", "Уходов со страницы", "Вне теста (с)", "Вставок", "Копирований", "Автосдача"];
    const csv = [headers, ...exportRows.map(a => [a.csv_student_name ?? a.student_name, variantLabel(a.variant_name), a.percentage ?? "Ожидает проверки", new Date(a.submitted_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }), a.integrity?.leaves ?? "", a.integrity?.away_seconds ?? "", a.integrity?.pastes ?? "", a.integrity?.copies ?? "", a.integrity ? (a.integrity.auto_submitted ? "да" : "нет") : ""])]
      .map(row => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `results-${id}.csv`; anchor.click(); URL.revokeObjectURL(url); setExporting(false);
  }
  const currentVariant = test?.variants?.[variantName];
  return <div className="wrap"><TeacherHeader current="tests" canLeave={canLeave} />
    {!test ? <div className="panel">{error || "Загружаем тест..."}</div> : <><section className="page-head"><div className="eyebrow">Тест / {test.status === "draft" ? "Черновик" : test.status === "published" ? "Опубликован" : "Архив"}</div><h1>{test.title}</h1>{testMeta(test) && <p className="muted">{testMeta(test)}</p>}</section>
      <div className={tab === "review" ? "toolbar save-bar" : "toolbar"}><div className="tabs">{[["review","Вопросы"],["share","Поделиться"],["results","Результаты"]].map(([value,label]) => <button className={tab === value ? "active" : ""} key={value} onClick={() => setTab(value)}>{label}</button>)}</div>{tab === "review" && <div className="row save-actions"><span className={dirty ? "save-state dirty" : "save-state"} role="status">{dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"}</span><button className={dirty ? "btn primary" : "btn"} disabled={busy || !dirty} onClick={() => save()}>Сохранить</button>{test.status === "draft" && <button className="btn primary" disabled={busy} onClick={() => save("published")}>Опубликовать →</button>}{test.status === "published" && <button className="btn ghost" disabled={busy} onClick={() => { if (window.confirm("Архивировать тест? Ученики больше не смогут открыть его ссылки.")) void save("archived"); }}>В архив</button>}{test.status === "archived" && <button className="btn primary" disabled={busy} onClick={() => save("published")}>Восстановить</button>}</div>}</div>
      {error && <div className="error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}{message && <div className="success" role="status" style={{ marginBottom: 16 }}>{message}</div>}
      {tab !== "results" && <div className="tabs" style={{ marginBottom: 18 }}>{Object.keys(test.variants).map(name => <button key={name} className={variantName === name ? "active" : ""} onClick={() => setVariantName(name)}>{variantLabel(name)}</button>)}</div>}
      {tab === "review" && currentVariant && <div className="stack"><div className="panel"><label className="field">Название теста<input value={test.title} onChange={e => setTest({ ...test, title: e.target.value })} /></label><p className="muted small" style={{ margin: "14px 0 0" }}>Проверьте формулировки и ответы AI до отправки ученикам.</p></div><SourcesPanel variant={currentVariant} />{currentVariant.questions.map((question, index) => <div className="panel stack" key={question.id}><div className="row"><span className="eyebrow">Вопрос {index + 1}</span><span className="pill">{question.skill_tag || question.type}</span></div><label className="field">Формулировка<textarea value={question.question} onChange={e => editVariant(v => { v.questions[index].question = e.target.value; })} /></label>{question.source_reference && <p className="small muted">Источник: {question.source_reference}</p>}{question.options?.map((option, optionIndex) => <label className="field" key={optionIndex}>Вариант ответа {optionIndex + 1}<input value={option} onChange={e => editVariant(v => { const q = v.questions[index]; const old = q.options![optionIndex]; q.options![optionIndex] = e.target.value; if (q.correct_answer === old) q.correct_answer = e.target.value; })} /></label>)}{question.type === "matching" && question.pairs?.map((pair, pairIndex) => <div className="grid cols-2" key={pairIndex}><label className="field">Левая часть<input value={pair.left} onChange={e => editVariant(v => { v.questions[index].pairs![pairIndex].left = e.target.value; })} /></label><label className="field">Правая часть<input value={pair.right} onChange={e => editVariant(v => { v.questions[index].pairs![pairIndex].right = e.target.value; })} /></label></div>)}<label className="field">Правильный ответ{question.options ? <select value={question.correct_answer} onChange={e => editVariant(v => { v.questions[index].correct_answer = e.target.value; })}>{question.options.map((option, i) => <option value={option} key={i}>{option}</option>)}</select> : <input value={question.correct_answer} onChange={e => editVariant(v => { v.questions[index].correct_answer = e.target.value; })} />}</label><label className="field">Объяснение<textarea value={question.explanation || ""} onChange={e => editVariant(v => { v.questions[index].explanation = e.target.value; })} /></label></div>)}</div>}
      {tab === "share" && <div className="grid cols-2"><div className="panel stack"><h3>Новая ссылка: {variantLabel(variantName)}</h3>{test.status !== "published" ? <div className="notice">Сначала опубликуйте тест на вкладке «Вопросы».</div> : <><p className="small muted">Ученик открывает ссылку, входит под своим аккаунтом и проходит тест.</p><div className="eyebrow settings-group">Кто проходит</div><label className="field">Кому доступен тест<select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)}><option value="">Выбранным ученикам по email</option>{classes.filter(row => row.is_active).map(row => <option key={row.id} value={row.id}>{row.name} ({row.web_class_members.length})</option>)}</select></label>{selectedClassId ? <div className="notice">Доступ получат только ученики класса «{classes.find(row => row.id === selectedClassId)?.name}», чей подтверждённый Google email внесён в список этого класса.{classes.find(row => row.id === selectedClassId)?.web_class_members.length === 0 && <p className="error" style={{ marginTop: 10 }}>В классе пока нет учеников. Добавьте roster на странице «Классы».</p>}</div> : <><label className="field">Допущенные ученики (email через запятую)<textarea value={allowedText} onChange={e => setAllowedText(e.target.value)} placeholder="ivanov@school.kz, petrova@school.kz" /></label><p className="muted small">Чтобы дать тест всему классу, выберите класс выше. Если оставить список пустым, ссылка откроется любому ученику с аккаунтом.</p></>}{classLoadError && <div className="notice">{classLoadError} <Link href="/classes">Открыть классы →</Link></div>}<div className="eyebrow settings-group">Время</div><div className="grid cols-2"><label className="field">Таймер, минут (0 — без таймера)<input type="number" min={0} max={240} value={settings.timer_minutes} onChange={e => setSettings({ ...settings, timer_minutes: Number(e.target.value) })} /></label><label className="field">Дедлайн<input type="datetime-local" lang="ru" value={settings.deadline_at ? new Date(Date.parse(settings.deadline_at) - new Date(settings.deadline_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={e => setSettings({ ...settings, deadline_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label></div>{settings.deadline_at && Number.isFinite(Date.parse(settings.deadline_at)) && <p className="muted small">Тест закроется {new Date(settings.deadline_at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.</p>}{settings.timer_minutes > 0 && <p className="notice small">Когда время выйдет, работа отправится сама. Если ученик закроет вкладку раньше, автоматическая отправка сработает только после того, как администратор включит её на сервере — проверьте это на тестовом аккаунте до контрольной.</p>}<div className="eyebrow settings-group">Как проходит</div><label className="option"><input type="checkbox" checked={settings.strict_mode} onChange={e => setSettings({ ...settings, strict_mode: e.target.checked, ...(e.target.checked ? { one_question_at_a_time: true } : {}) })} />Строгий режим (защита от списывания)</label>{settings.strict_mode && <div className="stack strict-settings"><div className="grid cols-2"><label className="field">Автосдача после уходов со страницы<select value={settings.leave_limit === null ? "off" : String(settings.leave_limit)} onChange={e => setSettings({ ...settings, leave_limit: e.target.value === "off" ? null : Number(e.target.value) })}><option value="0">Сразу при первом уходе</option><option value="1">После 2-го ухода</option><option value="2">После 3-го ухода</option><option value="3">После 4-го ухода</option><option value="off">Не сдавать, только отмечать</option></select></label><label className="field">Секунд на один вопрос (0 — без ограничения)<input type="number" min={0} max={600} step={5} value={settings.question_seconds} onChange={e => setSettings({ ...settings, question_seconds: Number(e.target.value) })} /></label></div><p className="notice small">Вопросы скрываются, когда ученик уходит со страницы; копирование и вставка отключены; поверх вопросов виден водяной знак с именем ученика; с таймером на вопрос вернуться к прошлым вопросам нельзя. Уходы, вставки и время на вопросы видны во вкладке «Результаты». Это сигналы для внимания, а не доказательство: уведомление или блокировка экрана телефона тоже считаются уходом. Второй телефон сайт не видит — на контрольной попросите сдать телефоны.</p></div>}<label className="option"><input type="checkbox" checked={settings.randomize} onChange={e => setSettings({ ...settings, randomize: e.target.checked })} />Перемешивать вопросы и ответы</label><label className="option"><input type="checkbox" checked={settings.one_question_at_a_time || settings.strict_mode} disabled={settings.strict_mode} onChange={e => setSettings({ ...settings, one_question_at_a_time: e.target.checked })} />По одному вопросу</label>{settings.one_question_at_a_time && !settings.strict_mode && <p className="muted small">Ученик видит вопросы по одному. Это удобство, а не защита: от списывания защищает строгий режим.</p>}<label className="option"><input type="checkbox" checked={settings.reveal_score} onChange={e => setSettings({ ...settings, reveal_score: e.target.checked })} />Показать оценку после сдачи</label><button className="btn primary" onClick={createLink} disabled={busy || (Boolean(selectedClassId) && !classes.some(row => row.id === selectedClassId && row.is_active)) || (Boolean(selectedClassId) && !classes.find(row => row.id === selectedClassId)?.web_class_members.length)}>Создать и скопировать ссылку</button></>}</div><div className="panel"><h3>Активные ссылки</h3>{links.length ? links.map(link => <div className="list-item" key={link.id}><div className="row"><b>{variantLabel(link.variant_name)}</b><span className="row" style={{ gap: 6 }}>{link.settings?.strict_mode && <span className="pill">Строгий режим</span>}<span className="pill">{link.is_active ? "Открыта" : "Закрыта"}</span></span></div><p className="small muted">{new Date(link.created_at).toLocaleString("ru-RU")}{link.class_id ? ` · Класс: ${classes.find(row => row.id === link.class_id)?.name || "класс"}` : " · Без класса"}</p><p className="small"><a href={link.url} target="_blank" rel="noreferrer">{link.url}</a></p><div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(link.url).then(() => setMessage("Ссылка скопирована.")).catch(() => setError("Не удалось скопировать ссылку."))}>Копировать</button><button className="btn ghost" onClick={() => toggleLink(link)}>{link.is_active ? "Закрыть" : "Открыть"}</button></div></div>) : <p className="muted">Ссылок пока нет.</p>}</div></div>}
      {tab === "results" && <div className="stack">{resultsError && <div className="error" role="alert">Не удалось загрузить результаты. {resultsError}<p className="small">Показанные ниже данные могут быть устаревшими. CSV станет доступен после успешного обновления.</p></div>}<div className="panel kpi-row"><div><div className="metric">{summary.count}</div><div className="muted small">Сдано работ</div></div><div><div className="metric">{summary.graded_count ? `${summary.average}%` : "—"}</div><div className="muted small">{summary.graded_count ? `Средний результат · проверено ${summary.graded_count}` : "Средний результат"}</div></div><div><div className="metric">{summary.pending_review}</div><div className="muted small">Ждут ручной проверки</div></div><div className="kpi-refresh"><button className="btn" onClick={refresh}>Обновить</button><p className="muted small">Обновляется само каждые 10 секунд.</p></div></div><div className="panel"><div className="row"><h3>Журнал результатов</h3><button className="btn" onClick={() => void exportCsv()} disabled={!attempts.length || exporting || Boolean(resultsError)}>{exporting ? "Готовим CSV…" : "Экспорт CSV"}</button></div>{attempts.length ? <div><div className="results-list"><div className="results-head" aria-hidden="true"><span>Ученик</span><span>Вариант</span><span>Результат</span><span>Честность</span><span>Сдано</span></div>{attempts.map(a => <details className="result-row" key={a.id}><summary><span className="result-name">{a.student_name}</span><span className="result-variant">{variantLabel(a.variant_name)}</span><b className="result-score">{a.percentage === null ? "Ожидает проверки" : `${a.percentage}%`}</b><span className={a.integrity && (a.integrity.leaves || a.integrity.pastes || a.integrity.auto_submitted) ? "result-integrity integrity-flag" : "result-integrity muted"}>{integrityLabel(a.integrity)}</span><span className="result-date muted">{new Date(a.submitted_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></summary><div className="result-detail">{a.integrity && <p className="small">Сигналы строгого режима: {integrityLabel(a.integrity)}. Это повод присмотреться к работе, а не доказательство списывания.</p>}{(a.result?.per_question_scoring === "unscored" || a.result?.manually_reviewed_by) && <p className="muted small">Итоговая оценка выставлена вручную; баллы по вопросам не выставлены.</p>}{a.result?.per_question?.map((q,i) => <div className="list-item" key={q.id}><b>Вопрос {i+1}</b> · {q.skill_tag || "Тема не указана"} · {questionScoreLabel(a, q)}{a.integrity?.question_seconds?.[q.id] !== undefined && <span className="muted small"> · {a.integrity.question_seconds[q.id]} с на вопрос</span>}<div className="muted small">Ответ: {typeof a.answers[q.id] === "object" ? JSON.stringify(a.answers[q.id]) : String(a.answers[q.id] ?? "Нет ответа")}</div></div>)}{a.result?.requires_manual_review && <div className="row" style={{ marginTop: 16 }}><label className="field">Итоговая оценка (%)<input type="number" min="0" max="100" value={reviewScores[a.id] ?? ""} onChange={e => setReviewScores(current => ({ ...current, [a.id]: e.target.value }))} /></label><button className="btn primary" disabled={busy || reviewScores[a.id] === undefined || reviewScores[a.id] === ""} onClick={() => void saveManualReview(a.id)}>Сохранить проверку</button></div>}</div></details>)}</div><div className="row" style={{ justifyContent: "space-between", marginTop: 16 }}><span className="muted small">Страница {totalPages ? resultsPage + 1 : 0} из {totalPages} · всего {summary.count}</span><div className="row"><button className="btn" disabled={resultsPage === 0} onClick={() => setResultsPage(page => Math.max(0, page - 1))}>Назад</button><button className="btn" disabled={resultsPage + 1 >= totalPages} onClick={() => setResultsPage(page => page + 1)}>Далее</button></div></div></div> : <p className="muted">{resultsError ? "Нет актуальных данных, так как обновление завершилось ошибкой." : "Ученики ещё не отправили ответы."}</p>}</div></div>}
    </>}
  </div>;
}
