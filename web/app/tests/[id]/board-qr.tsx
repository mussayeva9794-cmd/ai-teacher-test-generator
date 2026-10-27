"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useT } from "../../i18n-provider";

/** A large QR code of a test link to show on the classroom board. */
export function BoardQr({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const p = useT().testPage;
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#100c08", light: "#ffffff" } })
      .then(markup => { if (active) setSvg(markup); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url]);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <div className="qr-overlay" role="dialog" aria-modal="true" aria-label={p.qrTitle} tabIndex={-1} ref={dialog} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="qr-card">
      <div className="eyebrow">{p.qrTitle}</div>
      <h2>{title}</h2>
      {failed ? <p className="error">{p.qrFailed}</p> : <div className="qr-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />}
      <p className="qr-url">{url}</p>
      <p className="muted small">{p.qrHint}</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn" onClick={() => void dialog.current?.requestFullscreen?.().catch(() => undefined)}>{p.qrFullscreen}</button>
        <button className="btn primary" onClick={onClose}>{p.qrClose}</button>
      </div>
    </div>
  </div>;
}
