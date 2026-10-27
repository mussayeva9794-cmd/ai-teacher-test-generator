"use client";

import { useEffect, useState } from "react";
import { useT } from "./i18n-provider";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISSED = "mugalim_install_dismissed";

function readDismissed() {
  try { return window.localStorage.getItem(DISMISSED) === "1"; } catch { return false; }
}

/**
 * Offers to install the app: a button where the browser supports it (Android
 * Chrome), and the Share → Add to Home Screen steps on an iPhone or iPad.
 */
export function InstallHint() {
  const t = useT().install;
  const [mode, setMode] = useState<"" | "button" | "ios">("");
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone || readDismissed()) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (ios) { setMode("ios"); return; }
    const onPrompt = (prompt: Event) => { prompt.preventDefault(); setEvent(prompt as InstallEvent); setMode("button"); };
    const onInstalled = () => setMode("");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (!mode) return null;
  const dismiss = () => { try { window.localStorage.setItem(DISMISSED, "1"); } catch { /* private mode */ } setMode(""); };
  return <aside className="install-hint" aria-label={t.title}>
    <img src="/icon-192.png" alt="" width={44} height={44} />
    <div><b>{t.title}</b><p>{mode === "ios" ? t.ios : t.text}</p></div>
    <div className="install-actions">
      {mode === "button" && event && <button className="btn primary" onClick={() => { void event.prompt(); void event.userChoice.then(() => setMode("")); }}>{t.button}</button>}
      <button className="btn ghost" onClick={dismiss}>{t.dismiss}</button>
    </div>
  </aside>;
}
