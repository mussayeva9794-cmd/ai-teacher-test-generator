"use client";

import { useEffect, useState } from "react";
import { TeacherHeader } from "../teacher-nav";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { ClassRow } from "@/lib/types";
import { serverMessage } from "@/lib/i18n/server-message";
import { useI18n } from "../i18n-provider";
import { ClassProgress } from "./class-progress";

function splitEmails(value: string) {
  return value.split(/[\s,;]+/).map(email => email.trim()).filter(Boolean);
}

export default function ClassesPage() {
  const router = useRouter();
  const { t, date } = useI18n();
  const c = t.classes;
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [name, setName] = useState("");
  const [initialRoster, setInitialRoster] = useState("");
  const [rosters, setRosters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      const result = await api<{ classes: ClassRow[] }>("/api/classes");
      setClasses(result.classes);
      setError("");
    } catch (cause) {
      if (cause instanceof Error && cause.message === "Teacher sign-in required.") {
        router.replace("/login?next=/classes");
      } else {
        setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.loadFailed));
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);

  async function createClass(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ class: { name: string }; member_count: number }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name, emails: splitEmails(initialRoster) }),
      });
      setName(""); setInitialRoster("");
      setMessage(c.created(result.class.name, result.member_count));
      await refresh();
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.createFailed)); }
    finally { setBusy(false); }
  }

  async function addStudents(classId: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const emails = splitEmails(rosters[classId] || "");
      await api(`/api/classes/${classId}/members`, { method: "POST", body: JSON.stringify({ emails }) });
      setRosters(current => ({ ...current, [classId]: "" }));
      setMessage(c.updated(new Set(emails.map(email => email.toLowerCase())).size));
      await refresh();
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.addFailed)); }
    finally { setBusy(false); }
  }

  async function removeStudent(classId: string, memberId: string) {
    if (!window.confirm(c.confirmRemove)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/classes/${classId}/members/${memberId}`, { method: "DELETE" });
      setMessage(c.removed); await refresh();
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.removeFailed)); }
    finally { setBusy(false); }
  }

  async function setActive(row: ClassRow) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/classes/${row.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !row.is_active }) });
      setMessage(row.is_active ? c.archivedMessage : c.restoredMessage);
      await refresh();
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.changeFailed)); }
    finally { setBusy(false); }
  }

  return <div className="wrap">
    <TeacherHeader current="classes" />
    <section className="page-head"><div className="eyebrow">{c.eyebrow}</div><h1>{c.title}</h1><p className="muted">{c.lead}</p></section>
    {error && <div className="error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}{message && <div className="success" role="status" style={{ marginBottom: 16 }}>{message}</div>}
    <form className="panel stack" onSubmit={createClass}>
      <h3>{c.createTitle}</h3>
      <label className="field">{c.name}<input required maxLength={48} value={name} onChange={event => setName(event.target.value)} placeholder={c.namePlaceholder} /></label>
      <label className="field">{c.students}<textarea value={initialRoster} onChange={event => setInitialRoster(event.target.value)} placeholder={c.studentsPlaceholder} /></label>
      <p className="muted small">{c.inviteNote}</p>
      <div><button className="btn primary" disabled={busy}>{busy ? t.common.saving : c.create}</button></div>
    </form>
    <section className="stack" style={{ marginTop: 24 }}>
      <h2>{c.yours}</h2>
      {loading ? <div className="panel">{c.loading}</div> : classes.length ? classes.map(row => <article className="panel stack" key={row.id}>
        <div className="row"><div><div className="row" style={{ justifyContent: "flex-start" }}><h3>{row.name}</h3><span className="pill">{row.is_active ? c.active : c.archived}</span></div><p className="muted small">{c.membersLine(row.web_class_members.length, date(row.created_at))}</p></div><button className="btn ghost" disabled={busy} onClick={() => void setActive(row)}>{row.is_active ? c.archive : c.restore}</button></div>
        {row.web_class_members.length ? <div className="stack" style={{ gap: 0 }}>{row.web_class_members.map(member => <div className="list-item row" key={member.id}><div>{member.name ? <><b>{member.name}</b><div className="muted small">{member.email}</div></> : <b>{member.email}</b>}<div className="muted small">{member.student_id ? c.linked : c.pending}</div></div><button className="btn ghost danger" disabled={busy || !row.is_active} onClick={() => void removeStudent(row.id, member.id)}>{c.remove}</button></div>)}</div> : <p className="muted small">{c.emptyRoster}</p>}
        <ClassProgress classId={row.id} />
        {row.is_active && <div className="stack"><label className="field">{c.add}<textarea value={rosters[row.id] || ""} onChange={event => setRosters(current => ({ ...current, [row.id]: event.target.value }))} placeholder={c.addPlaceholder} /></label><div><button type="button" className="btn" disabled={busy || !splitEmails(rosters[row.id] || "").length} onClick={() => void addStudents(row.id)}>{c.addButton}</button></div></div>}
      </article>) : <div className="panel soft"><p className="muted">{c.none}</p></div>}
    </section>
  </div>;
}
