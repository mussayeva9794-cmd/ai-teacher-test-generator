"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import type { ClassRow } from "@/lib/types";

function splitEmails(value: string) {
  return value.split(/[\s,;]+/).map(email => email.trim()).filter(Boolean);
}

export default function ClassesPage() {
  const router = useRouter();
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
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить классы.");
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
      setMessage(`Создан класс ${result.class.name}; добавлено адресов: ${result.member_count}.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать класс."); }
    finally { setBusy(false); }
  }

  async function addStudents(classId: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const emails = splitEmails(rosters[classId] || "");
      await api(`/api/classes/${classId}/members`, { method: "POST", body: JSON.stringify({ emails }) });
      setRosters(current => ({ ...current, [classId]: "" }));
      setMessage(`Список класса обновлён: ${emails.length} адресов обработано.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось добавить учеников."); }
    finally { setBusy(false); }
  }

  async function removeStudent(classId: string, memberId: string) {
    if (!window.confirm("Убрать ученика из класса? Доступ к новым обращениям по ссылкам этого класса будет закрыт.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/classes/${classId}/members/${memberId}`, { method: "DELETE" });
      setMessage("Ученик удалён из списка класса."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось удалить ученика."); }
    finally { setBusy(false); }
  }

  async function setActive(row: ClassRow) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/classes/${row.id}`, { method: "PATCH", body: JSON.stringify({ is_active: !row.is_active }) });
      setMessage(row.is_active ? "Класс архивирован; связанные ссылки временно закрыты." : "Класс снова активен.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось изменить класс."); }
    finally { setBusy(false); }
  }

  return <div className="wrap">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link><nav className="navlinks"><Link className="btn ghost" href="/dashboard">← Тесты</Link><Link className="btn ghost" href="/account">Аккаунт</Link></nav></header>
    <section className="page-head"><div className="eyebrow">Рабочее пространство</div><h1>Классы</h1><p className="muted">Добавьте адреса школьных Google-аккаунтов один раз. При публикации выбирайте класс, а не вводите список заново.</p></section>
    {error && <div className="error" role="alert" style={{ marginBottom: 16 }}>{error}</div>}{message && <div className="success" role="status" style={{ marginBottom: 16 }}>{message}</div>}
    <form className="panel stack" onSubmit={createClass}>
      <h3>Создать класс</h3>
      <label className="field">Название<input required maxLength={48} value={name} onChange={event => setName(event.target.value)} placeholder="Например, 7А" /></label>
      <label className="field">Ученики (email, можно вставить столбцом или через запятую)<textarea value={initialRoster} onChange={event => setInitialRoster(event.target.value)} placeholder="ученик1@gmail.com&#10;ученик2@gmail.com" /></label>
      <p className="muted small">Email — это приглашение. Ученик получит доступ после входа через Google с тем же адресом. Новые Google-аккаунты автоматически получают только роль ученика.</p>
      <div><button className="btn primary" disabled={busy}>{busy ? "Сохраняем…" : "Создать класс"}</button></div>
    </form>
    <section className="stack" style={{ marginTop: 24 }}>
      <h2>Ваши классы</h2>
      {loading ? <div className="panel">Загружаем классы…</div> : classes.length ? classes.map(row => <article className="panel stack" key={row.id}>
        <div className="row"><div><div className="row" style={{ justifyContent: "flex-start" }}><h3>{row.name}</h3><span className="pill">{row.is_active ? "Активен" : "В архиве"}</span></div><p className="muted small">{row.web_class_members.length} учеников в списке · создан {new Date(row.created_at).toLocaleDateString("ru-RU")}</p></div><button className="btn ghost" disabled={busy} onClick={() => void setActive(row)}>{row.is_active ? "Архивировать" : "Восстановить"}</button></div>
        {row.web_class_members.length ? <div className="stack" style={{ gap: 0 }}>{row.web_class_members.map(member => <div className="list-item row" key={member.id}><div><b>{member.email}</b><div className="muted small">{member.student_id ? "Аккаунт связан" : "Ожидает первого входа"}</div></div><button className="btn ghost danger" disabled={busy || !row.is_active} onClick={() => void removeStudent(row.id, member.id)}>Убрать</button></div>)}</div> : <p className="muted small">Список учеников пока пуст.</p>}
        {row.is_active && <div className="stack"><label className="field">Добавить учеников<textarea value={rosters[row.id] || ""} onChange={event => setRosters(current => ({ ...current, [row.id]: event.target.value }))} placeholder="Вставьте новые email через запятую или с новой строки" /></label><div><button type="button" className="btn" disabled={busy || !splitEmails(rosters[row.id] || "").length} onClick={() => void addStudents(row.id)}>Добавить в класс</button></div></div>}
      </article>) : <div className="panel soft"><p className="muted">Классы пока не созданы. Создайте, например, 7А и добавьте список учеников.</p></div>}
    </section>
  </div>;
}
