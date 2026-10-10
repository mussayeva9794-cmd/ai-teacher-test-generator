"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { browserClient } from "@/lib/supabase";
import { oauthRequestedNext, safeNext } from "@/lib/client";
import { signInWithPasskey } from "@/lib/passkeys";
import { defaultDestination, googleOAuthOptions, signupOptions } from "@/lib/signup";

function LoginForm() {
  const search = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState(search.get("mode") === "signup" ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthUserId, setOauthUserId] = useState<string | null>(null);
  const [oauthNext, setOauthNext] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestedNext = search.get("next");
  const signupNext = safeNext(requestedNext, "/");

  async function destination(userId: string, requestedDestination = requestedNext) {
    const { data } = await browserClient().from("web_profiles").select("role").eq("id", userId).single();
    return safeNext(requestedDestination, defaultDestination(data?.role));
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const callback = Boolean(searchParams.get("code") || hashParams.get("access_token") || hashParams.get("error_description"));
    const providerError = searchParams.get("error_description") || hashParams.get("error_description");
    if (callback) setOauthNext(oauthRequestedNext(window.sessionStorage.getItem("ai_teacher_oauth_next")));
    if (providerError) {
      setError("Не удалось завершить вход через Google. Попробуйте ещё раз.");
      window.sessionStorage.removeItem("ai_teacher_oauth_next");
      setBusy(false);
    }
    let auth: ReturnType<typeof browserClient>["auth"];
    try { auth = browserClient().auth; }
    catch {
      setError("Вход временно недоступен: не настроено подключение к Supabase.");
      return;
    }
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
      if (callback && session) setOauthUserId(session.user.id);
    });
    if (callback) {
      void auth.getSession().then(({ data }) => {
        if (data.session) setOauthUserId(data.session.user.id);
      });
    }
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!oauthUserId) return;
    let active = true;
    setBusy(true);
    void destination(oauthUserId, oauthNext || requestedNext).then(next => {
      if (active) {
        window.sessionStorage.removeItem("ai_teacher_oauth_next");
        router.replace(next);
      }
    }).catch(() => {
      if (active) setError("Вход выполнен, но профиль ещё не готов. Обновите страницу или войдите снова.");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, [oauthUserId, oauthNext, requestedNext, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const auth = browserClient().auth;
      if (mode === "signup") {
        const { data, error: authError } = await auth.signUp({
          email, password,
          options: signupOptions(name, location.origin, signupNext),
        });
        if (authError) throw authError;
        if (!data.session) setMessage("Проверьте почту и подтвердите адрес, затем войдите.");
        else router.replace(signupNext);
      } else {
        const { data, error: authError } = await auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        router.replace(await destination(data.user.id));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось войти. Повторите попытку."); }
    finally { setBusy(false); }
  }

  async function passkeySignIn() {
    setBusy(true); setError(""); setMessage("");
    try {
      const session = await signInWithPasskey(browserClient().auth);
      router.replace(await destination(session.user.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти с ключом доступа.");
    } finally { setBusy(false); }
  }

  async function googleSignIn() {
    setBusy(true); setError(""); setMessage("");
    try {
      const oauthNext = oauthRequestedNext(requestedNext);
      if (oauthNext) window.sessionStorage.setItem("ai_teacher_oauth_next", oauthNext);
      else window.sessionStorage.removeItem("ai_teacher_oauth_next");
      const { error: oauthError } = await browserClient().auth.signInWithOAuth(
        googleOAuthOptions(window.location.origin),
      );
      if (oauthError) throw oauthError;
    } catch (cause) {
      window.sessionStorage.removeItem("ai_teacher_oauth_next");
      setError(cause instanceof Error ? cause.message : "Не удалось начать вход через Google.");
      setBusy(false);
    }
  }

  async function requestPasswordReset() {
    setBusy(true); setError(""); setMessage("");
    try {
      const { error: resetError } = await browserClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      setMessage("Если аккаунт с таким адресом существует, мы отправим письмо со ссылкой для смены пароля.");
    } catch {
      setError("Не удалось отправить письмо. Проверьте адрес и попробуйте позже.");
    } finally { setBusy(false); }
  }

  return <div className="wrap"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link></header>
    <main className="panel" style={{ maxWidth: 460, margin: "8vh auto" }}><div className="eyebrow">Личный кабинет</div><h2>{mode === "signup" ? "Создать аккаунт" : "С возвращением"}</h2><p className="muted">{mode === "signup" ? "Новый аккаунт создаётся для ученика. Учительский доступ выдаёт администратор школы." : "Войдите, чтобы продолжить работу."}</p>
      <div className="tabs" style={{ marginBottom: 22 }}><button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Вход</button><button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Регистрация</button></div>
      <form className="stack" onSubmit={submit}>
        {mode === "signup" && <label className="field">Имя<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
        <label className="field">Электронная почта<input required type="email" value={email} onChange={e => { setEmail(e.target.value); setError(""); setMessage(""); }} autoComplete="email" /></label>
        <label className="field">Пароль<input required type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
        <button className="btn primary" disabled={busy}>{busy ? "Подождите..." : mode === "signup" ? "Создать аккаунт" : "Войти"}</button>
      </form>
      {mode === "signin" && <div className="stack" style={{ marginTop: 14 }}><button type="button" className="btn ghost small" disabled={busy || !email.trim()} onClick={requestPasswordReset}>Забыли пароль?</button></div>}
      <div className="stack" style={{ marginTop: 18 }}><p className="muted small" style={{ textAlign: "center", marginBottom: 0 }}>или используйте школьный Google-аккаунт</p><button type="button" className="btn" disabled={busy} onClick={googleSignIn}>Войти или зарегистрироваться через Google</button>
        {mode === "signin" && <><p className="muted small" style={{ textAlign: "center", marginBottom: 0 }}>или войти без Google</p><button type="button" className="btn" disabled={busy} onClick={passkeySignIn}>Войти с Face ID / Touch ID</button><p className="muted small">Также может потребоваться код разблокировки устройства. Пароль остаётся доступным.</p></>}
      </div>
      <p className="small muted" style={{ textAlign: "center", marginTop: 18 }}>Как сервис использует данные аккаунта и учебные данные: <Link href="/privacy">политика конфиденциальности</Link>.</p>
    </main></div>;
}

export default function LoginPage() { return <Suspense fallback={<div className="wrap">Загрузка...</div>}><LoginForm /></Suspense>; }
