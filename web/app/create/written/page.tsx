"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TeacherHeader } from "../../teacher-nav";
import { api } from "@/lib/client";
import { serverMessage } from "@/lib/i18n/server-message";
import { MAX_REFERENCE_LENGTH } from "@/lib/dictation";
import { WRITTEN_KINDS, type WrittenKind } from "@/lib/written-work";
import { useT } from "../../i18n-provider";

export default function CreateWrittenPage() {
  const router = useRouter();
  const t = useT();
  const c = t.create;
  const w = t.written;
  const [kind, setKind] = useState<WrittenKind>("dictation");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("russian");
  const [gradeLevel, setGradeLevel] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { const { id } = await api<{ id: string }>("/api/tests", { method: "POST", body: JSON.stringify({ kind, title, language, gradeLevel, text }) }); router.push(`/tests/${id}`); }
    catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", w.createFailed)); setBusy(false); }
  }
  return <div className="wrap"><TeacherHeader current="create" canLeave={() => (!busy && !text.trim()) || window.confirm(c.leaveConfirm)} />
    <section className="page-head"><div className="eyebrow">{w.eyebrow}</div><h1>{w.title}</h1><p className="muted">{w.lead}</p><p className="small"><Link href="/create">{w.backToAi}</Link></p></section>
    <form onSubmit={create} className="grid cols-2 page-enter" style={{ alignItems: "start" }}><div className="panel stack">
      <fieldset className="written-fieldset stack" style={{ gap: 10 }}><legend className="small" style={{ fontWeight: 700 }}>{w.kind}</legend>{WRITTEN_KINDS.map(item => <label className="option" key={item}><input type="radio" name="kind" checked={kind === item} onChange={() => setKind(item)} /><span><b>{w.kinds[item]}</b><span className="muted small" style={{ display: "block", fontWeight: 400 }}>{w.kindHints[item]}</span></span></label>)}</fieldset>
      <label className="field">{w.workTitle}<input required maxLength={180} placeholder={w.titlePlaceholder} value={title} onChange={e => setTitle(e.target.value)} /></label>
      <div className="grid cols-2"><label className="field">{c.language}<select value={language} onChange={e => setLanguage(e.target.value)}><option value="russian">Русский</option><option value="kazakh">Қазақша</option><option value="english">English</option></select></label><label className="field">{c.grade}<input placeholder={c.gradePlaceholder} maxLength={80} value={gradeLevel} onChange={e => setGradeLevel(e.target.value)} /></label></div>
      <label className="field">{kind === "essay" ? w.essayTask : w.text[kind]}<textarea className="written-answer" required maxLength={MAX_REFERENCE_LENGTH} value={text} onChange={e => setText(e.target.value)} placeholder={kind === "essay" ? w.essayPlaceholder : w.textPlaceholder} /></label>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? w.creating : w.create}</button>
    </div>
    <aside className="panel soft"><div className="eyebrow">{w.howEyebrow}</div><h3>{w.howTitle}</h3><ol className="muted">{w.howSteps.map((step, i) => <li key={i} style={{ marginBottom: 8 }}>{step}</li>)}</ol><div className="divider" /><p className="small muted">{w.howNote}</p></aside></form>
  </div>;
}
