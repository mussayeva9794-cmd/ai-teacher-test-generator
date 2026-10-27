"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { serverMessage } from "@/lib/i18n/server-message";
import { useT } from "../i18n-provider";

export const SOURCE_LIMIT = 12000;

type Props = {
  text: string; setText: (value: string) => void;
  title: string; setTitle: (value: string) => void;
  pages: string; setPages: (value: string) => void;
  url: string; setUrl: (value: string) => void;
  disabled: boolean;
};

/** Lesson material for generation: pasted text, a PDF read in the browser, or page photos read by AI. */
export function SourceMaterial({ text, setText, title, setTitle, pages, setPages, url, setUrl, disabled }: Props) {
  const t = useT();
  const c = t.create;
  const [reading, setReading] = useState<"" | "pdf" | "photo">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  function append(extracted: string) {
    const joined = text.trim() ? `${text.trim()}\n\n${extracted}` : extracted;
    setText(joined.slice(0, SOURCE_LIMIT));
    return joined.length > SOURCE_LIMIT;
  }

  async function readPdf(file: File) {
    setReading("pdf"); setError(""); setNote("");
    try {
      const { pdfText } = await import("@/lib/pdf-text");
      const result = await pdfText(file, SOURCE_LIMIT);
      if (!result.text.trim()) { setError(c.pdfNoText); return; }
      const cut = append(result.text) || result.truncated;
      if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, "").slice(0, 180));
      setNote(cut ? c.sourceCut(SOURCE_LIMIT) : c.pdfRead(result.pages));
    } catch {
      setError(c.pdfFailed);
    } finally { setReading(""); }
  }

  async function readPhotos(files: File[]) {
    if (files.length > 3) { setError(c.photoTooMany); return; }
    setReading("photo"); setError(""); setNote("");
    try {
      const { photoDataUrl } = await import("@/lib/image-resize");
      const images = await Promise.all(files.map(photoDataUrl));
      const { text: extracted } = await api<{ text: string }>("/api/sources/ocr", { method: "POST", body: JSON.stringify({ images }) });
      setNote(append(extracted) ? c.sourceCut(SOURCE_LIMIT) : c.photoRead);
    } catch (cause) {
      setError(serverMessage(t, cause instanceof Error ? cause.message : "", c.photoFailed));
    } finally { setReading(""); }
  }

  const busy = disabled || Boolean(reading);
  return <div className="stack source-material">
    <div className="row source-head"><span className="field" style={{ margin: 0 }}>{c.source}</span><div className="row source-actions">
      <button type="button" className="btn" disabled={busy} onClick={() => pdfInput.current?.click()}>{reading === "pdf" ? c.pdfReading : c.pdfUpload}</button>
      <button type="button" className="btn" disabled={busy} onClick={() => photoInput.current?.click()}>{reading === "photo" ? c.photoReading : c.photoUpload}</button>
    </div></div>
    <input ref={pdfInput} type="file" accept="application/pdf" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void readPdf(file); }} />
    <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => { const files = [...(e.target.files || [])]; e.target.value = ""; if (files.length) void readPhotos(files); }} />
    <p className="muted small" style={{ margin: 0 }}>{c.sourceHint}</p>
    {error && <p className="error small" role="alert">{error}</p>}
    {note && <p className="success small" role="status">{note}</p>}
    <label className="field"><span className="sr-only">{c.source}</span><textarea value={text} onChange={e => setText(e.target.value)} placeholder={c.sourcePlaceholder} maxLength={SOURCE_LIMIT} disabled={reading !== ""} /></label>
    {text.trim() && <><label className="field">{c.sourceTitle}<input value={title} onChange={e => setTitle(e.target.value)} placeholder={c.sourceTitlePlaceholder} maxLength={180} /></label><div className="grid cols-2"><label className="field">{c.sourcePages}<input value={pages} onChange={e => setPages(e.target.value)} placeholder={c.sourcePagesPlaceholder} maxLength={120} /></label><label className="field">{c.sourceUrl}<input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." maxLength={500} /></label></div><p className="small muted">{c.sourceNote}</p></>}
  </div>;
}
