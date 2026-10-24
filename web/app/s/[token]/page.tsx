"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type SyntheticEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { SubmittedCheck } from "../../illustrations";
import { api } from "@/lib/client";
import { resumeQuestionIndex, type ClientEventKind } from "@/lib/integrity";
import { browserClient } from "@/lib/supabase";
import { variantLabel } from "@/lib/labels";
import type { Question } from "@/lib/types";

type StudentQuestion = Omit<Question, "correct_answer" | "explanation">;
type StudentTest = {
  submitted: boolean; title: string; topic: string; variant_name: string; percentage?: number | null;
  variant: { instructions: string; questions: StudentQuestion[] };
  settings: {
    one_question_at_a_time: boolean; reveal_score: boolean;
    strict_mode?: boolean; leave_limit?: number | null; question_seconds?: number;
  };
  answers: Record<string, unknown>; closes_at: string | null; saved_at: string; expired?: boolean;
  student_label?: string;
  integrity?: { leaves: number; locked: boolean; question_started: Record<string, string> };
  server_now?: string;
};
type IntegrityResponse = { leaves: number; locked: boolean; submitted?: boolean; question_started: Record<string, string>; server_now: string };

export default function StudentPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [test, setTest] = useState<StudentTest | null>(null);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Загрузка...");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [percentage, setPercentage] = useState<number | null>(null);
  const [timeExpired, setTimeExpired] = useState(false);
  const [submissionWarning, setSubmissionWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState(false);
  const [leaves, setLeaves] = useState(0);
  const [questionStarted, setQuestionStarted] = useState<Record<string, string>>({});
  const [lockedSubmission, setLockedSubmission] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  const lastSaved = useRef("");
  const latestAnswers = useRef<Record<string, unknown>>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutSubmissionStarted = useRef(false);
  const awayRef = useRef(false);
  const clockOffset = useRef(0);
  const resumeFinished = useRef(false);
  const lastClipboardEvent = useRef<Record<"copy" | "paste", number>>({ copy: 0, paste: 0 });

  const strict = Boolean(test?.settings.strict_mode);
  const questionSeconds = strict ? test?.settings.question_seconds || 0 : 0;

  useEffect(() => {
    let active = true;
    browserClient().auth.getUser().then(({ data }) => {
      if (!active) return;
      if (!data.user) { router.replace(`/login?next=${encodeURIComponent(`/s/${token}`)}`); return; }
      setName(String(data.user.user_metadata?.display_name || data.user.email || "Ученик"));
      api<StudentTest>(`/api/share/${token}`).then(result => {
        if (!active) return;
        if (result.submitted) {
          setPercentage(result.percentage ?? null);
          setSubmitted(true);
          return;
        }
        if (result.settings.strict_mode && result.integrity) {
          if (result.server_now) clockOffset.current = Date.parse(result.server_now) - Date.now();
          setLeaves(result.integrity.leaves);
          setQuestionStarted(result.integrity.question_started);
          // Resume where the student was: a reload (phones often reload a
          // backgrounded tab) cannot reopen an earlier question or restart a timer.
          const resume = resumeQuestionIndex(result.variant.questions.map(q => q.id), result.integrity.question_started,
            result.settings.question_seconds || 0, Date.now() + clockOffset.current);
          setIndex(resume.index);
          resumeFinished.current = resume.finished;
          if (result.integrity.locked || resume.finished) timeoutSubmissionStarted.current = true;
          if (result.integrity.locked) setLockedSubmission(true);
        }
        setTest(result); setAnswers(result.answers || {}); setStatus("Сохранено");
        latestAnswers.current = result.answers || {};
        lastSaved.current = JSON.stringify(result.answers || {}); loaded.current = true;
      }).catch(cause => { if (active) setError(cause.message); });
    });
    return () => { active = false; };
  }, [router, token]);

  useEffect(() => {
    if (!test?.closes_at) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(test.closes_at!) - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [test?.closes_at]);

  function saveLatestDraft() {
    const operation = saveQueue.current.catch(() => undefined).then(async () => {
      const pendingAnswers = latestAnswers.current;
      const pendingSerialized = JSON.stringify(pendingAnswers);
      if (pendingSerialized === lastSaved.current) return;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await api<{ saved_at: string }>(`/api/share/${token}/draft`, { method: "PUT", body: JSON.stringify({ answers: pendingAnswers }) });
          lastSaved.current = pendingSerialized;
          if (JSON.stringify(latestAnswers.current) === pendingSerialized) setStatus("Сохранено только что");
          return;
        } catch (cause) {
          if (attempt === 1) throw cause;
          await new Promise(resolve => setTimeout(resolve, 400));
        }
      }
    });
    saveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function flushPendingDraft() {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      await saveLatestDraft();
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    if (!loaded.current || !test || submitted) return;
    const serialized = JSON.stringify(answers);
    if (serialized === lastSaved.current) return;
    setStatus("Сохраняем...");
    const timer = setTimeout(() => {
      if (saveTimer.current === timer) saveTimer.current = null;
      void saveLatestDraft().catch(() => {
        if (JSON.stringify(latestAnswers.current) !== lastSaved.current) setStatus("Нет связи. Последние ответы не сохранены; проверьте интернет.");
      });
    }, remaining !== null && remaining <= 15 ? 100 : 650);
    saveTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [answers, test, submitted, token]);

  async function finish(expired = false, locked = false) {
    if (!test) return;
    setBusy(true); setError("");
    try {
      const draftSaved = await flushPendingDraft();
      // Expired and locked attempts are graded from the server-saved draft only.
      const result = await api<{ percentage: number | null; expired?: boolean; locked?: boolean }>(`/api/share/${token}/submit`, {
        method: "POST", body: JSON.stringify(expired || locked ? {} : { answers }),
      });
      const wasLocked = Boolean(locked || result.locked);
      const wasExpired = Boolean(expired || result.expired) && !wasLocked;
      setPercentage(result.percentage); setTimeExpired(wasExpired); setLockedSubmission(wasLocked); setSubmissionWarning(wasExpired && !draftSaved); setSubmitted(true); setConfirming(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отправить ответы."); }
    finally { setBusy(false); }
  }

  async function signOutForNextStudent() {
    setBusy(true); setError("");
    try {
      const { error: signOutError } = await browserClient().auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      router.replace(`/login?next=${encodeURIComponent(`/s/${token}`)}`);
    } catch {
      setError("Не удалось выйти. Закройте вкладку и сообщите учителю.");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!test || submitted || timeoutSubmissionStarted.current || (!test.expired && remaining !== 0)) return;
    timeoutSubmissionStarted.current = true;
    void finish(true);
  }, [test, remaining, submitted]);

  // Locked or fully timed-out strict attempts detected on load submit at once.
  useEffect(() => {
    if (!test || submitted || !strict || !timeoutSubmissionStarted.current || busy) return;
    if (lockedSubmission || resumeFinished.current) {
      void finish(!lockedSubmission, lockedSubmission);
    }
  }, [test]);

  async function sendEvent(kind: ClientEventKind, questionId: string | null = null) {
    const post = () => api<IntegrityResponse>(`/api/share/${token}/events`, {
      method: "POST", body: JSON.stringify({ kind, question_id: questionId }), keepalive: true,
    });
    try {
      const result = await post().catch(async () => { await new Promise(resolve => setTimeout(resolve, 800)); return post(); });
      clockOffset.current = Date.parse(result.server_now) - Date.now();
      setLeaves(result.leaves);
      setQuestionStarted(result.question_started);
      if (result.locked && !timeoutSubmissionStarted.current) {
        timeoutSubmissionStarted.current = true;
        setLockedSubmission(true);
        void finish(false, true);
      }
    } catch {
      // Signals are best-effort; the server still enforces locks on save and submit.
    }
  }

  useEffect(() => {
    if (!strict || !test || submitted) return;
    const leave = () => {
      // Once the attempt is being submitted, further leaves change nothing.
      if (awayRef.current || timeoutSubmissionStarted.current) return;
      awayRef.current = true; setAway(true);
      // Count it on screen at once; the server's number replaces this on reply.
      setLeaves(current => current + 1);
      void sendEvent("leave");
    };
    const back = () => {
      if (!awayRef.current || document.visibilityState === "hidden" || !document.hasFocus()) return;
      awayRef.current = false; setAway(false);
      void sendEvent("return");
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") leave(); else back(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [strict, test, submitted]);

  const questions = test?.variant.questions || [];
  const question = questions[index];

  useEffect(() => {
    if (!strict || !test || submitted || !question || questionStarted[question.id]) return;
    setQuestionStarted(current => ({ ...current, [question.id]: new Date(Date.now() + clockOffset.current).toISOString() }));
    void sendEvent("question_shown", question.id);
  }, [strict, test, submitted, question?.id]);

  useEffect(() => {
    if (questionSeconds <= 0 || submitted) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [questionSeconds, submitted]);

  const questionStart = question ? questionStarted[question.id] : undefined;
  const questionRemaining = questionSeconds > 0 && questionStart
    ? Math.max(0, Math.ceil((Date.parse(questionStart) + questionSeconds * 1000 - (now + clockOffset.current)) / 1000))
    : null;

  useEffect(() => {
    if (questionRemaining !== 0 || submitted || busy) return;
    if (index < questions.length - 1) { setIndex(index + 1); return; }
    if (!timeoutSubmissionStarted.current) {
      timeoutSubmissionStarted.current = true;
      void finish(true);
    }
  }, [questionRemaining, index, submitted]);

  function blockClipboard(event: ClipboardEvent, kind: "copy" | "paste") {
    event.preventDefault();
    // One logged event per burst; holding Ctrl+V should not flood the journal.
    if (Date.now() - lastClipboardEvent.current[kind] < 3000) return;
    lastClipboardEvent.current[kind] = Date.now();
    void sendEvent(kind);
  }
  const preventDefault = (event: SyntheticEvent) => event.preventDefault();

  function setAnswer(question: StudentQuestion, answer: unknown) {
    setAnswers(current => {
      const next = { ...current, [question.id]: answer };
      latestAnswers.current = next;
      return next;
    });
  }
  const complete = questions.filter(q => answers[q.id] !== undefined && answers[q.id] !== "").length;
  const questionClosed = questionRemaining === 0;
  const watermark = test?.student_label || name;
  return <div className="student-shell"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link><nav className="navlinks"><button className="btn ghost" disabled={busy} onClick={() => void signOutForNextStudent()}>Выйти / сменить аккаунт</button><span className="watermark">{name}</span></nav></header>
    {submitted ? <main className="panel student-card" style={{ marginTop: "8vh", textAlign: "center" }}><div className="draw-in"><SubmittedCheck /></div><h1 style={{ fontSize: "2.3rem" }}>{lockedSubmission ? "Работа отправлена автоматически" : timeExpired ? "Время вышло, работа отправлена" : "Работа отправлена"}</h1><p className="muted">{lockedSubmission ? "Вы покидали страницу теста больше, чем разрешил учитель. Учитель получил ответы, сохранённые до этого момента, и увидит отметку об автоматической отправке." : timeExpired ? "Учитель получил последний сохранённый черновик. Повторная попытка с этого аккаунта недоступна." : "Ваши ответы получил учитель. Повторная попытка с этого аккаунта недоступна."}</p>{submissionWarning && <div className="notice" role="status">Не удалось подтвердить сохранение самого последнего ответа до окончания времени. Учителю отправлен последний черновик, который успел сохраниться.</div>}{percentage !== null && <p className="metric">{percentage}%</p>}<button className="btn primary" disabled={busy} onClick={() => void signOutForNextStudent()}>Выйти и передать устройство следующему ученику</button><p className="small muted">На общем компьютере обязательно выйдите из аккаунта перед следующим учеником.</p></main> : error && !test ? <main className="panel student-card error">{error}</main> : !test ? <div className="panel">Загружаем тест...</div> : <main className={strict ? "stack strict-test" : "stack"} onCopy={strict ? e => blockClipboard(e, "copy") : undefined} onCut={strict ? e => blockClipboard(e, "copy") : undefined} onPaste={strict ? e => blockClipboard(e, "paste") : undefined} onContextMenu={strict ? preventDefault : undefined} onDragStart={strict ? preventDefault : undefined} onDrop={strict ? preventDefault : undefined}><section className="page-head"><div className="eyebrow">{variantLabel(test.variant_name)} / {test.topic}</div><h1 style={{ fontSize: "clamp(1.8rem,5vw,3rem)" }}>{test.title}</h1><p className="muted">{test.variant.instructions}</p></section>
      {strict && <div className="notice strict-banner" role="note"><b>Строгий режим.</b> Не уходите со страницы теста: вопрос скрывается, а учитель видит каждый уход.{test.settings.leave_limit !== null && test.settings.leave_limit !== undefined && <> Уходов: <b>{Math.min(leaves, test.settings.leave_limit + 1)}</b> из {test.settings.leave_limit} разрешённых — после этого работа отправится автоматически.</>} Копирование и вставка отключены{questionSeconds > 0 ? `, на каждый вопрос ${questionSeconds} с, вернуться к прошлым вопросам нельзя` : ""}.</div>}
      <div className="row small muted"><span>{complete} из {questions.length} ответов · {status}</span>{remaining !== null && <b style={{ color: remaining < 60 ? "var(--wine)" : "var(--ink)" }}>Осталось {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</b>}</div>{remaining !== null && remaining > 0 && remaining <= 15 && <div className="notice" role="status">Время заканчивается. Дождитесь надписи «Сохранено» или отправьте работу сейчас: ответ, введённый в последние секунды при медленной сети, может не успеть сохраниться.</div>}<div className="progress" role="progressbar" aria-valuenow={complete} aria-valuemax={questions.length}><span style={{ width: `${questions.length ? complete / questions.length * 100 : 0}%` }} /></div>
      {test.expired || remaining === 0 ? <div className="notice">Время вышло. Отправляем последний ответ, сохранённый на сервере…{error && <><p className="error">{error}</p><button className="btn" disabled={busy} onClick={() => void finish(true)}>Повторить отправку</button></>}</div> : strict && (lockedSubmission || timeoutSubmissionStarted.current) ? <div className="notice" role="status">Отправляем работу…{error && <><p className="error">{error}</p><button className="btn" disabled={busy} onClick={() => void finish(!lockedSubmission, lockedSubmission)}>Повторить отправку</button></>}</div> : strict && away ? <div className="panel student-card stack" role="alert"><h2>Тест скрыт</h2><p className="muted">Вы ушли со страницы теста. Вернитесь, чтобы продолжить — учитель увидит этот уход.</p></div> : <>{(test.settings.one_question_at_a_time ? [question] : questions).filter(Boolean).map((q, offset) => <section className={strict ? "panel student-card stack strict-card" : "panel student-card stack"} key={q.id}>{strict && <div className="strict-watermark" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <span key={i}>{watermark}</span>)}</div>}<div className="row"><div className="eyebrow">Вопрос {test.settings.one_question_at_a_time ? index + 1 : offset + 1} из {questions.length}</div>{questionRemaining !== null && <b className="question-timer" style={{ color: questionRemaining <= 10 ? "var(--wine)" : "var(--ink)" }}>На вопрос: {Math.floor(questionRemaining / 60)}:{String(questionRemaining % 60).padStart(2, "0")}</b>}</div><h2 className="question-title">{q.question}</h2><fieldset disabled={questionClosed} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{q.type === "multiple_choice" || q.type === "true_false" ? <div className="stack" role="group" aria-label={`Ответ на вопрос ${index + 1}`}>{q.options?.map((option,i) => <label className="option" key={i}><input type="radio" name={`q-${q.id}`} checked={answers[q.id] === option} onChange={() => setAnswer(q, option)} />{option}</label>)}</div> : q.type === "matching" ? <div className="stack">{q.pairs?.map((pair,i) => <label className="field" key={i}>{pair.left}<input value={String((answers[q.id] as Record<string,string> | undefined)?.[pair.left] || "")} onChange={e => setAnswer(q, { ...(answers[q.id] as object || {}), [pair.left]: e.target.value })} placeholder="Введите соответствие" /></label>)}</div> : <label className="field">Ваш ответ<textarea value={String(answers[q.id] || "")} onChange={e => setAnswer(q, e.target.value)} placeholder="Введите ответ" /></label>}</fieldset></section>)}
      {test.settings.one_question_at_a_time && <div className="row">{strict && questionSeconds > 0 ? <span /> : <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Назад</button>}{index < questions.length - 1 ? <button className="btn primary" onClick={() => setIndex(index + 1)}>Далее →</button> : <button className="btn primary" onClick={() => setConfirming(true)}>Проверить и завершить</button>}</div>}{!test.settings.one_question_at_a_time && <button className="btn primary" onClick={() => setConfirming(true)}>Проверить и завершить</button>}</>}
      {confirming && <div className="panel stack" role="dialog" aria-modal="true" aria-label="Подтвердите отправку"><h2>Завершить тест?</h2><p className="muted">Отвечено: {complete} из {questions.length}. После отправки изменить ответы или пройти тест повторно нельзя.</p>{error && <div className="error">{error}</div>}<div className="row"><button className="btn" onClick={() => setConfirming(false)}>Вернуться к ответам</button><button className="btn primary" disabled={busy} onClick={() => void finish()}>{busy ? "Отправляем..." : "Да, отправить"}</button></div></div>}
      {!confirming && error && <div className="error">{error}</div>}
    </main>}
    <footer className="footer watermark">AI Teacher · {name}</footer>
  </div>;
}
