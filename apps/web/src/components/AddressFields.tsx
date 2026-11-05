/**
 * ที่อยู่แยกช่อง + กรอกรหัสไปรษณีย์แล้วเติมจังหวัด/อำเภอ/ตำบลให้ (docs/18 ข้อ 12 · เจ้าของ 05/11/2569)
 * - รหัสไปรษณีย์มาก่อน: ตำบลเดียว = เติมครบ · หลายตำบล = เติมจังหวัด/อำเภอ แล้วเปิดรายการเฉพาะตำบลของรหัสนั้น · ไม่มีจริง = เตือนติดช่อง
 * - ไม่รู้รหัสไปรษณีย์: เลือกจังหวัด → อำเภอ → ตำบล แล้วเติมรหัสไปรษณีย์ให้
 * - ข้อความที่อยู่เดิม (ที่เอกสารพิมพ์ใช้) ประกอบให้เองจากช่องแยก — ถ้าผู้ใช้แก้ข้อความเองแล้วไม่ทับ (กด ↻ ประกอบใหม่ได้)
 * - Enter: ช่องที่เติมให้แล้ว (จังหวัด อำเภอ ข้อความที่อยู่) ข้ามไปเอง (data-navskip)
 * ข้อมูลท้องที่ ~230 KB โหลดเมื่อเปิดหน้าจอที่มีที่อยู่ครั้งแรก
 */
import { useEffect, useRef, useState } from 'react';
import { Field, toast } from '../ui';

type Geo = typeof import('@buddy/core/geo-th');
let geoP: Promise<Geo> | null = null;
const loadGeo = () => (geoP ??= import('@buddy/core/geo-th'));
function useGeo() {
  const [g, setG] = useState<Geo | null>(null);
  useEffect(() => { let on = true; loadGeo().then((m) => on && setG(m)).catch(() => toast('โหลดรายการจังหวัด/อำเภอ/ตำบลไม่สำเร็จ — รีเฟรชหน้าจอแล้วลองใหม่', 'bad')); return () => { on = false; }; }, []);
  return g;
}

type Vals = Record<string, unknown>;
/** ปลายทางข้อความที่อยู่: lines3 = address_1..3 (ลูกค้า ผู้จำหน่าย สถานที่ส่ง) · text = ช่องเดียว · company = ไทย 2 บรรทัด + อังกฤษ 2 บรรทัด · employee = ชื่อตำบล/อำเภอ/จังหวัดของพนักงาน */
export type AddrTarget = { kind: 'lines3' } | { kind: 'text'; key: string } | { kind: 'company' } | { kind: 'employee' };
const PART_KEYS = ['addr_no', 'addr_moo', 'addr_village', 'addr_building', 'addr_room', 'addr_floor', 'addr_soi', 'addr_road', 'addr_geo_code'] as const;
/** พนักงานใช้ชื่อคอลัมน์ทะเบียนบ้านเดิม (reg_*) */
const EMP_MAP: Record<string, string> = { addr_no: 'reg_house_no', addr_moo: 'reg_moo', addr_village: 'reg_village', addr_building: 'reg_building', addr_soi: 'reg_soi', addr_road: 'reg_road', addr_geo_code: 'reg_geo_code', zip_code: 'reg_postcode' };
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function outKeys(t: AddrTarget): string[] {
  return t.kind === 'lines3' ? ['address_1', 'address_2', 'address_3'] : t.kind === 'text' ? [t.key] : t.kind === 'company' ? ['address_th_1', 'address_th_2', 'address_en_1', 'address_en_2'] : ['reg_subdistrict', 'reg_district', 'reg_province'];
}
function compose(g: Geo, t: AddrTarget, p: Record<string, string>): Record<string, string> {
  if (t.kind === 'lines3') { const [a, b, c] = g.composeAddrLines(p); return { address_1: a, address_2: b, address_3: c }; }
  if (t.kind === 'text') return { [t.key]: g.composeAddrTh(p) };
  if (t.kind === 'employee') { const x = g.geoLookup(p.addr_geo_code); return { reg_subdistrict: x?.tamb.th ?? '', reg_district: x ? x.amph.th.replace(/^เขต/, '') : '', reg_province: x?.prov.th ?? '' }; }
  const [house, geoLine, prov] = g.composeAddrLines(p);
  const en = g.composeAddrEn(p).split(', ');
  const zip = /^\d{5}$/.test(p.zip_code ?? '') ? p.zip_code : '';
  return {
    address_th_1: house, address_th_2: [geoLine, prov, zip].filter(Boolean).join(' ').slice(0, 120),
    address_en_1: en.slice(0, 2).filter(Boolean).join(', ').slice(0, 120), address_en_2: en.slice(2).join(', ').slice(0, 120),
  };
}

export function AddressFields({ value, onChange, target, title = 'ที่อยู่', disabled }: { value: Vals; onChange: (patch: Record<string, string>) => void; target: AddrTarget; title?: string; disabled?: boolean }) {
  const g = useGeo();
  const k = (key: string) => (target.kind === 'employee' ? EMP_MAP[key] ?? key : key);
  const parts = (v: Vals): Record<string, string> => Object.fromEntries([...PART_KEYS, 'zip_code'].map((x) => [x, s(v[k(x)])]));
  const p = parts(value);
  const outs = outKeys(target);
  const [prov, setProv] = useState('');
  const [amph, setAmph] = useState('');
  const [zipBad, setZipBad] = useState(false);
  const tambRef = useRef<HTMLSelectElement>(null);
  const openTamb = useRef(false);

  // จังหวัด/อำเภอที่เลือกอยู่ = ตามตำบลที่บันทึกไว้ (โหลดข้อมูลเดิม/เปลี่ยนรายการ)
  useEffect(() => {
    if (!g) return;
    const x = g.geoLookup(p.addr_geo_code);
    if (x) { setProv(x.prov.code); setAmph(x.amph.code); }
    else if (!prov && !amph && p.zip_code) { const z = g.geoFromPostcode(p.zip_code); setProv(z.prov); setAmph(z.amph); }
    else if (target.kind === 'employee' && !prov) { const m = g.geoMatchNames(s(value.reg_province), s(value.reg_district), s(value.reg_subdistrict)); setProv(m.prov); setAmph(m.amph); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, p.addr_geo_code]);

  if (!g) return <div className="addr-box"><div className="addr-title">{title}</div><p className="muted small">กำลังโหลดรายการจังหวัด อำเภอ ตำบล…</p></div>;

  /** เปลี่ยนช่องแยก แล้วประกอบข้อความที่อยู่ใหม่ ถ้าผู้ใช้ยังไม่ได้แก้ข้อความเอง */
  const apply = (patch: Record<string, string>, force = false) => {
    const np = { ...p, ...patch };
    const before = compose(g, target, p), after = compose(g, target, np);
    const untouched = outs.every((o) => s(value[o]) === s(before[o]) || !s(value[o]).trim()) || outs.every((o) => !s(value[o]).trim());
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(patch)) out[k(key)] = v;
    if (force || untouched || target.kind === 'employee') Object.assign(out, after);
    onChange(out);
  };
  const zipInfo = (p.zip_code ?? '').length === 5 ? g.geoFromPostcode(p.zip_code) : null;
  const zipChoices = zipInfo?.found && zipInfo.choices.length ? zipInfo.choices : null;
  const amphurs = zipChoices && (!prov || zipChoices.every((c) => c.prov.code === prov))
    ? [...new Map(zipChoices.map((c) => [c.amph.code, c.amph])).values()] : g.geoAmphurs(prov);
  const tambons = zipChoices && amph && zipChoices.some((c) => c.amph.code === amph)
    ? zipChoices.filter((c) => c.amph.code === amph).map((c) => c.tamb) : g.geoTambons(amph);
  const cur = g.geoLookup(p.addr_geo_code);

  const onZip = (raw: string) => {
    const zip = raw.replace(/\D/g, '').slice(0, 5);
    if (zip.length < 5) { setZipBad(false); apply({ zip_code: zip }); return; }
    const z = g.geoFromPostcode(zip);
    setZipBad(!z.found);
    if (!z.found) { apply({ zip_code: zip }); return; }
    // ตำบลเดิมอยู่ในรหัสนี้แล้ว → คงไว้
    if (cur && (cur.zip === zip || z.choices.some((c) => c.tamb.code === cur.tamb.code))) { apply({ zip_code: zip }); return; }
    setProv(z.prov); setAmph(z.amph);
    apply({ zip_code: zip, addr_geo_code: z.tamb });
    if (!z.tamb) openTamb.current = true;
  };
  const onTamb = (code: string) => {
    const x = g.geoLookup(code);
    const patch: Record<string, string> = { addr_geo_code: code };
    if (x?.zip && (!p.zip_code || zipBad || !(zipInfo?.found && (zipInfo.choices.length ? zipInfo.choices : g.geoByPostcode(p.zip_code)).some((c) => c.tamb.code === code)))) { patch.zip_code = x.zip; setZipBad(false); }
    apply(patch);
  };
  const legacyText = target.kind === 'company' ? [value.address_th_1, value.address_th_2] : target.kind === 'employee' ? [] : outs.map((o) => value[o]);
  const legacy = legacyText.map(s).filter(Boolean).join(' ');
  const hasParts = PART_KEYS.some((x) => p[x]);
  const fillFromLegacy = () => {
    const r = g.parseAddrText(legacy, p.zip_code);
    const patch: Record<string, string> = {};
    for (const x of PART_KEYS) { const v = (r as unknown as Record<string, unknown>)[x]; if (v && !p[x]) patch[x] = String(v); }
    if (r.zip_code && !p.zip_code) patch.zip_code = r.zip_code;
    setProv(r.prov_code); setAmph(r.amph_code);
    const out: Record<string, string> = {};
    for (const [key, v] of Object.entries(patch)) out[k(key)] = v;
    onChange(out);   // ข้อความเดิมไม่เปลี่ยน — ผู้ใช้ตรวจแล้วกด ↻ ประกอบใหม่เอง
    toast(r.addr_geo_code ? 'แยกช่องจากที่อยู่เดิมแล้ว — ตรวจให้ถูกต้อง แล้วกด "ประกอบข้อความใหม่" ถ้าต้องการ' : 'จับคู่ตำบล/อำเภอ/จังหวัดกับรายการทางการได้ไม่ครบ — เลือกต่อเองในช่องที่เหลือ', r.addr_geo_code ? 'ok' : 'warn');
  };
  const composed = compose(g, target, p);
  const edited = hasParts && outs.some((o) => s(value[o]).trim() && s(value[o]) !== s(composed[o]));
  const txt = (key: string, label: string, max: number) => (
    <Field label={label}><input value={p[key]} maxLength={max} disabled={disabled} onChange={(e) => apply({ [key]: e.target.value })} /></Field>
  );
  return (
    <div className="addr-box">
      <div className="addr-title">{title} <small className="muted">กรอกรหัสไปรษณีย์ แล้วระบบเติมจังหวัด อำเภอ ตำบลให้ · ตามรายการกรมการปกครอง</small></div>
      <div className="form-grid addr-grid">
        <Field label="รหัสไปรษณีย์" error={zipBad ? 'ไม่พบรหัสไปรษณีย์นี้ — ตรวจตัวเลข หรือเลือกจังหวัด อำเภอ ตำบลเอง' : undefined}
          hint={zipChoices && !p.addr_geo_code ? `รหัสนี้มี ${zipChoices.length} ตำบล — เลือกในช่องตำบล/แขวง` : cur?.partial ? '⚠ ตำบลนี้บางหมู่/ซอยใช้รหัสไปรษณีย์อื่น — ตรวจกับที่อยู่จริง' : undefined}>
          <input className="mono" inputMode="numeric" maxLength={5} value={p.zip_code} disabled={disabled} aria-invalid={zipBad || undefined} onChange={(e) => onZip(e.target.value)} placeholder="เช่น 50230" />
        </Field>
        <Field label="จังหวัด">
          <select data-navskip value={prov} disabled={disabled} onChange={(e) => { setProv(e.target.value); setAmph(''); if (zipInfo?.found && zipInfo.prov && zipInfo.prov !== e.target.value) apply({ addr_geo_code: '', zip_code: '' }); else apply({ addr_geo_code: '' }); }}>
            <option value="">— เลือกจังหวัด —</option>{g.geoProvinces().map((x) => <option key={x.code} value={x.code}>{x.th}</option>)}
          </select>
        </Field>
        <Field label={g.isBangkok(prov) ? 'เขต' : 'อำเภอ/เขต'}>
          <select data-navskip value={amph} disabled={disabled || !prov} onChange={(e) => { setAmph(e.target.value); apply({ addr_geo_code: '' }); }}>
            <option value="">— เลือกอำเภอ —</option>{amphurs.map((x) => <option key={x.code} value={x.code}>{x.th}</option>)}
          </select>
        </Field>
        <Field label={g.isBangkok(prov) ? 'แขวง' : 'ตำบล/แขวง'}>
          <select ref={tambRef} data-navskip value={p.addr_geo_code} disabled={disabled || !amph} onChange={(e) => onTamb(e.target.value)}
            onFocus={(e) => { if (openTamb.current && !p.addr_geo_code) { openTamb.current = false; try { e.currentTarget.showPicker?.(); } catch { /* เบราว์เซอร์ไม่ให้เปิดเอง */ } } }}>
            <option value="">{zipChoices && amph ? `— เลือกตำบล (${tambons.length}) —` : '— เลือกตำบล —'}</option>{tambons.map((x) => <option key={x.code} value={x.code}>{x.th}</option>)}
          </select>
        </Field>
        {txt('addr_no', 'เลขที่', 20)}{txt('addr_moo', 'หมู่ที่', 20)}{txt('addr_village', 'หมู่บ้าน', 100)}{txt('addr_building', 'อาคาร', 40)}
        {target.kind !== 'employee' && <>{txt('addr_room', 'ห้องเลขที่', 20)}{txt('addr_floor', 'ชั้นที่', 20)}</>}
        {txt('addr_soi', 'ซอย', 100)}{txt('addr_road', 'ถนน', 100)}
      </div>
      {target.kind === 'employee' && !p.addr_geo_code && (s(value.reg_subdistrict) || s(value.reg_district) || s(value.reg_province)) && <p className="hint">
        ข้อมูลเดิม: ตำบล/แขวง {s(value.reg_subdistrict) || '—'} · อำเภอ/เขต {s(value.reg_district) || '—'} · จังหวัด {s(value.reg_province) || '—'} — เลือกตำบลจากรายการ (หรือกรอกรหัสไปรษณีย์) ให้ตรงชื่อทางการ
      </p>}
      {target.kind !== 'employee' && <div className="addr-out">
        <div className="addr-out-head">
          <span className="lbl">ข้อความที่พิมพ์ในเอกสาร</span>
          {edited && <span className="hint">แก้ข้อความเองแล้ว — ระบบไม่ทับ</span>}
          {hasParts && !disabled && <button type="button" className="link-btn" onClick={() => apply({}, true)}>↻ ประกอบข้อความใหม่จากช่อง</button>}
          {!hasParts && legacy && !disabled && <button type="button" className="link-btn" onClick={fillFromLegacy}>↻ เติมช่องจากที่อยู่เดิม</button>}
        </div>
        {outs.map((o, i) => <input key={o} data-navskip value={s(value[o])} disabled={disabled} maxLength={target.kind === 'text' ? 500 : target.kind === 'company' ? 120 : 100}
          aria-label={`${title} บรรทัด ${i + 1}`} placeholder={target.kind === 'company' ? (i < 2 ? `ภาษาไทย บรรทัด ${i + 1}` : `English line ${i - 1}`) : `บรรทัด ${i + 1}`} onChange={(e) => onChange({ [o]: e.target.value })} />)}
        {target.kind === 'company' && g.addrEnNeedsUser(p) && <span className="hint">ชื่อหมู่บ้าน อาคาร ซอย ถนน ภาษาอังกฤษ ระบบไม่แปลให้ — เติมในบรรทัดอังกฤษเอง</span>}
      </div>}
    </div>
  );
}
