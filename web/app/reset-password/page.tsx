"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase";
import { Brand } from "../brand";
import { useT } from "../i18n-provider";
import { LanguageSwitcher } from "../language-switcher";

const recoveryMarker = "ai_teacher_password_recovery";

export default function ResetPasswordPage() {
  const t = useT();
  const r = t.reset;
  const [checking, setChecking] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    let recoveryEventReceived = false;

    try {
      const auth = browserClient().auth;
      const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
        if (event !== "PASSWORD_RECOVERY" || !session || !active) return;
        recoveryEventReceived = true;
        window.sessionStorage.setItem(recoveryMarker, "1");
        setRecoveryReady(true);
        setChecking(false);
      });

      auth.getSession().then(({ data: { session }, error: sessionError }) => {
        if (!active || recoveryEventReceived) return;
        const isRecoverySession = window.sessionStorage.getItem(recoveryMarker) === "1";
        setRecoveryReady(Boolean(session && !sessionError && isRecoverySession));
        setChecking(false);
      }).catch(() => {
        if (active) setChecking(false);
      });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    } catch {
      setChecking(false);
      return () => { active = false; };
    }
  }, []);

  async function updatePassword(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirmPassword) {
      setError(r.mismatch);
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await browserClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      window.sessionStorage.removeItem(recoveryMarker);
      setRecoveryReady(false);
      setCompleted(true);
      setMessage(r.done);
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError(r.failed);
    } finally {
      setBusy(false);
    }
  }

  return <div className="wrap"><header className="topbar"><Brand /><LanguageSwitcher /></header>
    <main className="panel stack" style={{ maxWidth: 460, margin: "8vh auto" }}>
      <div className="eyebrow">{r.eyebrow}</div>
      <h2>{r.title}</h2>
      {checking ? <p className="muted" role="status">{r.checking}</p> : completed ? <>
        <div className="success" role="status">{message}</div>
        <Link className="btn primary" href="/login">{r.toLogin}</Link>
      </> : recoveryReady ? <>
        <p className="muted">{r.lead}</p>
        <form className="stack" onSubmit={updatePassword}>
          <label className="field">{r.newPassword}<input required type="password" minLength={6} autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setError(""); setMessage(""); }} /></label>
          <label className="field">{r.repeatPassword}<input required type="password" minLength={6} autoComplete="new-password" value={confirmPassword} onChange={event => { setConfirmPassword(event.target.value); setError(""); setMessage(""); }} /></label>
          {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
          <button className="btn primary" disabled={busy}>{busy ? t.common.saving : r.submit}</button>
        </form>
        <Link className="btn ghost" href="/login">{r.backToLogin}</Link>
      </> : <>
        <div className="error" role="alert">{r.invalidLink}</div>
        <Link className="btn primary" href="/login">{r.backToLogin}</Link>
      </>}
    </main>
  </div>;
}
