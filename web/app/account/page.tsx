"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { deletePasskey, listPasskeys, registerPasskey } from "@/lib/passkeys";
import { serverMessage } from "@/lib/i18n/server-message";
import { Brand } from "../brand";
import { useI18n } from "../i18n-provider";
import { LanguageSwitcher } from "../language-switcher";

type Passkey = Awaited<ReturnType<typeof listPasskeys>>[number];

export default function AccountPage() {
  const router = useRouter();
  const { t, intl } = useI18n();
  const a = t.account;
  const [email, setEmail] = useState("");
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const auth = browserClient().auth;
    auth.getUser().then(async ({ data, error: authError }) => {
      if (!active) return;
      if (authError || !data.user) {
        router.replace("/login?next=/account");
        return;
      }
      setEmail(data.user.email || "");
      try {
        const items = await listPasskeys(auth);
        if (active) setPasskeys(items);
      } catch (cause) {
        if (active) setError(serverMessage(t, cause instanceof Error ? cause.message : "", a.loadFailed));
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [router]);

  async function addPasskey() {
    setBusy(true); setError(""); setMessage("");
    try {
      const auth = browserClient().auth;
      await registerPasskey(auth);
      setPasskeys(await listPasskeys(auth));
      setMessage(a.addedMessage);
    } catch (cause) {
      setError(serverMessage(t, cause instanceof Error ? cause.message : "", a.addFailed));
    } finally { setBusy(false); }
  }

  async function removePasskey(passkeyId: string) {
    if (!window.confirm(a.confirmRemove)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const auth = browserClient().auth;
      await deletePasskey(auth, passkeyId);
      setPasskeys(await listPasskeys(auth));
      setMessage(a.removedMessage);
    } catch (cause) {
      setError(serverMessage(t, cause instanceof Error ? cause.message : "", a.removeFailed));
    } finally { setBusy(false); }
  }

  return <div className="wrap"><header className="topbar"><Brand /><LanguageSwitcher /><Link className="btn ghost" href="/">{t.common.home}</Link></header>
    <main className="panel stack" style={{ maxWidth: 680, margin: "8vh auto" }}>
      <div className="eyebrow">{a.eyebrow}</div><h1>{a.title}</h1>
      <p className="muted">{email || a.loadingAccount}</p>
      <p>{a.intro}</p>
      <p className="muted small">{a.hint}</p>
      {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
      <button className="btn primary" onClick={addPasskey} disabled={busy || loading}>{busy ? t.common.wait : a.add}</button>
      <h2>{a.mine}</h2>
      {loading ? <p className="muted">{a.loading}</p> : passkeys.length ? passkeys.map(item => <div className="list-item row" key={item.id}><div><b>{item.friendly_name || a.defaultName}</b><p className="muted small">{a.addedOn(new Date(item.created_at).toLocaleDateString(intl))}</p></div><button className="btn" disabled={busy} onClick={() => removePasskey(item.id)}>{a.remove}</button></div>) : <p className="muted">{a.empty}</p>}
    </main></div>;
}
