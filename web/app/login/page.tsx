"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase";
import { safeNext } from "@/lib/client";
import { signInWithPasskey } from "@/lib/passkeys";

function LoginForm() {
  const search = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState(search.get("mode") === "signup" ? "signup" : "signin");
  const [role, setRole] = useState(search.get("next")?.startsWith("/s/") ? "student" : "teacher");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const next = safeNext(search.get("next"), role === "teacher" ? "/dashboard" : "/");

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const auth = browserClient().auth;
      if (mode === "signup") {
        const { data, error: authError } = await auth.signUp({
          email, password,
          options: { data: { display_name: name.trim(), role }, emailRedirectTo: `${location.origin}/login?next=${encodeURIComponent(next)}` },
        });
        if (authError) throw authError;
        if (!data.session) setMessage("Проверьте почту и подтвердите адрес, затем войдите.");
        else router.replace(next);
      } else {
        const { error: authError } = await auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        router.replace(next);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось войти. Повторите попытку."); }
    finally { setBusy(false); }
  }

  async function passkeySignIn() {
    setBusy(true); setError(""); setMessage("");
    try {
      await signInWithPasskey(browserClient().auth);
      router.replace(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти с ключом доступа.");
    } finally { setBusy(false); }
  }

  return <div className="wrap"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link></header>
    <main className="panel" style={{ maxWidth: 460, margin: "8vh auto" }}><div className="eyebrow">Личный кабинет</div><h2>{mode === "signup" ? "Создать аккаунт" : "С возвращением"}</h2><p className="muted">{mode === "signup" ? "Укажите роль и используйте свой адрес электронной почты." : "Войдите, чтобы продолжить работу."}</p>
      <div className="tabs" style={{ marginBottom: 22 }}><button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Вход</button><button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Регистрация</button></div>
      <form className="stack" onSubmit={submit}>
        {mode === "signup" && <><label className="field">Имя<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label><label className="field">Роль<select value={role} onChange={e => setRole(e.target.value)}><option value="teacher">Учитель</option><option value="student">Ученик</option></select></label></>}
        <label className="field">Электронная почта<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="field">Пароль<input required type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
        <button className="btn primary" disabled={busy}>{busy ? "Подождите..." : mode === "signup" ? "Создать аккаунт" : "Войти"}</button>
      </form>
      {mode === "signin" && <div className="stack" style={{ marginTop: 18 }}><p className="muted small" style={{ textAlign: "center" }}>или</p><button type="button" className="btn" disabled={busy} onClick={passkeySignIn}>Войти с Face ID / Touch ID</button><p className="muted small">Также может потребоваться код разблокировки устройства. Пароль остаётся доступным.</p></div>}
    </main></div>;
}

export default function LoginPage() { return <Suspense fallback={<div className="wrap">Загрузка...</div>}><LoginForm /></Suspense>; }
