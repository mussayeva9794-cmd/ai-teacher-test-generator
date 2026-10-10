"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client";
import { browserClient } from "@/lib/supabase";
import type { Question } from "@/lib/types";

type StudentQuestion = Omit<Question, "correct_answer" | "explanation">;
type StudentTest = {
  submitted: boolean; title: string; topic: string; variant_name: string; percentage?: number | null;
  variant: { instructions: string; questions: StudentQuestion[] };
  settings: { one_question_at_a_time: boolean; reveal_score: boolean };
  answers: Record<string, unknown>; closes_at: string | null; saved_at: string; expired?: boolean;
};

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
  const loaded = useRef(false);
  const lastSaved = useRef("");
  const latestAnswers = useRef<Record<string, unknown>>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutSubmissionStarted = useRef(false);

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

  async function finish(expired = false) {
    if (!test) return;
    setBusy(true); setError("");
    try {
      const draftSaved = await flushPendingDraft();
      const result = await api<{ percentage: number | null; expired?: boolean }>(`/api/share/${token}/submit`, {
        method: "POST", body: JSON.stringify(expired ? {} : { answers }),
      });
      const wasExpired = Boolean(expired || result.expired);
      setPercentage(result.percentage); setTimeExpired(wasExpired); setSubmissionWarning(wasExpired && !draftSaved); setSubmitted(true); setConfirming(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отправить ответы."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!test || submitted || timeoutSubmissionStarted.current || (!test.expired && remaining !== 0)) return;
    timeoutSubmissionStarted.current = true;
    void finish(true);
  }, [test, remaining, submitted]);

  function setAnswer(question: StudentQuestion, answer: unknown) {
    setAnswers(current => {
      const next = { ...current, [question.id]: answer };
      latestAnswers.current = next;
      return next;
    });
  }
  const questions = test?.variant.questions || [];
  const question = questions[index];
  const complete = questions.filter(q => answers[q.id] !== undefined && answers[q.id] !== "").length;
  return <div className="student-shell"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link><nav className="navlinks"><Link className="btn ghost" href="/account">Ключи доступа</Link><span className="watermark">{name}</span></nav></header>
    {submitted ? <main className="panel student-card" style={{ marginTop: "8vh", textAlign: "center" }}><div className="metric" style={{ color: "var(--good)" }}>✓</div><h1 style={{ fontSize: "2.3rem" }}>{timeExpired ? "Время вышло, работа отправлена" : "Работа отправлена"}</h1><p className="muted">{timeExpired ? "Учитель получил последний сохранённый черновик. Повторная попытка с этого аккаунта недоступна." : "Ваши ответы получил учитель. Повторная попытка с этого аккаунта недоступна."}</p>{submissionWarning && <div className="notice" role="status">Не удалось подтвердить сохранение самого последнего ответа до окончания времени. Учителю отправлен последний черновик, который успел сохраниться.</div>}{percentage !== null && <p className="metric">{percentage}%</p>}</main> : error && !test ? <main className="panel student-card error">{error}</main> : !test ? <div className="panel">Загружаем тест...</div> : <main className="stack"><section className="page-head"><div className="eyebrow">{test.variant_name} / {test.topic}</div><h1 style={{ fontSize: "clamp(1.8rem,5vw,3rem)" }}>{test.title}</h1><p className="muted">{test.variant.instructions}</p></section>
      <div className="row small muted"><span>{complete} из {questions.length} ответов · {status}</span>{remaining !== null && <b style={{ color: remaining < 60 ? "var(--wine)" : "var(--ink)" }}>Осталось {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</b>}</div>{remaining !== null && remaining > 0 && remaining <= 15 && <div className="notice" role="status">Время заканчивается. Дождитесь надписи «Сохранено» или отправьте работу сейчас: ответ, введённый в последние секунды при медленной сети, может не успеть сохраниться.</div>}<div className="progress" role="progressbar" aria-valuenow={complete} aria-valuemax={questions.length}><span style={{ width: `${questions.length ? complete / questions.length * 100 : 0}%` }} /></div>
      {test.expired || remaining === 0 ? <div className="notice">Время вышло. Отправляем последний ответ, сохранённый на сервере…{error && <><p className="error">{error}</p><button className="btn" disabled={busy} onClick={() => void finish(true)}>Повторить отправку</button></>}</div> : <>{(test.settings.one_question_at_a_time ? [question] : questions).filter(Boolean).map((q, offset) => <section className="panel student-card stack" key={q.id}><div className="eyebrow">Вопрос {test.settings.one_question_at_a_time ? index + 1 : offset + 1} из {questions.length}</div><h2 className="question-title">{q.question}</h2>{q.type === "multiple_choice" || q.type === "true_false" ? <div className="stack" role="group" aria-label={`Ответ на вопрос ${index + 1}`}>{q.options?.map((option,i) => <label className="option" key={i}><input type="radio" name={`q-${q.id}`} checked={answers[q.id] === option} onChange={() => setAnswer(q, option)} />{option}</label>)}</div> : q.type === "matching" ? <div className="stack">{q.pairs?.map((pair,i) => <label className="field" key={i}>{pair.left}<input value={String((answers[q.id] as Record<string,string> | undefined)?.[pair.left] || "")} onChange={e => setAnswer(q, { ...(answers[q.id] as object || {}), [pair.left]: e.target.value })} placeholder="Введите соответствие" /></label>)}</div> : <label className="field">Ваш ответ<textarea value={String(answers[q.id] || "")} onChange={e => setAnswer(q, e.target.value)} placeholder="Введите ответ" /></label>}</section>)}
      {test.settings.one_question_at_a_time && <div className="row"><button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Назад</button>{index < questions.length - 1 ? <button className="btn primary" onClick={() => setIndex(index + 1)}>Далее →</button> : <button className="btn primary" onClick={() => setConfirming(true)}>Проверить и завершить</button>}</div>}{!test.settings.one_question_at_a_time && <button className="btn primary" onClick={() => setConfirming(true)}>Проверить и завершить</button>}</>}
      {confirming && <div className="panel stack" role="dialog" aria-modal="true" aria-label="Подтвердите отправку"><h2>Завершить тест?</h2><p className="muted">Отвечено: {complete} из {questions.length}. После отправки изменить ответы или пройти тест повторно нельзя.</p>{error && <div className="error">{error}</div>}<div className="row"><button className="btn" onClick={() => setConfirming(false)}>Вернуться к ответам</button><button className="btn primary" disabled={busy} onClick={() => void finish()}>{busy ? "Отправляем..." : "Да, отправить"}</button></div></div>}
      {!confirming && error && <div className="error">{error}</div>}
    </main>}
    <footer className="footer watermark">AI Teacher · {name}</footer>
  </div>;
}
