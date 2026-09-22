"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { api } from "@/lib/client";
import type { TestRow } from "@/lib/types";

export default function Dashboard() {
  const router = useRouter();
  const [tests, setTests] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;
    browserClient().auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login?next=/dashboard"); return; }
      api<{ tests: TestRow[] }>("/api/tests").then(result => { if (active) setTests(result.tests); })
        .catch(cause => { if (active) setError(cause.message); })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [router]);

  const visible = tests.filter(test => filter === "all" || test.status === filter);
  return <div className="wrap"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link><nav className="navlinks"><Link className="btn ghost" href="/create">Создать</Link><button className="btn ghost" onClick={async () => { await browserClient().auth.signOut(); router.replace("/"); }}>Выйти</button></nav></header>
    <section className="page-head"><div className="eyebrow">Рабочее пространство</div><h1>Ваши тесты</h1><p className="muted">Создавайте, публикуйте и просматривайте результаты в одном месте.</p></section>
    <div className="toolbar"><div className="tabs">{[["all","Все"],["draft","Черновики"],["published","Активные"],["archived","Архив"]].map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><Link className="btn primary" href="/create">+ Создать тест</Link></div>
    {loading ? <div className="panel">Загружаем тесты...</div> : error ? <div className="error">{error}</div> : visible.length ? <div className="grid cols-2">{visible.map(test => <Link className="panel" href={`/tests/${test.id}`} key={test.id}><div className="row"><span className="eyebrow">{test.topic}</span><span className="pill">{test.status === "published" ? "Опубликован" : test.status === "draft" ? "Черновик" : "Архив"}</span></div><h3 style={{ marginTop: 16 }}>{test.title}</h3><p className="muted small">{test.grade_level || "Все классы"} · {test.language} · {new Date(test.created_at).toLocaleDateString("ru-RU")}</p><span style={{ color: "var(--wine)", fontWeight: 700 }}>Открыть →</span></Link>)}</div> : <div className="panel soft"><h3>Здесь пока пусто</h3><p className="muted">Создайте первый тест, затем проверьте вопросы и отправьте ученикам.</p><Link className="btn primary" href="/create">Создать первый тест</Link></div>}
  </div>;
}
