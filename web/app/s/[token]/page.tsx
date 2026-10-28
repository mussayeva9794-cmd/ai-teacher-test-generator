"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type SyntheticEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { SubmittedCheck } from "../../illustrations";
import { api } from "@/lib/client";
import { type ClientEventKind } from "@/lib/integrity";
import { browserClient } from "@/lib/supabase";
import { variantLabel } from "@/lib/labels";
import { serverMessage } from "@/lib/i18n/server-message";
import { Brand, BRAND_NAME } from "../../brand";
import { useT } from "../../i18n-provider";
import { LanguageSwitcher } from "../../language-switcher";
import { AnswerInput, type StudentQuestion } from "./answer-input";
import { AnswerReview } from "./answer-review";
import type { ReviewItem } from "@/lib/assessment";
import { clearAllBackups, clearBackup, pruneBackups, readBackup, restoreAnswers, saveBackup } from "@/lib/answer-backup";

type StudentTest = {
  submitted: boolean; title: string; topic: string; variant_name: string; percentage?: number | null;
  variant: { instructions: string; questions: StudentQuestion[] };
  settings: {
    one_question_at_a_time: boolean; reveal_score: boolean;
    strict_mode?: boolean; leave_limit?: number | null; question_seconds?: number; require_fullscreen?: boolean;
  };
  answers: Record<string, unknown>; closes_at: string | null; saved_at: string; expired?: boolean;
  question_count?: number;
  student_label?: string;
  integrity?: { leaves: number; locked: boolean };
  strict_progress?: { current_index: number; question_started_at: string; finished: boolean };
  server_now?: string;
  // The server waits for full screen before starting a new strict attempt.
  awaiting_fullscreen?: boolean;
  review?: ReviewItem[];
};
type IntegrityResponse = { leaves: number; locked: boolean; submitted?: boolean; server_now: string };
type StrictNextResponse = {
  ready?: boolean; finished?: boolean; expired?: boolean; current_index?: number;
  question_started_at?: string; server_now?: string; question?: StudentQuestion;
};

type SaveStatus = "loading" | "saved" | "savedNow" | "saving" | "offline";

export default function StudentPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [test, setTest] = useState<StudentTest | null>(null);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const t = useT();
  const st = t.student;
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [percentage, setPercentage] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [timeExpired, setTimeExpired] = useState(false);
  const [submissionWarning, setSubmissionWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState(false);
  const [leaves, setLeaves] = useState(0);
  const [strictIndex, setStrictIndex] = useState(0);
  const [questionStartedAt, setQuestionStartedAt] = useState<string | null>(null);
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
  const advancingQuestion = useRef(false);
  const lastClipboardEvent = useRef<Record<"copy" | "paste", number>>({ copy: 0, paste: 0 });
  // Full screen only counts once the student has entered it; leaving it
  // after that is a leave. Closing it ourselves after submitting is not.
  const [fullscreenEntered, setFullscreenEntered] = useState(false);
  const fullscreenEnteredRef = useRef(false);
  const closingFullscreen = useRef(false);
  const [secondScreen, setSecondScreen] = useState(false);
  const userId = useRef("");
  const saveDraftRef = useRef<() => Promise<void>>(async () => undefined);
  // The browser refused full screen (kiosk or embedded browsers): let the test go on without it.
  const [fullscreenRefused, setFullscreenRefused] = useState(false);
  const [awaitingFullscreen, setAwaitingFullscreen] = useState<StudentTest | null>(null);

  const strict = Boolean(test?.settings.strict_mode);
  const questionSeconds = strict ? test?.settings.question_seconds || 0 : 0;
  // iPhone Safari cannot put a page in full screen; there the rule is skipped.
  const needFullscreen = strict && Boolean(test?.settings.require_fullscreen) && !fullscreenRefused &&
    typeof document !== "undefined" && document.fullscreenEnabled;

  function applyLoaded(result: StudentTest) {
    if (result.submitted) {
      clearBackup(token, userId.current);
      setPercentage(result.percentage ?? null);
      setReview(Array.isArray(result.review) ? result.review : null);
      setSubmitted(true);
      return;
    }
    // Device clocks on school phones are often minutes off; count the timer on the server clock.
    if (result.server_now) clockOffset.current = Date.parse(result.server_now) - Date.now();
    if (result.settings.strict_mode && result.integrity) {
      setLeaves(result.integrity.leaves);
      setStrictIndex(result.strict_progress?.current_index || 0);
      setQuestionStartedAt(result.strict_progress?.question_started_at || null);
      // The server resumes the exact open question; a reload cannot reset it.
      resumeFinished.current = Boolean(result.strict_progress?.finished);
      if (result.integrity.locked || result.strict_progress?.finished) timeoutSubmissionStarted.current = true;
      if (result.integrity.locked) setLockedSubmission(true);
    }
    // Answers typed while offline survive a reload; the autosave then sends them.
    const resumed = result.settings.strict_mode ? result.answers || {}
      : restoreAnswers(result.answers || {}, readBackup(token, userId.current));
    setTest(result); setAnswers(resumed); setStatus("saved");
    latestAnswers.current = resumed;
    lastSaved.current = JSON.stringify(result.answers || {}); loaded.current = true;
  }

  async function startAfterFullscreen(withoutFullscreen = false) {
    setError("");
    if (!withoutFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        setError(st.fullscreenFailed); setFullscreenRefused(true);
        return;
      }
    }
    fullscreenEnteredRef.current = !withoutFullscreen; setFullscreenEntered(true);
    if (withoutFullscreen) setFullscreenRefused(true);
    setBusy(true);
    try {
      const result = await api<StudentTest>(`/api/share/${token}`);
      setAwaitingFullscreen(null);
      applyLoaded(result);
    } catch (cause) {
      setError(serverMessage(t, cause instanceof Error ? cause.message : ""));
    } finally { setBusy(false); }
  }

  useEffect(() => {
    let active = true;
    browserClient().auth.getUser().then(({ data }) => {
      if (!active) return;
      if (!data.user) { router.replace(`/login?next=${encodeURIComponent(`/s/${token}`)}`); return; }
      setName(String(data.user.user_metadata?.display_name || data.user.email || ""));
      userId.current = data.user.id;
      pruneBackups(data.user.id);
      // Where full screen is possible, ask the server not to start a new
      // full-screen attempt yet; it answers awaiting_fullscreen in that case.
      const query = document.fullscreenEnabled ? "?start=after_fullscreen" : "";
      api<StudentTest>(`/api/share/${token}${query}`).then(result => {
        if (!active) return;
        if (result.awaiting_fullscreen) { setAwaitingFullscreen(result); return; }
        applyLoaded(result);
      }).catch(cause => { if (active) setError(serverMessage(t, cause.message)); });
    });
    return () => { active = false; };
  }, [router, token]);

  useEffect(() => {
    if (!test?.closes_at) return;
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(test.closes_at!) - (Date.now() + clockOffset.current)) / 1000)));
    update(); const timer = setInterval(update, 1000); return () => clearInterval(timer);
  }, [test?.closes_at]);

  function saveLatestDraft() {
    const operation = saveQueue.current.catch(() => undefined).then(async () => {
      const pendingAnswers = latestAnswers.current;
      const pendingSerialized = JSON.stringify(pendingAnswers);
      if (pendingSerialized === lastSaved.current) return;
      const strictQuestion = strict ? test?.variant.questions[0] : null;
      if (strict && !strictQuestion) return;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await api<{ saved_at: string }>(`/api/share/${token}/draft`, {
            method: "PUT",
            body: JSON.stringify(strictQuestion
              ? { question_id: strictQuestion.id, answer: pendingAnswers[strictQuestion.id] }
              : { answers: pendingAnswers }),
          });
          lastSaved.current = pendingSerialized;
          if (JSON.stringify(latestAnswers.current) === pendingSerialized) {
            setStatus("savedNow");
            // The server now holds exactly what the student sees: the copy is no longer needed.
            if (!strict) clearBackup(token, userId.current);
          }
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

  saveDraftRef.current = saveLatestDraft;

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
    setStatus("saving");
    const timer = setTimeout(() => {
      if (saveTimer.current === timer) saveTimer.current = null;
      void saveLatestDraft().catch(() => {
        if (JSON.stringify(latestAnswers.current) !== lastSaved.current) setStatus("offline");
      });
    }, remaining !== null && remaining <= 15 ? 100 : 650);
    saveTimer.current = timer;
    return () => {
      clearTimeout(timer);
      if (saveTimer.current === timer) saveTimer.current = null;
    };
  }, [answers, test, submitted, token]);

  useEffect(() => {
    if (status !== "offline" || submitted) return;
    // Keep trying while offline, and at once when the browser says it is back.
    // Through a ref: the retry must use the current question, not the one shown when the connection dropped.
    const retry = () => { void saveDraftRef.current().catch(() => undefined); };
    window.addEventListener("online", retry);
    const timer = setInterval(retry, 8000);
    return () => { window.removeEventListener("online", retry); clearInterval(timer); };
  }, [status, submitted]);

  async function finish(expired = false, locked = false) {
    if (!test) return;
    setBusy(true); setError("");
    try {
      const draftSaved = await flushPendingDraft();
      // Expired and locked attempts are graded from the server-saved draft only.
      const result = await api<{ percentage: number | null; expired?: boolean; locked?: boolean; review?: ReviewItem[] }>(`/api/share/${token}/submit`, {
        method: "POST", body: JSON.stringify(expired || locked || strict ? {} : { answers }),
      });
      const wasLocked = Boolean(locked || result.locked);
      const wasExpired = Boolean(expired || result.expired) && !wasLocked;
      if (document.fullscreenElement) {
        closingFullscreen.current = true;
        void document.exitFullscreen().catch(() => undefined);
      }
      setReview(Array.isArray(result.review) ? result.review : null);
      clearBackup(token, userId.current);
      setPercentage(result.percentage); setTimeExpired(wasExpired); setLockedSubmission(wasLocked); setSubmissionWarning(wasExpired && !draftSaved); setSubmitted(true); setConfirming(false);
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", st.submitFailed)); }
    finally { setBusy(false); }
  }

  async function signOutForNextStudent() {
    setBusy(true); setError("");
    try {
      clearAllBackups();
      const { error: signOutError } = await browserClient().auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      router.replace(`/login?next=${encodeURIComponent(`/s/${token}`)}`);
    } catch {
      setError(st.signOutFailed);
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
    if (lockedSubmission) {
      void finish(false, true);
    } else if (resumeFinished.current) {
      void finish();
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
      if (needFullscreen && !document.fullscreenElement) return;
      awayRef.current = false; setAway(false);
      void sendEvent("return");
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") leave(); else back(); };
    const onFullscreen = () => {
      if (!needFullscreen || closingFullscreen.current) return;
      if (document.fullscreenElement) {
        fullscreenEnteredRef.current = true; setFullscreenEntered(true);
        back();
      } else if (fullscreenEnteredRef.current) leave();
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    // Full screen may have been left while the test was still loading.
    if (needFullscreen && fullscreenEnteredRef.current && !document.fullscreenElement) leave();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
    };
  }, [strict, test, submitted, needFullscreen]);

  useEffect(() => {
    if (!strict || submitted) return;
    // Chrome and Edge report a second monitor; other browsers leave this undefined.
    const screenInfo = window.screen as Screen & Partial<EventTarget> & { isExtended?: boolean };
    const update = () => setSecondScreen(screenInfo.isExtended === true);
    update();
    screenInfo.addEventListener?.("change", update);
    return () => screenInfo.removeEventListener?.("change", update);
  }, [strict, submitted]);

  function enterFullscreen() {
    document.documentElement.requestFullscreen().catch(() => {
      setError(st.fullscreenFailed); setFullscreenRefused(true);
      // Without full screen the student returns as from any other leave.
      if (awayRef.current && document.visibilityState === "visible") { awayRef.current = false; setAway(false); void sendEvent("return"); }
    });
  }

  const questions = test?.variant.questions || [];
  const question = strict ? questions[0] : questions[index];
  const questionCount = strict ? test?.question_count || 0 : questions.length;

  async function advanceStrictQuestion(allowExpiredUnsavedAnswer = false) {
    if (!strict || advancingQuestion.current || !test || submitted) return;
    advancingQuestion.current = true;
    try {
      if (!await flushPendingDraft() && !allowExpiredUnsavedAnswer) {
        setError(st.lastAnswerFailed);
        return;
      }
      const result = await api<StrictNextResponse>(`/api/share/${token}/next`, { method: "POST", body: "{}" });
      if (result.expired) { void finish(true); return; }
      // Reaching the end because the last question's time ran out is a timeout, not a manual submit.
      if (result.finished) { void finish(allowExpiredUnsavedAnswer); return; }
      if (result.ready && result.question && typeof result.current_index === "number" && Number.isInteger(result.current_index) && typeof result.question_started_at === "string") {
        if (result.server_now) clockOffset.current = Date.parse(result.server_now) - Date.now();
        setStrictIndex(result.current_index);
        setQuestionStartedAt(result.question_started_at);
        setTest(current => current ? {
          ...current,
          variant: { ...current.variant, questions: [result.question!] },
          strict_progress: { current_index: result.current_index!, question_started_at: result.question_started_at!, finished: false },
        } : current);
        setNow(Date.now());
      }
    } catch (cause) {
      setError(serverMessage(t, cause instanceof Error ? cause.message : "", st.advanceFailed));
    } finally {
      advancingQuestion.current = false;
    }
  }

  useEffect(() => {
    if (questionSeconds <= 0 || submitted) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [questionSeconds, submitted]);

  const questionStart = strict ? questionStartedAt || undefined : undefined;
  const questionRemaining = questionSeconds > 0 && questionStart
    ? Math.max(0, Math.ceil((Date.parse(questionStart) + questionSeconds * 1000 - (now + clockOffset.current)) / 1000))
    : null;

  useEffect(() => {
    if (questionRemaining !== 0 || submitted || busy) return;
    // At the hard per-question deadline, preserve the last successfully
    // saved answer and keep the server-side schedule moving. A late retry
    // must not trap the student forever on an already closed question.
    if (strict) { void advanceStrictQuestion(true); return; }
    if (index < questions.length - 1) { setIndex(index + 1); return; }
    if (!timeoutSubmissionStarted.current) {
      timeoutSubmissionStarted.current = true;
      void finish(true);
    }
  }, [questionRemaining, index, submitted, strict]);

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
      if (!strict && userId.current) saveBackup(token, userId.current, next);
      return next;
    });
  }
  const complete = strict
    ? Object.values(answers).filter(answer => answer !== undefined && answer !== "").length
    : questions.filter(q => answers[q.id] !== undefined && answers[q.id] !== "").length;
  const questionClosed = questionRemaining === 0;
  const watermark = test?.student_label || name || st.defaultName;
  const displayName = name || st.defaultName;
  const statusText = { loading: st.statusLoading, saved: st.statusSaved, savedNow: st.statusSavedNow, saving: st.statusSaving, offline: strict ? st.statusOffline : st.statusOfflineKept }[status];
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <div className="student-shell"><header className="topbar"><Brand /><LanguageSwitcher /><nav className="navlinks"><button className="btn ghost" disabled={busy} onClick={() => void signOutForNextStudent()}>{st.switchAccount}</button><span className="watermark">{displayName}</span></nav></header>
    {submitted ? <main className="panel student-card" style={{ marginTop: "8vh", textAlign: "center" }}><div className="draw-in"><SubmittedCheck /></div><h1 style={{ fontSize: "2.3rem" }}>{lockedSubmission ? st.submittedLocked : timeExpired ? st.submittedTimeUp : st.submitted}</h1><p className="muted">{lockedSubmission ? st.submittedLockedText : timeExpired ? st.submittedTimeUpText : st.submittedText}</p>{submissionWarning && <div className="notice" role="status">{st.lastAnswerWarning}</div>}{percentage !== null && <p className="metric">{percentage}%</p>}<button className="btn primary" disabled={busy} onClick={() => void signOutForNextStudent()}>{st.handOver}</button><p className="small muted">{st.sharedDevice}</p>{review?.length ? <AnswerReview items={review} /> : null}</main> : awaitingFullscreen && !test ? <main className="stack"><section className="page-head"><div className="eyebrow">{variantLabel(awaitingFullscreen.variant_name, t)} / {awaitingFullscreen.topic}</div><h1 style={{ fontSize: "clamp(1.8rem,5vw,3rem)" }}>{awaitingFullscreen.title}</h1></section><div className="panel student-card stack fullscreen-gate"><h2>{st.fullscreenTitle}</h2><p className="muted">{st.fullscreenText}</p>{error && <p className="error">{error}</p>}<button className="btn primary" disabled={busy} onClick={() => void startAfterFullscreen()}>{st.fullscreenStart}</button>{fullscreenRefused && <button className="btn" disabled={busy} onClick={() => void startAfterFullscreen(true)}>{st.fullscreenSkip}</button>}</div></main> : error && !test ? <main className="panel student-card error">{error}</main> : !test ? <div className="panel">{st.loadingTest}</div> : <main className={strict ? "stack strict-test" : "stack"} onCopy={strict ? e => blockClipboard(e, "copy") : undefined} onCut={strict ? e => blockClipboard(e, "copy") : undefined} onPaste={strict ? e => blockClipboard(e, "paste") : undefined} onContextMenu={strict ? preventDefault : undefined} onDragStart={strict ? preventDefault : undefined} onDrop={strict ? preventDefault : undefined}><section className="page-head"><div className="eyebrow">{variantLabel(test.variant_name, t)} / {test.topic}</div><h1 style={{ fontSize: "clamp(1.8rem,5vw,3rem)" }}>{test.title}</h1><p className="muted">{test.variant.instructions}</p></section>
      {strict && <div className="notice strict-banner" role="note"><b>{st.strictTitle}</b>{st.strictLead}{test.settings.leave_limit !== null && test.settings.leave_limit !== undefined && <>{st.strictLeavesBefore}<b>{Math.min(leaves, test.settings.leave_limit + 1)}</b>{st.strictLeavesAfter(test.settings.leave_limit)}</>}{st.strictCopy(questionSeconds)}</div>}
      {strict && secondScreen && <div className="notice" role="alert">{st.secondScreen}</div>}
      <div className="row small muted"><span>{st.progress(complete, questionCount)} · {statusText}</span>{remaining !== null && <b style={{ color: remaining < 60 ? "var(--wine)" : "var(--ink)" }}>{st.remaining(clock(remaining))}</b>}</div>{remaining !== null && remaining > 0 && remaining <= 15 && <div className="notice" role="status">{st.endingSoon}</div>}<div className="progress" role="progressbar" aria-valuenow={complete} aria-valuemax={questionCount}><span style={{ width: `${questionCount ? complete / questionCount * 100 : 0}%` }} /></div>
      {test.expired || remaining === 0 ? <div className="notice">{st.timeUpSending}{error && <><p className="error">{error}</p><button className="btn" disabled={busy} onClick={() => void finish(true)}>{st.retrySubmit}</button></>}</div> : strict && (lockedSubmission || timeoutSubmissionStarted.current) ? <div className="notice" role="status">{st.sending}{error && <><p className="error">{error}</p><button className="btn" disabled={busy} onClick={() => void finish(!lockedSubmission, lockedSubmission)}>{st.retrySubmit}</button></>}</div> : needFullscreen && !fullscreenEntered ? <div className="panel student-card stack fullscreen-gate"><h2>{st.fullscreenTitle}</h2><p className="muted">{st.fullscreenText}</p><button className="btn primary" onClick={enterFullscreen}>{st.fullscreenStart}</button></div> : strict && away ? <div className="panel student-card stack" role="alert"><h2>{st.hiddenTitle}</h2><p className="muted">{st.hiddenText}</p>{needFullscreen && <button className="btn primary" onClick={enterFullscreen}>{st.fullscreenReturn}</button>}</div> : <>{(test.settings.one_question_at_a_time ? [question] : questions).filter(Boolean).map((q, offset) => <section className={strict ? "panel student-card stack strict-card" : "panel student-card stack"} key={q.id}>{strict && <div className="strict-watermark" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <span key={i}>{watermark}</span>)}</div>}<div className="row"><div className="eyebrow">{st.questionOf(strict ? strictIndex + 1 : test.settings.one_question_at_a_time ? index + 1 : offset + 1, questionCount)}</div>{questionRemaining !== null && <b className="question-timer" style={{ color: questionRemaining <= 10 ? "var(--wine)" : "var(--ink)" }}>{st.perQuestion(clock(questionRemaining))}</b>}</div><h2 className="question-title">{q.question}</h2><fieldset disabled={questionClosed} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><AnswerInput question={q} answer={answers[q.id]} number={strict ? strictIndex + 1 : test.settings.one_question_at_a_time ? index + 1 : offset + 1} onAnswer={answer => setAnswer(q, answer)} /></fieldset></section>)}
      {test.settings.one_question_at_a_time && <div className="row">{strict && questionSeconds > 0 ? <span /> : strict ? <span /> : <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>{st.back}</button>}{strict ? strictIndex < questionCount - 1 ? <button className="btn primary" onClick={() => void advanceStrictQuestion()}>{st.next}</button> : <button className="btn primary" onClick={() => setConfirming(true)}>{st.review}</button> : index < questions.length - 1 ? <button className="btn primary" onClick={() => setIndex(index + 1)}>{st.next}</button> : <button className="btn primary" onClick={() => setConfirming(true)}>{st.review}</button>}</div>}{!test.settings.one_question_at_a_time && <button className="btn primary" onClick={() => setConfirming(true)}>{st.review}</button>}</>}
      {confirming && <div className="panel stack" role="dialog" aria-modal="true" aria-label={st.confirmLabel}><h2>{st.confirmTitle}</h2><p className="muted">{st.confirmText(complete, questionCount)}</p>{error && <div className="error">{error}</div>}<div className="row"><button className="btn" onClick={() => setConfirming(false)}>{st.backToAnswers}</button><button className="btn primary" disabled={busy} onClick={() => void finish()}>{busy ? st.submitting : st.confirmSubmit}</button></div></div>}
      {!confirming && error && <div className="error">{error}</div>}
    </main>}
    <footer className="footer watermark">{BRAND_NAME} · {displayName}</footer>
  </div>;
}
