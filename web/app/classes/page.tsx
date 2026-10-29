"use client";

import { useEffect, useState } from "react";
import { TeacherHeader } from "../teacher-nav";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { ClassRow } from "@/lib/types";
import { MAX_STUDENT_NAME, normalizedStudentName, parseRoster } from "@/lib/classes";
import { serverMessage } from "@/lib/i18n/server-message";
import { useI18n } from "../i18n-provider";
import { ClassProgress } from "./class-progress";

type Member = ClassRow["web_class_members"][number];

// Roster order: by the shown name (surname first when the teacher typed it so), then email.
function badLinesMessage(c: { badLines: (lines: string, more: number) => string }, invalid: string[]) {
  return c.badLines(invalid.slice(0, 5).join(" · "), Math.max(0, invalid.length - 5));
}

function byShownName(a: Member, b: Member) {
  return (a.name || a.email).localeCompare(b.name || b.email) || a.email.localeCompare(b.email);
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
    const roster = parseRoster(initialRoster);
    if (roster.invalid.length) { setError(badLinesMessage(c, roster.invalid)); setBusy(false); return; }
    try {
      const result = await api<{ class: { name: string }; member_count: number }>("/api/classes", {
        method: "POST",
        body: JSON.stringify({ name, students: roster.entries }),
      });
      setName(""); setInitialRoster("");
      setMessage(c.created(result.class.name, result.member_count));
      await refresh();
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.createFailed)); }
    finally { setBusy(false); }
  }

  async function addStudents(classId: string) {
    setBusy(true); setError(""); setMessage("");
    const roster = parseRoster(rosters[classId] || "");
    if (roster.invalid.length) { setError(badLinesMessage(c, roster.invalid)); setBusy(false); return; }
    try {
      await api(`/api/classes/${classId}/members`, { method: "POST", body: JSON.stringify({ students: roster.entries }) });
      setRosters(current => ({ ...current, [classId]: "" }));
      setMessage(c.updated(new Set(roster.entries.map(entry => entry.email)).size));
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

  async function renameStudent(classId: string, member: Member) {
    const typed = window.prompt(c.namePrompt(member.email), member.full_name || "");
    if (typed === null) return;
    const fullName = normalizedStudentName(typed);
    if (fullName === undefined) { setError(c.nameInvalid(MAX_STUDENT_NAME)); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/classes/${classId}/members/${member.id}`, { method: "PATCH", body: JSON.stringify({ full_name: fullName }) });
      setMessage(fullName ? c.nameSaved : c.nameCleared); await refresh();
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.nameFailed)); }
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
        {row.web_class_members.length ? <div className="stack" style={{ gap: 0 }}>{[...row.web_class_members].sort(byShownName).map(member => <div className="list-item row" key={member.id}><div>{member.name ? <><b>{member.name}</b><div className="muted small">{member.email}</div></> : <b>{member.email}</b>}<div className="muted small">{member.student_id ? c.linked : c.pending}</div></div><div className="row" style={{ gap: 8 }}><button className="btn ghost" disabled={busy || !row.is_active} onClick={() => void renameStudent(row.id, member)}>{member.full_name ? c.editName : c.addName}</button><button className="btn ghost danger" disabled={busy || !row.is_active} onClick={() => void removeStudent(row.id, member.id)}>{c.remove}</button></div></div>)}</div> : <p className="muted small">{c.emptyRoster}</p>}
        <ClassProgress classId={row.id} />
        {row.is_active && <div className="stack"><label className="field">{c.add}<textarea value={rosters[row.id] || ""} onChange={event => setRosters(current => ({ ...current, [row.id]: event.target.value }))} placeholder={c.addPlaceholder} /></label><div><button type="button" className="btn" disabled={busy || !(rosters[row.id] || "").trim()} onClick={() => void addStudents(row.id)}>{c.addButton}</button></div></div>}
      </article>) : <div className="panel soft"><p className="muted">{c.none}</p></div>}
    </section>
  </div>;
}
