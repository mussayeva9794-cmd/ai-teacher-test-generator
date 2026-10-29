"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { SheetsIllustration } from "../illustrations";
import { browserClient } from "@/lib/supabase";
import { oauthRequestedNext, safeNext } from "@/lib/client";
import { signInWithPasskey } from "@/lib/passkeys";
import { defaultDestination, googleOAuthOptions, roleFromProfileResult, signupOptions } from "@/lib/signup";
import { serverMessage } from "@/lib/i18n/server-message";
import { Brand } from "../brand";
import { useT } from "../i18n-provider";
import { LanguageSwitcher } from "../language-switcher";

function LoginForm() {
  const search = useSearchParams();
  const router = useRouter();
  const t = useT();
  const l = t.login;
  const [mode, setMode] = useState(search.get("mode") === "signup" ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [oauthUserId, setOauthUserId] = useState<string | null>(null);
  const [oauthNext, setOauthNext] = useState<string | null>(null);
  // An account already signed in on this device: offer it instead of a new sign-in.
  const [signedIn, setSignedIn] = useState<{ id: string; email: string } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const requestedNext = search.get("next");
  const signupNext = safeNext(requestedNext, "/");

  async function destination(userId: string, requestedDestination = requestedNext) {
    const { data, error: profileError } = await browserClient().from("web_profiles").select("role").eq("id", userId).single();
    const role = roleFromProfileResult(data, profileError);
    return safeNext(requestedDestination, defaultDestination(role));
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const callback = Boolean(searchParams.get("code") || hashParams.get("access_token") || hashParams.get("error_description"));
    const providerError = searchParams.get("error_description") || hashParams.get("error_description");
    if (callback) setOauthNext(oauthRequestedNext(window.sessionStorage.getItem("ai_teacher_oauth_next")));
    if (providerError) {
      setError(l.googleFailed);
      window.sessionStorage.removeItem("ai_teacher_oauth_next");
      setBusy(false);
    }
    let auth: ReturnType<typeof browserClient>["auth"];
    try { auth = browserClient().auth; }
    catch {
      setError(l.supabaseMissing);
      return;
    }
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
      if (callback && session) setOauthUserId(session.user.id);
    });
    void auth.getSession().then(({ data }) => {
      if (!data.session) return;
      if (callback) setOauthUserId(data.session.user.id);
      else setSignedIn({ id: data.session.user.id, email: data.session.user.email || "" });
    });
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
      if (active) setError(l.profileFailed);
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
        if (!data.session) setMessage(l.checkEmail);
        else router.replace(signupNext);
      } else {
        const { data, error: authError } = await auth.signInWithPassword({ email, password });
        if (authError) throw authError;
        router.replace(await destination(data.user.id));
      }
    } catch (cause) { setError(serverMessage(t, cause instanceof Error ? cause.message : "", l.signinFailed)); }
    finally { setBusy(false); }
  }

  async function passkeySignIn() {
    setBusy(true); setError(""); setMessage("");
    try {
      const session = await signInWithPasskey(browserClient().auth);
      router.replace(await destination(session.user.id));
    } catch (cause) {
      setError(serverMessage(t, cause instanceof Error ? cause.message : "", l.passkeyFailed));
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
      setError(serverMessage(t, cause instanceof Error ? cause.message : "", l.googleStartFailed));
      setBusy(false);
    }
  }

  async function continueSignedIn() {
    if (!signedIn) return;
    setBusy(true); setError("");
    try { router.replace(await destination(signedIn.id)); }
    catch { setError(l.profileFailed); setBusy(false); }
  }

  async function useAnotherAccount() {
    setBusy(true); setError("");
    await browserClient().auth.signOut({ scope: "local" }).catch(() => undefined);
    setSignedIn(null); setBusy(false);
  }

  async function requestPasswordReset() {
    setBusy(true); setError(""); setMessage("");
    try {
      const { error: resetError } = await browserClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) throw resetError;
      setMessage(l.resetSent);
    } catch {
      setError(l.resetFailed);
    } finally { setBusy(false); }
  }

  return <div className="wrap"><header className="topbar"><Brand /><LanguageSwitcher /></header>
    <div className="auth-layout"><aside className="auth-art draw-in enter" aria-hidden="true"><SheetsIllustration /><p className="auth-art-caption"><b>{l.artTitle}</b>{l.artText}</p></aside>
    <main className="panel enter" style={{ ["--i" as string]: 1 }}><div className="eyebrow">{l.eyebrow}</div><h2>{mode === "signup" ? l.signupTitle : l.signinTitle}</h2><p className="muted">{mode === "signup" ? l.signupLead : l.signinLead}</p>
      {signedIn && <div className="notice stack" role="status" style={{ marginBottom: 18 }}><span>{l.alreadySignedIn(signedIn.email)}</span><div className="row"><button type="button" className="btn primary" disabled={busy} onClick={() => void continueSignedIn()}>{l.continueSignedIn}</button><button type="button" className="btn ghost" disabled={busy} onClick={() => void useAnotherAccount()}>{l.useAnotherAccount}</button></div></div>}
      <div className="tabs tabs-slide" style={{ marginBottom: 22 }}><button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>{l.tabSignin}</button><button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>{l.tabSignup}</button></div>
      <form className="stack" onSubmit={submit}>
        {mode === "signup" && <label className="field">{l.name}<input required value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></label>}
        <label className="field">{l.email}<input required type="email" value={email} onChange={e => { setEmail(e.target.value); setError(""); setMessage(""); }} autoComplete="email" /></label>
        <label className="field">{l.password}<input required type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
        <button className="btn primary" disabled={busy}>{busy ? t.common.wait : mode === "signup" ? l.submitSignup : l.submitSignin}</button>
      </form>
      {mode === "signin" && <div className="stack" style={{ marginTop: 14 }}><button type="button" className="btn ghost small" disabled={busy || !email.trim()} onClick={requestPasswordReset}>{l.forgot}</button></div>}
      <div className="stack" style={{ marginTop: 18 }}><p className="muted small" style={{ textAlign: "center", marginBottom: 0 }}>{l.googleDivider}</p><button type="button" className="btn" disabled={busy} onClick={googleSignIn}>{l.google}</button>
        {mode === "signin" && <><p className="muted small" style={{ textAlign: "center", marginBottom: 0 }}>{l.passkeyDivider}</p><button type="button" className="btn" disabled={busy} onClick={passkeySignIn}>{l.passkey}</button><p className="muted small">{l.passkeyHint}</p></>}
      </div>
      <p className="small muted" style={{ textAlign: "center", marginTop: 18 }}>{l.privacyBefore}<Link href="/privacy">{l.privacyLink}</Link>.</p>
    </main></div></div>;
}

function LoginFallback() { return <div className="wrap">{useT().common.loading}</div>; }

export default function LoginPage() { return <Suspense fallback={<LoginFallback />}><LoginForm /></Suspense>; }
