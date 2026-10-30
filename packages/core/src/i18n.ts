/**
 * สลับ 2 ภาษา (ข้อกำหนดเจ้าของข้อ 9) — ตัวแปลข้อความไทย → อังกฤษจากพจนานุกรม
 * ข้อความในโค้ดเป็นภาษาไทยเหมือนเดิม (ต้นฉบับ) · พจนานุกรมสร้างจากแคตตาล็อก tools/i18n (extract.py)
 *  - ตรงตัว: "บันทึก" → "Save"
 *  - แบบมีช่องแทน: "บันทึกลูกค้า {0} แล้ว" → "Customer {0} saved" — ค่าที่แทนถ้าเป็นคำไทยในพจนานุกรมก็แปลด้วย
 * ไม่พบในพจนานุกรม = คืน null (คงภาษาไทย)
 */
export type I18nDict = Record<string, string>;
export interface Translator { tr(text: string): string | null; exact(key: string): string | null; size: number }

const TH = /[฀-๿]/;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Pattern { re: RegExp; slots: number[]; en: string; weight: number }
const MONTHS: Record<string, string> = { 'ม.ค.': 'Jan', 'ก.พ.': 'Feb', 'มี.ค.': 'Mar', 'เม.ย.': 'Apr', 'พ.ค.': 'May', 'มิ.ย.': 'Jun', 'ก.ค.': 'Jul', 'ส.ค.': 'Aug', 'ก.ย.': 'Sep', 'ต.ค.': 'Oct', 'พ.ย.': 'Nov', 'ธ.ค.': 'Dec' };

export function makeTranslator(dict: I18nDict): Translator {
  const exact = new Map<string, string>();
  const buckets = new Map<string, Pattern[]>();
  const loose: Pattern[] = [];
  for (const [thRaw, en] of Object.entries(dict)) {
    if (!en) continue;
    const th = squash(thRaw);
    if (!/\{\d+\}/.test(th)) { exact.set(th, en); continue; }
    if (th.includes('|')) continue;
    const parts = th.split(/(\{\d+\})/);
    const slots: number[] = [];
    let src = '^';
    for (const p of parts) {
      const m = /^\{(\d+)\}$/.exec(p);
      if (m) { slots.push(Number(m[1])); src += '(.+?)'; } else src += esc(p);   // ช่องว่างต้องมีจริง (รวมช่องว่างแล้ว) — ไม่ตัดกลางคำ
    }
    const literal = parts.filter((p) => !/^\{\d+\}$/.test(p)).join('');
    if (!TH.test(literal)) continue;                    // ช่องแทนล้วน — กว้างเกินไป
    const pat: Pattern = { re: new RegExp(src + '$', 's'), slots, en, weight: literal.length };
    const head = parts[0] ?? '';
    if (head.length >= 2) { const k = head.slice(0, 2); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(pat); } else loose.push(pat);
  }
  for (const list of buckets.values()) list.sort((a, b) => b.weight - a.weight);
  loose.sort((a, b) => b.weight - a.weight);

  /** ค่าในช่องแทนที่เป็นคำไทยแปลได้ก็แปล · แบบที่ข้อความคงที่สั้น (เช่น "บริษัท {0}") ถ้าค่าเป็นภาษาไทยที่แปลไม่ได้ = ข้อมูลของผู้ใช้ ไม่ใช้แบบนี้ */
  const fill = (p: Pattern, m: RegExpExecArray): string | null => {
    const vals = p.slots.map((_, i) => m[i + 1] ?? '');
    const done = vals.map((v) => (TH.test(v) ? exact.get(squash(v)) ?? null : v));
    if (p.weight < 8 && done.some((v) => v === null)) return null;
    return p.en.replace(/\{(\d+)\}/g, (_, n: string) => { const i = p.slots.indexOf(Number(n)); return i < 0 ? '' : done[i] ?? vals[i]!; });
  };
  const whole = (s: string): string | null => {
    const hit = exact.get(s);
    if (hit !== undefined) return hit;
    for (const p of buckets.get(s.slice(0, 2)) ?? []) { const m = p.re.exec(s); if (m) { const o = fill(p, m); if (o !== null) return o; } }
    for (const p of loose) { const m = p.re.exec(s); if (m) { const o = fill(p, m); if (o !== null) return o; } }
    return null;
  };
  /** ไม่ตรงทั้งข้อความ → ลองแยกส่วน: เส้นทางเมนู "ซื้อ › …", ตัวคั่น · —, คำนำหน้าเป็นเลข/สัญลักษณ์ "3 …" "🖨 …", เดือนย่อ "ม.ค. 2569" */
  const core = (s: string, depth = 0): string | null => {
    const w = whole(s);
    if (w !== null || depth > 2) return w;
    for (const sep of [' › ', ' · ', ' — ', ' | ', ' / ']) {
      if (!s.includes(sep)) continue;
      const parts = s.split(sep).map((x) => (TH.test(x) ? core(x.trim(), depth + 1) : x));
      if (parts.every((x) => x !== null)) return parts.join(sep);
    }
    const pre = /^([^\u0E00-\u0E7F\p{L}]+)(\S[\s\S]*)$/u.exec(s);
    if (pre) { const o = core(pre[2]!, depth + 1); if (o !== null) return pre[1] + o; }
    const suf = /^([\s\S]*?[\u0E00-\u0E7F)])([\s:*…?!.,]+|\s*\(\d+\))$/.exec(s);
    if (suf) { const o = core(suf[1]!, depth + 1); if (o !== null) return o + suf[2]; }
    const mon = /^([\u0E00-\u0E7F.]+)\s+(\d{2,4})$/.exec(s);
    if (mon && MONTHS[mon[1]!]) return `${MONTHS[mon[1]!]} ${mon[2]}`;
    return null;
  };
  return {
    size: exact.size + loose.length + [...buckets.values()].reduce((t, l) => t + l.length, 0),
    exact(key: string) { return exact.get(squash(key)) ?? null; },
    tr(text: string) {
      if (!TH.test(text)) return null;
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
      const out = core(squash(m[2]!));
      return out === null ? null : m[1] + out + m[3];
    },
  };
}
