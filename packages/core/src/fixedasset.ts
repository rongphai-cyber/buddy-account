import Decimal from 'decimal.js';
import { d, round2, type MoneyInput } from './money.js';
import { daysInMonth, isoDate } from './date.js';

/**
 * ค่าเสื่อมราคาทรัพย์สินถาวร (คู่มือบทที่ 19 S-FA-01/04) — สูตรเดียวกับ Express (ตรวจกับ FAMAS.DEPR1–12/1NY–12NY ของข้อมูลจริง)
 * - คิดรายวัน: ค่าเสื่อมต่อปีปัด 2 ตำแหน่ง ÷ 365 × จำนวนวันที่ใช้งานในเดือน (ปัด 2 ตำแหน่งทีละเดือน)
 * - เส้นตรง (1): ต่อปี = (ราคาทุน − ราคาซาก) × อัตรา · ยอดลด (2): ต่อปี = (ราคาทุน − ค่าเสื่อมสะสมต้นปี) × อัตรา
 * - รวมทั้งปี = ต่อวัน × วันใช้งานทั้งปี (ปัด) — เศษไปลงงวดสุดท้ายที่มีค่าเสื่อม · ไม่เกินมูลค่าคงเหลือหลังหักราคาซาก (หยุดเมื่อเหลือเท่าราคาซาก)
 * - เริ่มที่วันที่เริ่มใช้ (ไม่ใช่วันที่ซื้อ) · สิ้นสุดที่วันที่ขาย · คิดจนเหลือเท่าราคาซาก (ไม่หยุดที่วันครบอายุ) — เศษที่น้อยกว่าค่าเสื่อม 1 วันรวมในงวดนั้น
 * - ค่าเสื่อมที่คำนวณเอง (FAMAS.DPRAMT): ลงครั้งเดียวในงวดของ "คำนวณเองถึงวันที่" (ว่าง = งวดของวันที่เริ่มใช้) และหักออกจากฐานเส้นตรง
 *   — ตรวจกับข้อมูลจริง: ทุกรายการที่มี DPRAMT ใช้ฐาน (ทุน − ซาก − DPRAMT) × อัตรา
 * - คิดรายปี: ลงยอดทั้งปีในงวดสุดท้ายที่ใช้งาน
 */
export interface FaAssetInput {
  method: string; is_depreciable: boolean; cost: MoneyInput; salvage_value: MoneyInput; rate: MoneyInput; useful_life_years?: number | null;
  start_date: string; end_date?: string | null; sold_date?: string | null; depr_monthly: boolean; manual_depr?: MoneyInput; manual_depr_to?: string | null;
}

/** อัตราค่าเสื่อมต่อปี (%) — ว่างแต่มีอายุการใช้งาน = 100 ÷ อายุ */
export function faRate(a: Pick<FaAssetInput, 'rate' | 'useful_life_years'>): Decimal {
  const r = d(a.rate);
  if (!r.isZero()) return r;
  return a.useful_life_years ? new Decimal(100).div(a.useful_life_years).toDecimalPlaces(2) : r;
}
/** วันครบอายุ = วันที่เริ่มใช้ + อายุการใช้งาน (ปี) */
export function faEndDate(start: string, life: number | null | undefined): string | null {
  if (!life) return null;
  const [y, m, dd] = start.split('-').map(Number) as [number, number, number];
  const ny = y + Math.trunc(life);
  return isoDate(ny, m, Math.min(dd, daysInMonth(ny, m)));
}
/** ค่าเสื่อมต่อปีเบื้องต้น (ช่อง "ค่าเสื่อมเบื้องต้น" บนหน้าจอ) */
export function faAnnual(a: FaAssetInput, accumulatedBefore: MoneyInput = 0): Decimal {
  if (!a.is_depreciable || a.method === '0') return d(0);
  const r = faRate(a).div(100);
  const base = a.method === '2' ? d(a.cost).minus(d(accumulatedBefore)) : d(a.cost).minus(d(a.salvage_value)).minus(d(a.manual_depr));
  return round2(Decimal.max(base, 0).times(r));
}

const dayNo = (iso: string) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000);
const nextDay = (iso: string) => { const t = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + 1)); return t.toISOString().slice(0, 10); };

/**
 * ค่าเสื่อมรายเดือนของปีปฏิทิน year (12 ช่อง เป็นข้อความทศนิยม 2 ตำแหน่ง)
 * accumulatedBefore = ค่าเสื่อมสะสมทั้งหมดก่อนต้นปีนี้ (รวมยอดยกมา) · monthStarts = วันเริ่มงวด 1–12 ถ้าปีบัญชีไม่ตรงปีปฏิทิน
 */
export function faYearSchedule(a: FaAssetInput, year: number, accumulatedBefore: MoneyInput, monthStarts?: string[]): string[] {
  const zero = Array.from({ length: 12 }, () => '0.00');
  if (!a.is_depreciable || a.method === '0') return zero;
  const starts = monthStarts ?? Array.from({ length: 12 }, (_, i) => isoDate(year, i + 1, 1));
  const ends = starts.map((s, i) => (i < 11 ? isoDate(...prevDayParts(starts[i + 1]!)) : lastOfPeriod(s)));
  const yStart = starts[0]!, yEnd = ends[11]!;
  let left = d(a.cost).minus(d(a.salvage_value)).minus(d(accumulatedBefore));
  if (left.lte(0)) return zero;
  const out = starts.map(() => d(0));
  let from = a.start_date > yStart ? a.start_date : yStart;
  const to = a.sold_date && a.sold_date < yEnd ? a.sold_date : yEnd;
  // ค่าเสื่อมที่คำนวณเอง: ลงในงวดของวันที่คำนวณเองถึง (หรือวันที่เริ่มใช้) — ถ้าระบุวันที่ โปรแกรมคิดต่อจากวันถัดไป
  const manualAt = a.manual_depr_to ?? a.start_date;
  if (!d(a.manual_depr).isZero() && manualAt >= yStart && manualAt <= yEnd) {
    const m = ends.findIndex((e) => manualAt <= e);
    const v = Decimal.min(round2(a.manual_depr), left);
    out[m] = v; left = left.minus(v);
    if (a.manual_depr_to) from = nextDay(a.manual_depr_to) > from ? nextDay(a.manual_depr_to) : from;
  }
  if (from > to) return out.map((v) => v.toFixed(2));
  const daily = faAnnual(a, accumulatedBefore).div(365);
  const computed: number[] = [];
  let totalDays = 0, remain = left;
  for (let i = 0; i < 12; i++) {
    const lo = from > starts[i]! ? from : starts[i]!, hi = to < ends[i]! ? to : ends[i]!;
    const days = hi >= lo ? dayNo(hi) - dayNo(lo) + 1 : 0;
    if (!days) continue;
    totalDays += days;
    let v = Decimal.max(Decimal.min(round2(daily.times(days)), remain), 0);
    if (remain.minus(v).gt(0) && remain.minus(v).lt(round2(daily))) v = remain;   // เศษไม่ถึงค่าเสื่อม 1 วัน ลงงวดนี้ให้หมด
    out[i] = out[i]!.plus(v); remain = remain.minus(v);
    if (!v.isZero()) computed.push(i);
  }
  const total = Decimal.min(round2(daily.times(totalDays)), left);
  const got = left.minus(remain);
  const last = computed.at(-1);
  if (last !== undefined && !total.eq(got)) out[last] = out[last]!.plus(total.minus(got));
  if (!a.depr_monthly) {
    const sum = out.reduce((s, v) => s.plus(v), d(0));
    const lastUsed = ends.reduce((k, e, i) => (starts[i]! <= to ? i : k), 11);
    return out.map((_, i) => (i === lastUsed ? sum : d(0)).toFixed(2));
  }
  return out.map((v) => v.toFixed(2));
}
function prevDayParts(iso: string): [number, number, number] {
  const t = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) - 1));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}
function lastOfPeriod(start: string): string {
  const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  return isoDate(y, m, daysInMonth(y, m));
}

/** ตรวจข้อมูลทรัพย์สินก่อนบันทึก — ข้อความบอกวิธีแก้ */
export function faValidate(a: FaAssetInput & { purchase_date: string }): string | null {
  if (d(a.cost).lte(0)) return 'ป้อนราคาทุนมากกว่า 0';
  if (a.is_depreciable && a.method !== '0') {
    if (d(a.salvage_value).lt(1)) return 'ราคาซากต้องมีอย่างน้อย 1 บาท (ต้องมียอดคงเหลือในบัญชีทรัพย์สินเสมอ)';
    if (d(a.salvage_value).gte(d(a.cost))) return 'ราคาซากต้องน้อยกว่าราคาทุน';
    if (faRate(a).lte(0)) return 'ป้อนอายุการใช้งาน (ปี) หรืออัตราค่าเสื่อม (%)';
  }
  if (a.start_date < a.purchase_date) return 'วันที่เริ่มใช้ต้องไม่ก่อนวันที่ซื้อ';
  if (a.sold_date && a.sold_date < a.start_date) return 'วันที่ขายต้องไม่ก่อนวันที่เริ่มใช้';
  return null;
}
