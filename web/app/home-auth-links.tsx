"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
import { useT } from "./i18n-provider";

type Who = "signedOut" | "teacher" | "student";

/**
 * Sign-in buttons on the home page, or a way back in for someone already
 * signed in: the session is kept in the browser, so the home page should not
 * ask a teacher to sign in again.
 */
export function HomeAuthLinks({ placement }: { placement: "nav" | "hero" }) {
  const t = useT();
  const [who, setWho] = useState<Who>("signedOut");
  useEffect(() => {
    let db: ReturnType<typeof browserClient>;
    try { db = browserClient(); }
    catch { return; } // No Supabase configuration: keep the sign-in buttons.
    let active = true;
    // Signing out in one place (the nav) also resets the hero buttons.
    const { data: listener } = db.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && active) setWho("signedOut");
    });
    void (async () => {
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;
      const { data } = await db.from("web_profiles").select("role").eq("id", session.user.id).maybeSingle();
      // Without a readable profile the dashboard decides what this account may see.
      if (active) setWho(data?.role === "student" ? "student" : "teacher");
    })().catch(() => undefined);
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  async function signOut() {
    await browserClient().auth.signOut({ scope: "local" });
    setWho("signedOut");
  }

  if (who === "teacher") {
    return placement === "nav"
      ? <Link className="btn primary" href="/dashboard">{t.common.dashboard}</Link>
      : <Link className="btn primary" href="/dashboard">{t.home.openDashboard} <span aria-hidden="true">↗</span></Link>;
  }
  if (who === "student") {
    return placement === "nav" ? <button className="btn ghost" onClick={() => void signOut()}>{t.nav.signOut}</button> : null;
  }
  return placement === "nav" ? <>
    <Link className="btn ghost" href="/login">{t.common.signIn}</Link>
    <Link className="btn primary" href="/login?mode=signup">{t.common.start}</Link>
  </> : <>
    <Link className="btn primary" href="/login?mode=signup">{t.home.startWork} <span aria-hidden="true">↗</span></Link>
    <Link className="btn" href="/login">{t.home.haveAccount}</Link>
  </>;
}
