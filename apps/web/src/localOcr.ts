import { billOcrReadable, nextPenalty, OCR_MAX_PAGES, OLLAMA_URL, ocrRepetitive, ocrSize, TYPHOON_MODEL, TYPHOON_PROMPT, typhoonOptions, typhoonText } from '@buddy/core';

/**
 * อ่านบิลแบบผสม (เจ้าของ 18/11/2569 เลือก "ข"): อ่านภาพในเครื่องนี้ด้วย Typhoon-OCR ผ่าน Ollama (http://localhost:11434)
 * แล้วส่งเฉพาะข้อความให้ Claude จัดร่าง — ภาพไม่ออกจากเครื่อง · ใช้ไม่ได้ (ไม่มี Ollama/โมเดล/เบราว์เซอร์ไม่ให้ต่อ/อ่านไม่ชัด) → Claude อ่านภาพตามเดิม
 * เปิด/ปิดต่อเบราว์เซอร์ (localStorage) ที่หน้า เริ่มระบบ › AI อ่านบิล — ค่าเริ่มต้นปิด (เครื่องที่ไม่มี Ollama จะได้ไม่ต้องลองต่อทุกครั้ง)
 */
const PREF = 'buddy.ai.localOcr';
export function localOcrOn(): boolean {
  try { return localStorage.getItem(PREF) === '1'; } catch { return false; }
}
export function setLocalOcrOn(on: boolean) {
  try { if (on) localStorage.setItem(PREF, '1'); else localStorage.removeItem(PREF); } catch { /* เบราว์เซอร์ไม่ให้เก็บ — ใช้ค่าเริ่มต้น */ }
}

export type OllamaCheck = { ok: boolean; model: boolean; message: string };
/** ตรวจว่าเครื่องนี้ต่อ Ollama ได้ และมีโมเดล Typhoon-OCR */
export async function checkOllama(timeoutMs = 3000): Promise<OllamaCheck> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { ok: false, model: false, message: `Ollama ตอบ ${r.status} — ตรวจว่าตั้ง OLLAMA_ORIGINS ให้โปรแกรมนี้แล้ว` };
    const tags = (await r.json()) as { models?: Array<{ name: string }> };
    const has = (tags.models ?? []).some((m) => m.name === TYPHOON_MODEL || m.name.startsWith(`${TYPHOON_MODEL}:`));
    return has ? { ok: true, model: true, message: `พบ Ollama และโมเดล ${TYPHOON_MODEL}` }
      : { ok: true, model: false, message: `พบ Ollama แต่ยังไม่มีโมเดล — เปิด PowerShell พิมพ์ ollama pull ${TYPHOON_MODEL}` };
  } catch (e) {
    const timeout = (e as Error).name === 'TimeoutError';
    return { ok: false, model: false, message: timeout ? 'ต่อ Ollama ไม่ได้ (หมดเวลา) — เปิดโปรแกรม Ollama ในเครื่องนี้'
      : 'ต่อ Ollama ในเครื่องนี้ไม่ได้ — เปิดโปรแกรม Ollama · ตั้ง OLLAMA_ORIGINS · และกดอนุญาตเมื่อเบราว์เซอร์ถามเรื่องเข้าถึงอุปกรณ์/แอปในเครื่อง' };
  }
}

/** ภาพหรือ PDF → PNG base64 ทีละหน้า (ด้านยาว 1800 px · ไม่เกิน 5 หน้า) */
async function pagesOf(file: File): Promise<string[]> {
  const toPng = (src: CanvasImageSource, w: number, h: number) => {
    const z = ocrSize(w, h), c = document.createElement('canvas');
    c.width = z.width; c.height = z.height;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').replace(/^data:[^,]*,/, '');
  };
  if (file.type !== 'application/pdf') {
    const bmp = await createImageBitmap(file);
    try { return [toPng(bmp, bmp.width, bmp.height)]; } finally { bmp.close(); }
  }
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const out: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, OCR_MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const v1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: ocrSize(v1.width, v1.height).scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      out.push(c.toDataURL('image/png').replace(/^data:[^,]*,/, ''));
    }
    return out;
  } finally { void doc.destroy(); }
}

/** อ่าน 1 หน้า: โมเดลวนพิมพ์ซ้ำ (Ollama แจ้ง repeat / ตัดที่ num_predict / บรรทัดซ้ำ) → ลองใหม่ด้วยค่าลงโทษคำซ้ำ 1.25 แล้ว 1.4 */
async function ocrPage(png: string, penalty = 1.1): Promise<string> {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(300_000),
    body: JSON.stringify({ model: TYPHOON_MODEL, stream: false, messages: [{ role: 'user', content: TYPHOON_PROMPT, images: [png] }], options: typhoonOptions(penalty) }),
  });
  const more = nextPenalty(penalty);
  if (!r.ok) {
    const msg = (await r.text()).slice(0, 200);
    if (more && /repeat/i.test(msg)) return ocrPage(png, more);
    throw new Error(`Ollama ${r.status} ${msg}`);
  }
  const j = (await r.json()) as { message?: { content?: string }; done_reason?: string };
  const text = j.message?.content ?? '';
  if (more && (j.done_reason === 'length' || ocrRepetitive(text))) return ocrPage(png, more);
  return text;
}

export type LocalRead = { text: string; pages: number; ms: number };
/** อ่านทั้งแฟ้มในเครื่อง → ข้อความล้วน · อ่านไม่ชัด (เกณฑ์ billOcrReadable) = โยนข้อผิดพลาดให้ใช้ Claude อ่านภาพ */
export async function readBillLocally(file: File, onStep?: (s: string) => void): Promise<LocalRead> {
  const t0 = performance.now();
  onStep?.('กำลังเตรียมภาพ…');
  const pages = await pagesOf(file);
  const parts: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    onStep?.(`กำลังอ่านในเครื่องนี้ หน้า ${i + 1}/${pages.length}…`);
    parts.push(await ocrPage(pages[i]!));
  }
  const text = typhoonText(parts.join('\n\n'));
  if (!billOcrReadable(text)) throw new Error('อ่านในเครื่องได้ไม่ชัด');
  return { text, pages: pages.length, ms: Math.round(performance.now() - t0) };
}
