// Text of a PDF read in the teacher's browser; the file itself is never uploaded.

export type PdfText = { text: string; pages: number; truncated: boolean };

export async function pdfText(file: File, maxChars: number): Promise<PdfText> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs"),
  ]);
  // Run pdf.js on the main thread: no separate worker file has to be served.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loading.promise;
  try {
    let text = "";
    for (let number = 1; number <= document.numPages && text.length < maxChars; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const lines = content.items.map(item => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "")).join("");
      text += `${lines.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()}\n\n`;
    }
    const clean = text.trim();
    return { text: clean.slice(0, maxChars), pages: document.numPages, truncated: clean.length > maxChars };
  } finally {
    await loading.destroy();
  }
}
