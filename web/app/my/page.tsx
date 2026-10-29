"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "../brand";
import { EmptyIllustration } from "../illustrations";
import { LanguageSwitcher } from "../language-switcher";
import { useI18n } from "../i18n-provider";
import { api } from "@/lib/client";
import { browserClient } from "@/lib/supabase";
import { serverMessage } from "@/lib/i18n/server-message";
import type { MyAttempt } from "@/lib/my-attempts";

export default function MyTests() {
  const router = useRouter();
  const { t, date } = useI18n();
  const m = t.my;
  const [attempts, setAttempts] = useState<MyAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    browserClient().auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login?next=/my"); return; }
      api<{ attempts: MyAttempt[] }>("/api/my/attempts").then(result => { if (active) setAttempts(result.attempts); })
        .catch(cause => {
          if (!active) return;
          // A teacher has their own dashboard.
          if (cause instanceof Error && cause.message === "Student account required.") { router.replace("/dashboard"); return; }
          setError(serverMessage(t, cause instanceof Error ? cause.message : "", m.loadFailed));
        })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [router]);

  async function signOut() {
    await browserClient().auth.signOut({ scope: "local" });
    router.replace("/");
  }

  const scoreText = (score: MyAttempt["score"]) =>
    score.state === "shown" ? `${score.percentage}%` : score.state === "pending" ? m.scorePending : m.scoreHidden;

  return <div className="wrap"><header className="topbar"><Brand /><LanguageSwitcher /><nav className="navlinks" aria-label={t.nav.main}><button className="btn ghost" onClick={() => void signOut()}>{t.nav.signOut}</button></nav></header>
    <section className="page-head"><div className="eyebrow">{m.eyebrow}</div><h1>{m.title}</h1><p className="muted">{m.lead}</p></section>
    {loading ? <div className="panel">{t.common.loading}</div> : error ? <div className="error" role="alert">{error}</div> : attempts.length ? <div className="grid cols-2 page-enter">{attempts.map(attempt => {
      const body = <><div className="row"><span className="eyebrow">{attempt.topic || m.test}</span><span className="pill">{scoreText(attempt.score)}</span></div><h3 style={{ marginTop: 16 }}>{attempt.title}</h3><p className="muted small">{m.submittedAt(date(attempt.submitted_at, "dayTime"))}</p>{attempt.href && <span style={{ color: "var(--wine)", fontWeight: 700 }}>{m.open}</span>}</>;
      return attempt.href ? <Link className="panel" href={attempt.href} key={attempt.id}>{body}</Link> : <div className="panel" key={attempt.id}>{body}</div>;
    })}</div> : <div className="panel soft empty-state page-enter draw-in"><EmptyIllustration /><div><h3>{m.emptyTitle}</h3><p className="muted">{m.emptyText}</p></div></div>}
  </div>;
}
