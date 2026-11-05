/**
 * ที่อยู่แยกช่อง + จังหวัด/อำเภอ/ตำบลของทางราชการ + รหัสไปรษณีย์ (docs/18 ข้อ 12 · เจ้าของ 05/11/2569)
 * ตรรกะเดียวกับ WtsAddr ของทุกโปรแกรม WTS (E:/WTS-App/สำนักงานบัญชี/cloudflare/addr-th.js) + ค้นจากรหัสไปรษณีย์
 * ข้อมูลอยู่ใน geo-th-data.ts (ใหญ่ ~230 KB) — หน้าจอโหลดแบบ lazy
 */
import { GEO_TH_RAW, GEO_ZIP_RAW } from './geo-th-data.js';

export interface GeoItem { code: string; th: string; en: string }
export interface GeoTambon { tamb: GeoItem; amph: GeoItem; prov: GeoItem; zip: string | null; partial: boolean }
/** ช่องที่อยู่แยก — ชื่อคอลัมน์เดียวกับฐานข้อมูล (addr_*) */
export interface AddrParts {
  addr_no?: string | null; addr_moo?: string | null; addr_village?: string | null; addr_building?: string | null;
  addr_room?: string | null; addr_floor?: string | null; addr_soi?: string | null; addr_road?: string | null;
  addr_geo_code?: string | null; zip_code?: string | null;
}
export const ADDR_PART_KEYS = ['addr_no', 'addr_moo', 'addr_village', 'addr_building', 'addr_room', 'addr_floor', 'addr_soi', 'addr_road', 'addr_geo_code'] as const;
export const ADDR_TEXT_FIELDS: ReadonlyArray<readonly [keyof AddrParts, string, number]> = [
  ['addr_no', 'เลขที่', 20], ['addr_moo', 'หมู่ที่', 20], ['addr_village', 'หมู่บ้าน', 100], ['addr_building', 'อาคาร', 40],
  ['addr_room', 'ห้องเลขที่', 20], ['addr_floor', 'ชั้นที่', 20], ['addr_soi', 'ซอย', 100], ['addr_road', 'ถนน', 100],
];

let GEO: { byCode: Map<string, GeoItem>; provinces: GeoItem[]; amphurs: Map<string, GeoItem[]>; tambons: Map<string, GeoItem[]> } | null = null;
let ZIP: Map<string, { zip: string; partial: boolean }> | null = null;
let BYZIP: Map<string, string[]> | null = null;
const byTh = (a: GeoItem, b: GeoItem) => a.th.localeCompare(b.th, 'th');

function data() {
  if (GEO) return GEO;
  const g = { byCode: new Map<string, GeoItem>(), provinces: [] as GeoItem[], amphurs: new Map<string, GeoItem[]>(), tambons: new Map<string, GeoItem[]>() };
  for (const rec of GEO_TH_RAW.split('~')) {
    const [code, th, en] = rec.split('|');
    const it = { code: code!, th: th!, en: en ?? '' };
    g.byCode.set(it.code, it);
    const push = (m: Map<string, GeoItem[]>, k: string) => { const l = m.get(k); if (l) l.push(it); else m.set(k, [it]); };
    if (it.code.slice(2) === '0000') g.provinces.push(it);
    else if (it.code.slice(4) === '00') push(g.amphurs, it.code.slice(0, 2));
    else push(g.tambons, it.code.slice(0, 4));
  }
  g.provinces.sort(byTh);
  for (const l of g.amphurs.values()) l.sort(byTh);
  for (const l of g.tambons.values()) l.sort(byTh);
  return (GEO = g);
}
function zipMap() {
  if (ZIP) return ZIP;
  ZIP = new Map();
  for (const rec of GEO_ZIP_RAW.split('~')) {
    const [k, v] = rec.split('=');
    ZIP.set(k!, { zip: v!.slice(0, 5), partial: v!.endsWith('*') });
  }
  return ZIP;
}

export const geoProvinces = (): GeoItem[] => data().provinces;
export const geoAmphurs = (prov: string | null | undefined): GeoItem[] => data().amphurs.get(String(prov ?? '').slice(0, 2)) ?? [];
export const geoTambons = (amph: string | null | undefined): GeoItem[] => data().tambons.get(String(amph ?? '').slice(0, 4)) ?? [];
export const isBangkok = (code: string | null | undefined) => String(code ?? '').slice(0, 2) === '10';

/** รหัสตำบล 6 หลัก → ตำบล อำเภอ จังหวัด (ไม่ใช่ตำบลจริง = null) */
export function geoLookup(code6: string | null | undefined): GeoTambon | null {
  const c = String(code6 ?? '');
  if (!/^\d{6}$/.test(c) || c.slice(4) === '00') return null;
  const g = data();
  const tamb = g.byCode.get(c), amph = g.byCode.get(c.slice(0, 4) + '00'), prov = g.byCode.get(c.slice(0, 2) + '0000');
  if (!tamb || !amph || !prov) return null;
  const z = zipMap().get(c) ?? (zipMap().get(c.slice(0, 4)) ? { zip: zipMap().get(c.slice(0, 4))!.zip, partial: false } : null);
  return { tamb, amph, prov, zip: z?.zip ?? null, partial: z?.partial ?? false };
}

/**
 * รหัสไปรษณีย์ → ตำบลทั้งหมดที่ใช้รหัสนี้ (เรียงจังหวัด อำเภอ ตำบล) · ไม่พบ = []
 * หน้าจอ: ตำบลเดียว = เติมครบ · หลายตำบลอำเภอเดียว = เติมจังหวัด/อำเภอ แล้วให้เลือกตำบล · ข้ามอำเภอ = ให้เลือกจากรายการ "ตำบล · อำเภอ"
 */
export function geoByPostcode(zip: string | null | undefined): GeoTambon[] {
  const z = String(zip ?? '').replace(/\D/g, '');
  if (!/^\d{5}$/.test(z)) return [];
  if (!BYZIP) {
    BYZIP = new Map();
    for (const [code] of data().byCode) {
      if (code.slice(4) === '00') continue;
      const g = geoLookup(code);
      if (!g?.zip) continue;
      const l = BYZIP.get(g.zip); if (l) l.push(code); else BYZIP.set(g.zip, [code]);
    }
  }
  return (BYZIP.get(z) ?? []).map((c) => geoLookup(c)!).sort((a, b) => byTh(a.prov, b.prov) || byTh(a.amph, b.amph) || byTh(a.tamb, b.tamb));
}

/** ผลการกรอกรหัสไปรษณีย์: ส่วนที่เติมได้แน่นอน + ตัวเลือกที่เหลือ (ไม่เดา) */
export function geoFromPostcode(zip: string | null | undefined): { found: boolean; prov: string; amph: string; tamb: string; choices: GeoTambon[] } {
  const list = geoByPostcode(zip);
  if (!list.length) return { found: false, prov: '', amph: '', tamb: '', choices: [] };
  const one = <K extends 'prov' | 'amph'>(k: K) => (new Set(list.map((x) => x[k].code)).size === 1 ? list[0]![k].code : '');
  const prov = one('prov'), amph = prov ? one('amph') : '';
  return { found: true, prov, amph, tamb: list.length === 1 ? list[0]!.tamb.code : '', choices: list.length === 1 ? [] : list };
}

const t = (v: unknown) => String(v ?? '').trim();
/** ส่วนบ้านเลขที่ถึงถนน (ภาษาไทย) */
function housePart(a: AddrParts): string {
  const soi = t(a.addr_soi).replace(/^ซอย\s*/, '');
  return [
    t(a.addr_no), t(a.addr_moo) ? 'หมู่ ' + t(a.addr_moo).replace(/^หมู่(ที่)?\s*/, '') : '',
    t(a.addr_village) ? 'หมู่บ้าน' + t(a.addr_village).replace(/^หมู่บ้าน/, '') : '',
    t(a.addr_building) ? 'อาคาร' + t(a.addr_building).replace(/^อาคาร/, '') : '',
    t(a.addr_room) ? 'ห้อง ' + t(a.addr_room).replace(/^ห้อง(เลขที่)?\s*/, '') : '', t(a.addr_floor) ? 'ชั้น ' + t(a.addr_floor).replace(/^ชั้น(ที่)?\s*/, '') : '',
    soi ? 'ซอย' + (/^\d/.test(soi) ? ' ' : '') + soi : '',
    t(a.addr_road) ? 'ถนน' + t(a.addr_road).replace(/^ถนน/, '') : '',
  ].filter(Boolean).join(' ');
}
/** กรุงเทพ: แขวง… เขต… กรุงเทพมหานคร · ต่างจังหวัด: ตำบล… อำเภอ… จังหวัด… */
function geoParts(g: GeoTambon | null): [string, string, string] {
  if (!g) return ['', '', ''];
  const bkk = isBangkok(g.prov.code);
  return [(bkk ? 'แขวง' : 'ตำบล') + g.tamb.th, bkk ? g.amph.th : 'อำเภอ' + g.amph.th, bkk ? g.prov.th : 'จังหวัด' + g.prov.th];
}

/** ที่อยู่ภาษาไทยบรรทัดเดียว (รวมรหัสไปรษณีย์) */
export function composeAddrTh(a: AddrParts): string {
  const [tb, am, pv] = geoParts(geoLookup(a.addr_geo_code));
  const zip = /^\d{5}$/.test(t(a.zip_code)) ? t(a.zip_code) : '';
  return [housePart(a), tb, am, pv, zip].filter(Boolean).join(' ');
}
/**
 * ที่อยู่ 3 บรรทัดแบบ Express (address_1..3 ≤ 100 ตัวอักษร · รหัสไปรษณีย์อยู่ช่องแยก)
 * บรรทัด 1 บ้านเลขที่–ถนน · บรรทัด 2 ตำบล อำเภอ · บรรทัด 3 จังหวัด
 */
export function composeAddrLines(a: AddrParts): [string, string, string] {
  const [tb, am, pv] = geoParts(geoLookup(a.addr_geo_code));
  const cut = (s: string) => s.slice(0, 100);
  return [cut(housePart(a)), cut([tb, am].filter(Boolean).join(' ')), cut(pv)];
}
/** ภาษาอังกฤษ — เฉพาะส่วนที่มีชื่อทางการ (ตำบล อำเภอ จังหวัด) + เลขที่/หมู่ · ซอย ถนน หมู่บ้าน อาคาร ไม่แปลเอง */
export function composeAddrEn(a: AddrParts): string {
  const g = geoLookup(a.addr_geo_code);
  if (!g) return '';
  const first = [t(a.addr_no), t(a.addr_moo) ? 'Moo ' + t(a.addr_moo) : ''].filter(Boolean).join(' ');
  const zip = /^\d{5}$/.test(t(a.zip_code)) ? ' ' + t(a.zip_code) : '';
  return [first, isBangkok(g.prov.code) ? g.tamb.en : g.tamb.en + ' Subdistrict', g.amph.en + ' District', g.prov.en + zip].filter(Boolean).join(', ');
}
/** มีช่องที่ระบบแปลอังกฤษให้ไม่ได้ (ผู้ใช้ต้องเติมเอง) */
export const addrEnNeedsUser = (a: AddrParts) => [a.addr_village, a.addr_building, a.addr_soi, a.addr_road].some((v) => t(v));
/** มีข้อมูลแยกช่องอย่างน้อย 1 ช่อง */
export const hasAddrParts = (a: AddrParts) => ADDR_PART_KEYS.some((k) => t(a[k]));

function strip(s: string, lv: 'P' | 'A' | 'T') {
  let v = String(s || '').replace(/\s+/g, '');
  if (lv === 'P') { v = v.replace(/^(จังหวัด|จ\.)/, ''); if (/^(กรุงเทพ|กทม)/.test(v)) v = 'กรุงเทพมหานคร'; }
  if (lv === 'A') v = v.replace(/^(อำเภอ|อ\.|เขต)/, '');
  if (lv === 'T') v = v.replace(/^(ตำบล|ต\.|แขวง)/, '');
  return v;
}
/** จับคู่ชื่อกับรายการทางการทีละระดับ — คืนเฉพาะระดับที่ตรงพอดี 1 รายการ ไม่เดา (กติกาเดียวกับ Payroll) */
export function geoMatchNames(pn: string, an: string, tn: string): { prov: string; amph: string; tamb: string } {
  const out = { prov: '', amph: '', tamb: '' };
  const p = strip(pn, 'P'), a = strip(an, 'A'), tt = strip(tn, 'T');
  const pr = p ? geoProvinces().filter((x) => x.th === p) : [];
  if (pr.length !== 1) return out;
  out.prov = pr[0]!.code;
  if (!a) return out;
  const list = geoAmphurs(out.prov);
  let am = list.filter((x) => strip(x.th, 'A') === a);
  if (!am.length && a === 'เมือง' && !isBangkok(out.prov)) {
    am = list.filter((x) => x.th === 'เมือง' + pr[0]!.th);
    if (!am.length) am = list.filter((x) => x.code.slice(2, 4) === '01');
  }
  if (am.length !== 1) return out;
  out.amph = am[0]!.code;
  if (!tt) return out;
  const tm = geoTambons(out.amph).filter((x) => x.th === tt);
  if (tm.length === 1) out.tamb = tm[0]!.code;
  return out;
}

/**
 * แยกข้อความที่อยู่เดิม (เช่น ที่ย้ายจาก Express) เป็นช่อง — ตัวช่วยเติมเท่านั้น ผู้ใช้ตรวจเองเสมอ
 * จับคู่ตำบล/อำเภอ/จังหวัดไม่ได้ = เว้นว่าง (ไม่เดา) · มีรหัสไปรษณีย์แต่ไม่มีชื่อ = ใช้รหัสไปรษณีย์ช่วยเฉพาะเมื่อชี้ตำบลเดียว
 */
export function parseAddrText(text: string, zipHint?: string | null): AddrParts & { prov_code: string; amph_code: string } {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const pick = (re: RegExp) => { const m = s.match(re); return m ? m[1]!.trim() : ''; };
  const zips = s.match(/(?:^|\D)(\d{5})(?!\d)/g) || [];
  let prov = pick(/(?:จังหวัด|จ\.)\s*([^\s,\d]+)/);
  if (!prov && /กรุงเทพ|กทม/.test(s)) prov = 'กรุงเทพมหานคร';
  if (/^กรุงเทพ/.test(prov)) prov = 'กรุงเทพมหานคร';
  const zip = t(zipHint).replace(/\D/g, '').slice(0, 5) || (zips.length ? zips[zips.length - 1]!.replace(/\D/g, '') : '');
  const m = geoMatchNames(prov, pick(/(?:อำเภอ|เขต|อ\.)\s*([^\s,\d]+)/), pick(/(?:ตำบล|แขวง|ต\.)\s*([^\s,\d]+)/));
  let geo = m.tamb, provCode = m.prov, amphCode = m.amph;
  if (!geo) {
    const z = geoFromPostcode(zip);
    if (z.tamb && (!provCode || z.prov === provCode) && (!amphCode || z.amph === amphCode)) { geo = z.tamb; provCode = z.prov; amphCode = z.amph; }
  }
  return {
    addr_no: pick(/^(?:บ้านเลขที่|เลขที่)?\s*(\d+(?:\/\d+)*)/) || null,
    addr_moo: pick(/(?:หมู่ที่|หมู่|ม\.)\s*(\d+)/) || null,
    addr_soi: pick(/(?:ซอย|ซ\.)\s*([^\s,]+)/) || null,
    addr_road: pick(/(?:ถนน|ถ\.)\s*([^\s,]+)/) || null,
    addr_geo_code: geo || null, zip_code: zip || null, prov_code: provCode, amph_code: amphCode,
  };
}
