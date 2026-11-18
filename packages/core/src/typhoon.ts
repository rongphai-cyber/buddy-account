/**
 * อ่านบิลแบบผสม (เจ้าของ 18/11/2569 เลือก "ข"): Typhoon-OCR 1.5 (SCB 10X · Apache-2.0) อ่านภาพในเครื่องผู้ใช้ผ่าน Ollama
 * แล้วส่งเฉพาะข้อความให้ Claude จัดร่างบิล — ภาพไม่ออกจากเครื่อง · เครื่องที่ไม่มี Ollama ใช้ Claude อ่านภาพตามเดิม
 * ต้นแบบ: WTS-App tools/taxlaw-crawl.mjs + cloudflare/taxlaw.mjs (ใช้จริง 17/11/2569 ขยะ 0–2% ราว 5 วินาที/หน้า)
 * คำสั่ง (prompt) ต้องเป็นของทางการตรงตัวทุกตัวอักษร — โมเดลฝึกมากับคำสั่งนี้เท่านั้น
 */
export const TYPHOON_MODEL = 'scb10x/typhoon-ocr1.5-3b';
export const OLLAMA_URL = 'http://localhost:11434';
/** ด้านยาวของภาพที่ส่งให้โมเดล (px) — เท่ากับต้นแบบ */
export const OCR_LONG_SIDE = 1800;
/** อ่านไม่เกินกี่หน้าต่อแฟ้ม (บิลปกติ 1–2 หน้า) */
export const OCR_MAX_PAGES = 5;
export const TYPHOON_PROMPT = "Extract all text from the image.\n\n\nInstructions:\n- Only return the clean Markdown.\n- Do not include any explanation or extra text.\n- You must include all information on the page.\n\n\nFormatting Rules:\n- Tables: Render tables using <table>...</table> in clean HTML format.\n- Equations: Render equations using LaTeX syntax with inline ($...$) and block ($$...$$).\n- Images/Charts/Diagrams: Wrap any clearly defined visual areas (e.g. charts, diagrams, pictures) in:\n\n\n<figure>\nDescribe the image's main elements (people, objects, text), note any contextual clues (place, event, culture), mention visible text and its meaning, provide deeper analysis when relevant (especially for financial charts, graphs, or documents), comment on style or architecture if relevant, then give a concise overall summary. Describe in Thai.\n</figure>\n\n\n- Page Numbers: Wrap page numbers in <page_number>...</page_number> (e.g., <page_number>14</page_number>).\n- Checkboxes: Use ☐ for unchecked and ☑ for checked boxes.\n    ";

/** ค่าตั้งของการเรียก /api/chat — penalty เริ่ม 1.1 · โมเดลวนพิมพ์ซ้ำ ลองใหม่ 1.25 แล้ว 1.4 */
export function typhoonOptions(penalty = 1.1) {
  return { temperature: 0.1, top_p: 0.6, repeat_penalty: penalty, num_ctx: 12288, num_predict: 6000 };
}
export function nextPenalty(p: number): number | null { return p < 1.2 ? 1.25 : p < 1.4 ? 1.4 : null; }

/** ขนาดภาพที่ส่งให้โมเดล: ด้านยาว 1800 px (ขยายไม่เกิน 2 เท่า สำหรับภาพเล็ก) */
export function ocrSize(w: number, h: number, long = OCR_LONG_SIDE): { width: number; height: number; scale: number } {
  const scale = Math.min(2, long / Math.max(w, h, 1));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', '#39': "'" };
/** ผลจาก Typhoon (Markdown + ตาราง HTML) → ข้อความล้วน: ตัดคำบรรยายภาพ/เลขหน้า · ตารางแถวละบรรทัด คั่นช่องด้วย " | " · เลขไทยเป็นเลขอารบิก */
export function typhoonText(md: string | null | undefined): string {
  const t = String(md ?? '')
    .replace(/<figure>[\s\S]*?<\/figure>/gi, '')
    .replace(/<page_number>[\s\S]*?<\/page_number>/gi, '')
    .replace(/<\/t[dh]>\s*(?=<t[dh][\s>])/gi, ' | ')
    .replace(/<\/tr>|<br\s*\/?>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (_, k: string) => ENT[k]!)
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/^```[a-z]*\s*$/gim, '')
    .replace(/[ \t]+\n/g, '\n');
  return t.replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50)).replace(/\u0e4d\u0e32/g, '\u0e33').replace(/\r/g, '')
    .split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000);
}

/** โมเดลวนพิมพ์ซ้ำ: บรรทัดเดียวกันซ้ำตั้งแต่ 8 ครั้ง และเป็นเกินครึ่งของบรรทัดทั้งหมด */
export function ocrRepetitive(s: string): boolean {
  const lines = String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 8) return false;
  const n = new Map<string, number>();
  for (const l of lines) n.set(l, (n.get(l) ?? 0) + 1);
  const top = Math.max(...n.values());
  return top >= 8 && top * 2 > lines.length;
}

/**
 * ผล OCR ของบิลใช้ได้ไหม (ไม่ผ่าน = ให้ Claude อ่านภาพแทน): มีตัวหนังสือพอ (ไทย+อังกฤษ ≥ 20) มีตัวเลข
 * ตัวอักษรแปลก (ไม่ใช่ ไทย อังกฤษ ตัวเลข เว้นวรรค เครื่องหมายทั่วไป) ไม่เกิน 10% และไม่วนซ้ำ
 * (ต้นแบบ typhoonReadable ใช้กับตัวบทกฎหมายที่ไทยต้องมาก — บิลสั้น/มีอังกฤษมาก จึงใช้เกณฑ์นี้แทน)
 */
export function billOcrReadable(s: string | null | undefined): boolean {
  const t = String(s ?? '');
  const letters = (t.match(/[ก-๙A-Za-z]/g) ?? []).length;
  if (letters < 20 || !/[0-9]/.test(t)) return false;
  const visible = t.replace(/\s/g, '');
  const odd = visible.replace(/[ก-๙A-Za-z0-9.,:;\-–—_/\\()\[\]{}#%&*+=|'"!?@$<>~^`\u00b0\u00d7\u00f7\u00b7\u2022\u25cf\u2610\u2611\u2018\u2019\u201c\u201d]/g, '').length;
  return odd <= visible.length * 0.1 && !ocrRepetitive(t);
}
