"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyIllustration } from "../illustrations";
import { TeacherHeader } from "../teacher-nav";
import { distinctTopic, languageLabel } from "@/lib/labels";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { api } from "@/lib/client";
import type { TestRow } from "@/lib/types";
import { serverMessage } from "@/lib/i18n/server-message";
import { useI18n } from "../i18n-provider";

export default function Dashboard() {
  const router = useRouter();
  const { t, date } = useI18n();
  const d = t.dashboard;
  const [tests, setTests] = useState<TestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teacherOnly, setTeacherOnly] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;
    browserClient().auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login?next=/dashboard"); return; }
      api<{ tests: TestRow[] }>("/api/tests").then(result => { if (active) setTests(result.tests); })
        .catch(cause => {
          if (!active) return;
          if (cause instanceof Error && cause.message === "Teacher sign-in required.") {
            setTeacherOnly(true);
            setError(d.teacherOnly);
          } else {
            setError(serverMessage(t, cause instanceof Error ? cause.message : "", d.loadFailed));
          }
        })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [router]);

  const visible = tests.filter(test => filter === "all" || test.status === filter);
  const count = (value: string) => value === "all" ? tests.length : tests.filter(test => test.status === value).length;
  return <div className="wrap"><TeacherHeader current="tests" limited={teacherOnly} />
    <section className="page-head"><div className="eyebrow">{d.eyebrow}</div><h1>{d.title}</h1><p className="muted">{d.lead}</p></section>
    {!teacherOnly && <div className="toolbar"><div className="tabs">{[["all",d.filterAll],["draft",d.filterDraft],["published",d.filterPublished],["archived",d.filterArchived]].map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}{!loading && <span className="tab-count">{count(value)}</span>}</button>)}</div><Link className="btn primary" href="/create">{d.create}</Link></div>}
    {loading ? <div className="panel">{d.loading}</div> : error ? <div className="error">{error}</div> : visible.length ? <div className="grid cols-2 page-enter">{visible.map(test => <Link className="panel" href={`/tests/${test.id}`} key={test.id}><div className="row"><span className="eyebrow">{distinctTopic(test.topic, test.title)}</span><span className="pill">{t.status[test.status]}</span></div><h3 style={{ marginTop: 16 }}>{test.title}</h3><p className="muted small">{[test.grade_level, languageLabel(test.language), date(test.created_at)].filter(Boolean).join(" · ")}</p><span style={{ color: "var(--wine)", fontWeight: 700 }}>{d.open}</span></Link>)}</div> : <div className="panel soft empty-state page-enter draw-in"><EmptyIllustration /><div><h3>{d.emptyTitle}</h3><p className="muted">{d.emptyText}</p><Link className="btn primary" href="/create">{d.createFirst}</Link></div></div>}
  </div>;
}
