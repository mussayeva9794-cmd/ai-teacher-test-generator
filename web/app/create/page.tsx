"use client";

import { useState } from "react";
import { TeacherHeader } from "../teacher-nav";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { serverMessage } from "@/lib/i18n/server-message";
import { useT } from "../i18n-provider";
import { SourceMaterial } from "./source-material";

export default function CreatePage() {
  const router = useRouter();
  const t = useT();
  const c = t.create;
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [language, setLanguage] = useState("russian");
  const [gradeLevel, setGradeLevel] = useState("");
  const [type, setType] = useState("multiple_choice");
  const [objective, setObjective] = useState("");
  const [format, setFormat] = useState("test");
  const [bloomMix, setBloomMix] = useState("balanced");
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourcePages, setSourcePages] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [readingSource, setReadingSource] = useState(false);
  const [error, setError] = useState("");
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (readingSource) return;
    setBusy(true); setError("");
    try { const { id } = await api<{ id: string }>("/api/generate", { method: "POST", body: JSON.stringify({ topic, count, language, gradeLevel, type, objective, format, bloomMix, sourceText, sourceTitle, sourcePages, sourceUrl }) }); router.push(`/tests/${id}`); }
    catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.failed)); setBusy(false); }
  }
  return <div className="wrap"><TeacherHeader current="create" canLeave={() => !busy || window.confirm(c.leaveConfirm)} />
    <section className="page-head"><div className="eyebrow">{c.eyebrow}</div><h1>{c.title}</h1><p className="muted">{c.lead}</p></section>
    <form onSubmit={generate} className="grid cols-2 page-enter" style={{ alignItems: "start" }}><div className="panel stack"><label className="field">{c.topic}<input required autoFocus placeholder={c.topicPlaceholder} value={topic} onChange={e => setTopic(e.target.value)} maxLength={180} /></label><div className="grid cols-2"><label className="field">{c.count}<input type="number" min={1} max={20} value={count} onChange={e => setCount(Number(e.target.value))} /></label><label className="field">{c.language}<select value={language} onChange={e => setLanguage(e.target.value)}><option value="russian">Русский</option><option value="kazakh">Қазақша</option><option value="english">English</option></select></label></div>
      <label className="field">{c.format}<select value={format} onChange={e => setFormat(e.target.value)}><option value="test">{c.formatTest}</option><option value="sor">{c.formatSor}</option><option value="soch">{c.formatSoch}</option></select></label>{format !== "test" && <p className="muted small" style={{ margin: 0 }}>{c.formatNote}</p>}
      <SourceMaterial text={sourceText} setText={setSourceText} title={sourceTitle} setTitle={setSourceTitle} pages={sourcePages} setPages={setSourcePages} url={sourceUrl} setUrl={setSourceUrl} disabled={busy} onReadingChange={setReadingSource} />
      <details><summary style={{ cursor: "pointer", fontWeight: 700 }}>{c.advanced}</summary><div className="stack" style={{ marginTop: 18 }}><label className="field">{c.grade}<input placeholder={c.gradePlaceholder} value={gradeLevel} onChange={e => setGradeLevel(e.target.value)} /></label><label className="field">{c.type}<select value={type} onChange={e => setType(e.target.value)}><option value="multiple_choice">{c.typeMultipleChoice}</option><option value="true_false">{c.typeTrueFalse}</option><option value="short_answer">{c.typeShortAnswer}</option><option value="matching">{c.typeMatching}</option><option value="multiple_select">{c.typeMultipleSelect}</option><option value="ordering">{c.typeOrdering}</option></select></label><label className="field">{c.bloom}<select value={bloomMix} onChange={e => setBloomMix(e.target.value)}><option value="balanced">{c.bloomBalanced}</option><option value="knowledge">{c.bloomKnowledge}</option><option value="application">{c.bloomApplication}</option></select></label><label className="field">{c.objective}<textarea value={objective} onChange={e => setObjective(e.target.value)} placeholder={c.objectivePlaceholder} /></label></div></details>
      {error && <div className="error" role="alert">{error}</div>}<button className="btn primary" disabled={busy || readingSource}>{busy ? c.generating : c.generate}</button></div>
      <aside className="panel soft" aria-live="polite">{busy ? <><div className="eyebrow">{c.busyEyebrow}</div><h3>{c.busyTitle}</h3><p className="muted">{c.busyText}</p><div className="generating-draft" aria-hidden="true"><div className="gen-chips">{["A", "B", "C", "D"].map((name, i) => <span key={name} style={{ ["--i" as string]: i }}>{t.labels.variant(name)}</span>)}</div>{[0, 1, 2, 3].map(i => <span key={i} className={i % 2 ? "gen-line short" : "gen-line"} style={{ ["--i" as string]: i }} />)}</div></> : <><div className="eyebrow">{c.nextEyebrow}</div><h3>{c.nextTitle}</h3><p className="muted">{c.nextText}</p><div className="divider"/><p className="small muted">{c.nextNote}</p></>}</aside></form>
  </div>;
}
