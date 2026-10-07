"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase";

const recoveryMarker = "ai_teacher_password_recovery";

export default function ResetPasswordPage() {
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
      setError("Пароли не совпадают.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await browserClient().auth.updateUser({ password });
      if (updateError) throw updateError;
      window.sessionStorage.removeItem(recoveryMarker);
      setRecoveryReady(false);
      setCompleted(true);
      setMessage("Пароль изменён. Теперь можно войти с новым паролем.");
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError("Не удалось изменить пароль. Запросите новую ссылку и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="wrap"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link></header>
    <main className="panel stack" style={{ maxWidth: 460, margin: "8vh auto" }}>
      <div className="eyebrow">Личный кабинет</div>
      <h2>Новый пароль</h2>
      {checking ? <p className="muted" role="status">Проверяем ссылку...</p> : completed ? <>
        <div className="success" role="status">{message}</div>
        <Link className="btn primary" href="/login">Перейти ко входу</Link>
      </> : recoveryReady ? <>
        <p className="muted">Придумайте новый пароль для аккаунта.</p>
        <form className="stack" onSubmit={updatePassword}>
          <label className="field">Новый пароль<input required type="password" minLength={6} autoComplete="new-password" value={password} onChange={event => { setPassword(event.target.value); setError(""); setMessage(""); }} /></label>
          <label className="field">Повторите пароль<input required type="password" minLength={6} autoComplete="new-password" value={confirmPassword} onChange={event => { setConfirmPassword(event.target.value); setError(""); setMessage(""); }} /></label>
          {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
          <button className="btn primary" disabled={busy}>{busy ? "Сохраняем..." : "Изменить пароль"}</button>
        </form>
        <Link className="btn ghost" href="/login">Вернуться ко входу</Link>
      </> : <>
        <div className="error" role="alert">Ссылка для смены пароля недействительна или срок её действия истёк. Запросите новую ссылку.</div>
        <Link className="btn primary" href="/login">Вернуться ко входу</Link>
      </>}
    </main>
  </div>;
}
