"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { deletePasskey, listPasskeys, registerPasskey } from "@/lib/passkeys";

type Passkey = Awaited<ReturnType<typeof listPasskeys>>[number];

export default function AccountPage() {
  const router = useRouter();
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
        if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить ключи доступа.");
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
      setMessage("Ключ доступа добавлен. Теперь можно входить с Face ID / Touch ID или кодом устройства.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось добавить ключ доступа.");
    } finally { setBusy(false); }
  }

  async function removePasskey(passkeyId: string) {
    if (!window.confirm("Удалить этот ключ доступа? Вход с паролем останется доступен.")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const auth = browserClient().auth;
      await deletePasskey(auth, passkeyId);
      setPasskeys(await listPasskeys(auth));
      setMessage("Ключ доступа удалён.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось удалить ключ доступа.");
    } finally { setBusy(false); }
  }

  return <div className="wrap"><header className="topbar"><Link className="brand" href="/"><span className="brand-mark">A</span> AI Teacher</Link><Link className="btn ghost" href="/">На главную</Link></header>
    <main className="panel stack" style={{ maxWidth: 680, margin: "8vh auto" }}>
      <div className="eyebrow">Безопасность аккаунта</div><h1>Ключи доступа</h1>
      <p className="muted">{email || "Загружаем аккаунт..."}</p>
      <p>Подключите Face ID или Touch ID для быстрого входа. Устройство также может предложить свой код разблокировки. Отпечатки и изображения лица не передаются сайту.</p>
      <p className="muted small">Сначала подтвердите адрес электронной почты. Парольный вход остаётся запасным способом.</p>
      {error && <div className="error" role="alert">{error}</div>}{message && <div className="success" role="status">{message}</div>}
      <button className="btn primary" onClick={addPasskey} disabled={busy || loading}>{busy ? "Подождите..." : "Добавить ключ доступа"}</button>
      <h2>Мои ключи</h2>
      {loading ? <p className="muted">Загружаем...</p> : passkeys.length ? passkeys.map(item => <div className="list-item row" key={item.id}><div><b>{item.friendly_name || "Ключ доступа"}</b><p className="muted small">Добавлен {new Date(item.created_at).toLocaleDateString("ru-RU")}</p></div><button className="btn" disabled={busy} onClick={() => removePasskey(item.id)}>Удалить</button></div>) : <p className="muted">Ключей доступа пока нет.</p>}
    </main></div>;
}
