"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export default function CreatePage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [language, setLanguage] = useState("russian");
  const [gradeLevel, setGradeLevel] = useState("");
  const [type, setType] = useState("multiple_choice");
  const [objective, setObjective] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function generate(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const { id } = await api<{ id: string }>("/api/generate", { method: "POST", body: JSON.stringify({ topic, count, language, gradeLevel, type, objective, sourceText }) }); router.push(`/tests/${id}`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать тест."); setBusy(false); }
  }
  return <div className="wrap"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link><Link className="btn ghost" href="/dashboard">← Мои тесты</Link></header>
    <section className="page-head"><div className="eyebrow">Шаг 01 / Создать</div><h1>Новый тест</h1><p className="muted">Начните с темы. Остальные параметры можно раскрыть только при необходимости.</p></section>
    <form onSubmit={generate} className="grid cols-2" style={{ alignItems: "start" }}><div className="panel stack"><label className="field">Тема теста<input required autoFocus placeholder="Например: Радиоактивный распад" value={topic} onChange={e => setTopic(e.target.value)} maxLength={180} /></label><div className="grid cols-2"><label className="field">Количество вопросов<input type="number" min={1} max={20} value={count} onChange={e => setCount(Number(e.target.value))} /></label><label className="field">Язык<select value={language} onChange={e => setLanguage(e.target.value)}><option value="russian">Русский</option><option value="kazakh">Қазақша</option><option value="english">English</option></select></label></div>
      <details><summary style={{ cursor: "pointer", fontWeight: 700 }}>Дополнительные настройки</summary><div className="stack" style={{ marginTop: 18 }}><label className="field">Класс<input placeholder="Например: 11 класс" value={gradeLevel} onChange={e => setGradeLevel(e.target.value)} /></label><label className="field">Тип вопросов<select value={type} onChange={e => setType(e.target.value)}><option value="multiple_choice">Выбор ответа</option><option value="true_false">Верно / неверно</option><option value="short_answer">Краткий ответ</option><option value="matching">Соответствие</option></select></label><label className="field">Цель обучения<textarea value={objective} onChange={e => setObjective(e.target.value)} placeholder="Что должен проверить этот тест?" /></label><label className="field">Исходный материал<textarea value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="Вставьте текст урока или фрагмент учебника" /></label></div></details>
      {error && <div className="error" role="alert">{error}</div>}<button className="btn primary" disabled={busy}>{busy ? "Создаём варианты, это может занять минуту..." : "Сгенерировать 4 варианта →"}</button></div>
      <aside className="panel soft"><div className="eyebrow">Что будет дальше</div><h3>Сначала проверка, потом публикация</h3><p className="muted">AI создаст варианты A, B, C и D. Вы сможете изменить каждый вопрос и только затем открыть доступ ученикам.</p><div className="divider"/><p className="small muted">Для генерации требуется настроенный GROQ_API_KEY. При ошибке публикация не произойдёт и незаконченный тест не будет создан.</p></aside></form>
  </div>;
}
