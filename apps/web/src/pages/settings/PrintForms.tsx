import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DOC_CLASSES, normalizeLayout, PRINT_BASES, PRINT_FONTS, PRINT_LANGS, PRINT_POS9, PRINT_HEAD_FIELDS, printFamily, SETTLE_DETAILS, type PrintAlign, type PrintBase, type PrintFormEntry, type PrintLayout, type PrintVAlign } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { Confirm, ErrorBox, Field, PageHead, Tabs, toast, useHotkeys, useYearSystem } from '../../ui';
import { PrintSheet, type PrintData } from '../../components/DocPrint';
import { CompanyImagesPanel, useCompanyImages } from '../../components/CompanyImages';
import { confirmLeave, useUnsaved } from '../../unsaved';

type FormsResp = { menu: PrintFormEntry[]; custom: Array<{ slot: number; name: string; base: string; status: string }>; sample: { kind: 'doc' | 'journal'; id: string } | null };
const SCOPES = [...Object.entries(DOC_CLASSES).map(([k, v]) => ({ k, label: `${k} ${v.label}` })), { k: 'GL', label: 'GL ใบสำคัญ (สมุดรายวัน)' }];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** ขนาดอักษร (pt) ของส่วนในแบบฟอร์ม — ว่าง = ตามต้นแบบ (HANDOFF 151) */
function PtInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return <input type="number" min={6} max={40} step={0.5} value={value || ''} placeholder="ตามต้นแบบ" aria-label={label} onChange={(e) => onChange(Number(e.target.value) || 0)} />;
}
/** สีของส่วนในแบบฟอร์ม — "ตามต้นแบบ" = ไม่ตั้ง (สีเดิมของต้นแบบ/ธีมบริษัท) */
function ColorInput({ value, onChange, label, dflt }: { value: string; onChange: (v: string) => void; label: string; dflt: string }) {
  return <span className="pf-color">
    <input type="color" value={value || dflt} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    {value ? <button type="button" className="link-btn" onClick={() => onChange('')} title="กลับไปใช้สีของต้นแบบ">ใช้สีต้นแบบ</button> : <span className="muted small">ตามต้นแบบ</span>}
  </span>;
}

/**
 * แบบฟอร์มพิมพ์เอกสาร (คู่มือบทที่ 25 S-RD-01/02 · ทำแบบใหม่แทนภาษารายงาน)
 * เลือกชนิดเอกสาร → หมายเลขฟอร์ม 1–9 → ปรับหัวเรื่อง คอลัมน์ ช่องหัวเอกสาร ช่องลงชื่อ สำเนา ขนาดอักษร พร้อมดูตัวอย่างจากเอกสารจริงล่าสุด
 */
export function PrintFormsPage() {
  const qc = useQueryClient();
  const ys = useYearSystem();
  const can = useCan('RP.FORM');
  const [sp, setSp] = useSearchParams();
  const scope = sp.get('scope') ?? 'IV';
  const [slot, setSlot] = useState(1);
  const forms = useQuery({ queryKey: ['print-forms', scope], queryFn: () => api.get<FormsResp>('/api/v1/print-forms', { scope }) });
  const sample = useQuery({ enabled: !!forms.data?.sample, queryKey: ['print-sample', forms.data?.sample?.id], queryFn: () => api.get<{ data: PrintData }>(`/api/v1/print/${forms.data!.sample!.kind}/${forms.data!.sample!.id}`) });
  const cur = forms.data?.menu.find((f) => f.slot === slot);
  const isCustom = !!forms.data?.custom.find((c) => c.slot === slot);
  const [name, setName] = useState('');
  const [base, setBase] = useState<PrintBase>('pro');
  const [L, setL] = useState<PrintLayout | null>(null);
  const [status, setStatus] = useState<'A' | 'I'>('A');
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [askDel, setAskDel] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [pt, setPt] = useState('gen');
  useEffect(() => {
    if (!forms.data) return;
    const c = forms.data.custom.find((x) => x.slot === slot);
    const m = forms.data.menu.find((x) => x.slot === slot);
    setName(m?.name ?? c?.name ?? `แบบฟอร์ม ${slot}`); setBase((m?.base ?? 'pro') as PrintBase); setStatus(c?.status === 'I' ? 'I' : 'A');
    setL(m?.layout ?? normalizeLayout(scope, 'grid', {})); setDirty(false); setErr(null);
  }, [forms.data, slot, scope]);
  const set = (p: Partial<PrintLayout>) => { setL((x) => ({ ...x!, ...p })); setDirty(true); };
  const fam = printFamily(scope);
  const heads = PRINT_HEAD_FIELDS.filter((f) => !f.families || f.families.includes(fam));
  const preview: PrintFormEntry | null = useMemo(() => (L ? { slot, name, base, layout: L, custom: true } : null), [L, slot, name, base]);
  const sampleData: PrintData | undefined = sample.data?.data;
  const { images } = useCompanyImages();
  const signList = Object.entries(images.signs);

  const save = async () => {
    if (!L || !can('edit')) return;
    setErr(null);
    try {
      await api.put(`/api/v1/print-forms/${scope}/${slot}`, { name, base, layout: L, status });
      toast(`บันทึกแบบฟอร์ม ${scope} หมายเลข ${slot} แล้ว`); setDirty(false);
      qc.invalidateQueries({ queryKey: ['print-forms', scope] }); qc.invalidateQueries({ queryKey: ['print'] });
    } catch (e) { setErr(e); }
  };
  const remove = async () => {
    setAskDel(false);
    try { await api.del(`/api/v1/print-forms/${scope}/${slot}`); toast('ลบแบบฟอร์มของบริษัทแล้ว — กลับไปใช้ต้นแบบในโปรแกรม'); qc.invalidateQueries({ queryKey: ['print-forms', scope] }); qc.invalidateQueries({ queryKey: ['print'] }); }
    catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save });
  // ถามก่อนออกจากหน้าเมื่อยังไม่บันทึก (HANDOFF 149)
  useUnsaved(dirty, { word: 'แบบฟอร์มพิมพ์', save: () => void save() });
  // พิมพ์ส่วนหัวบริษัท (HANDOFF 152) = ชื่อ/ที่อยู่ + โลโก้ไปด้วยกัน (เปิด: โลโก้ที่ปิดอยู่กลับมาซ้ายบน · ปิด: ไม่พิมพ์โลโก้)
  const setHeader = (on: boolean) => set(on ? { show_company: true, ...(L?.logo === 'none' ? { logo: 'left', logo_v: 'top' } : {}) } : { show_company: false, logo: 'none' });
  const pos = (h: PrintAlign, v: PrintVAlign) => `${v}-${h}`;
  const moveCol = (i: number, dir: -1 | 1) => { if (!L) return; const c = [...L.columns]; const j = i + dir; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j]!, c[i]!]; set({ columns: c }); };

  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="รายงาน › แบบฟอร์มพิมพ์เอกสาร" title="แบบฟอร์มพิมพ์เอกสาร" lead="ฟอร์ม 1–4 เป็นต้นแบบในโปรแกรม (มีเส้น/ไม่มีเส้น/ครึ่งหน้า/ต่อเนื่อง) — บันทึกทับหมายเลขเดิมหรือเพิ่มหมายเลข 5–9 ได้ เมนูพิมพ์ของเอกสารแสดงตามลำดับหมายเลข (Alt+P = ฟอร์ม 1)" />
      <div className="toolbar">
        <label>ชนิดเอกสาร <select value={scope} onChange={(e) => { const v = e.target.value; void confirmLeave().then((ok) => { if (ok) { setSp({ scope: v }); setSlot(1); } }); }}>{SCOPES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select></label>
        <label>หมายเลขฟอร์ม <select value={slot} onChange={(e) => { const v = Number(e.target.value); void confirmLeave().then((ok) => { if (ok) setSlot(v); }); }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => { const m = forms.data?.menu.find((f) => f.slot === n); const c = forms.data?.custom.find((f) => f.slot === n); return <option key={n} value={n}>{n}. {m?.name ?? c?.name ?? '(ว่าง)'}{c ? ' — ของบริษัท' : m ? ' — ต้นแบบ' : ''}{c?.status === 'I' ? ' (ซ่อน)' : ''}</option>; })}
        </select></label>
        <button className="primary" disabled={!can('edit') || !L} onClick={save}>บันทึก <kbd>F9</kbd></button>
        <button disabled={!isCustom || !can('delete')} onClick={() => setAskDel(true)} title="ลบฟอร์มของบริษัท กลับไปใช้ต้นแบบ">กลับไปใช้ต้นแบบ</button>
        <label>คัดลอกจาก <select value={copyFrom} onChange={(e) => { const f = forms.data?.menu.find((x) => String(x.slot) === e.target.value); if (f) { setL(f.layout); setBase(f.base); setDirty(true); } setCopyFrom(''); }}>
          <option value="">—</option>{forms.data?.menu.filter((f) => f.slot !== slot).map((f) => <option key={f.slot} value={f.slot}>{f.slot}. {f.name}</option>)}</select></label>
        {dirty && <span className="muted small">มีการแก้ไขที่ยังไม่บันทึก</span>}
        {!can('edit') && <span className="muted small">ดูได้อย่างเดียว — แก้แบบฟอร์มต้องระดับอนุมัติ 9</span>}
      </div>
      <ErrorBox error={err ?? forms.error} />
      <CompanyImagesPanel />
      {L && <div className="pf-layout">
        <div className="pf-side">
          <Tabs active={pt} onChange={setPt} tabs={[{ key: 'gen', label: 'ทั่วไป/กระดาษ' }, { key: 'look', label: 'หัวเอกสาร/สี' }, { key: 'parts', label: 'ส่วนที่พิมพ์' }, { key: 'cols', label: 'คอลัมน์ตาราง', badge: L.columns.filter((c) => c.show).length }, { key: 'sign', label: 'ลายเซ็นและท้ายเอกสาร' }]} />
          {pt === 'gen' && <div className="form-grid">
            <Field label="ชื่อแบบฟอร์ม (ในเมนูพิมพ์)" req wide><input value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
            <Field label="ต้นแบบ / ขนาดกระดาษ" wide hint={PRINT_BASES.find((b) => b.key === base)?.hint}><select value={base} onChange={(e) => { setBase(e.target.value as PrintBase); setDirty(true); }}>{PRINT_BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
            <Field label="หัวเรื่อง" wide hint={`ว่าง = ชื่อประเภทเอกสาร${sampleData ? ` (${sampleData.title})` : ''}`}><input value={L.title} maxLength={120} placeholder="เช่น ใบส่งของ/ใบกำกับภาษี" onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="หัวเรื่องภาษาอังกฤษ" wide><input value={L.title_en} maxLength={120} placeholder="INVOICE / TAX INVOICE" onChange={(e) => set({ title_en: e.target.value })} /></Field>
            <Field label="ภาษาของแบบฟอร์ม" wide hint={L.lang === 'en' ? 'คำกำกับ หัวคอลัมน์ ยอดรวม จำนวนเงินตัวอักษร และวันที่ (เช่น 19 Nov 2026 ปี ค.ศ.) เป็นภาษาอังกฤษ · ชื่อ/ที่อยู่บริษัทใช้ภาษาอังกฤษถ้ามี (รายละเอียดกิจการ) · รายการสินค้าและข้อมูลที่คีย์คงเดิม · ชื่อเอกสารภาษาไทยอยู่บรรทัดรอง' : 'ภาษาอังกฤษ = เอกสารสำหรับลูกค้าต่างชาติ'}>
              <select value={L.lang} onChange={(e) => set({ lang: e.target.value as PrintLayout['lang'] })}>{PRINT_LANGS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>
            <Field label="สำเนาที่พิมพ์ (คั่นด้วย ,)" wide hint="เช่น ต้นฉบับ, สำเนา — หนึ่งแผ่นต่อคำ ว่าง = แผ่นเดียว"><input defaultValue={L.copies.join(', ')} key={`c${slot}${scope}${L.copies.join()}`} onBlur={(e) => set({ copies: list(e.target.value) })} /></Field>
            <Field label="พิมพ์ซ้ำ" wide hint="ติ๊ก = เอกสารที่พิมพ์ไปแล้ว พิมพ์อีกครั้งได้แผ่นเท่าเดิมแต่คำว่า ต้นฉบับ เปลี่ยนเป็น สำเนา (แบบฟอร์มที่ไม่มีคำกำกับจะขึ้นคำว่า สำเนา) — ใบกำกับภาษีต้นฉบับออกได้ครั้งเดียว">
              <label className="check"><input type="checkbox" checked={L.reprint_copy} onChange={(e) => set({ reprint_copy: e.target.checked })} /> พิมพ์ซ้ำเป็น "สำเนา"</label></Field>
            <Field label="ขนาดอักษร (pt)"><input type="number" min={7} max={16} value={L.font_pt} onChange={(e) => set({ font_pt: Number(e.target.value) || 10 })} /></Field>
            <Field label="บรรทัดขั้นต่ำในตาราง" hint="เติมบรรทัดว่างให้สูงเท่ากันทุกใบ"><input type="number" min={0} max={40} value={L.min_rows} onChange={(e) => set({ min_rows: Number(e.target.value) || 0 })} /></Field>
            {fam === 'settle' && <Field label="รายการในใบเสร็จ" hint="ใบเสร็จรับเงิน/ใบกำกับภาษี (ภาษีเกณฑ์เงินสด) ควรแสดงรายการสินค้า/บริการ"><select value={L.settle_detail} onChange={(e) => set({ settle_detail: e.target.value as PrintLayout['settle_detail'] })} aria-label="รายการในใบเสร็จ">
              {SETTLE_DETAILS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>}
            <Field label="แสดงในเมนูพิมพ์"><select value={status} onChange={(e) => { setStatus(e.target.value as 'A' | 'I'); setDirty(true); }}><option value="A">แสดง</option><option value="I">ซ่อนหมายเลขนี้</option></select></Field>
          </div>}
          {pt === 'look' && <>
          <h3 className="small">ส่วนหัวเอกสาร</h3>
          <label className="check pf-headon"><input type="checkbox" checked={L.show_company} onChange={(e) => setHeader(e.target.checked)} /> <b>พิมพ์ส่วนหัวบริษัท</b> (ชื่อ ที่อยู่ และโลโก้)</label>
          {!L.show_company && <p className="muted small pf-why">{base === 'plain'
            ? 'ต้นแบบ "ไม่มีเส้นตาราง" ปิดส่วนหัวบริษัทไว้ เพราะใช้พิมพ์ลงกระดาษที่พิมพ์ชื่อ/โลโก้บริษัทไว้แล้ว (กระดาษหัวจดหมาย/แบบฟอร์มสำเร็จรูป) — ถ้าใช้กระดาษเปล่า ติ๊ก "พิมพ์ส่วนหัวบริษัท" แล้วกดบันทึก'
            : 'ไม่พิมพ์ชื่อ ที่อยู่ และโลโก้บริษัท (เช่น พิมพ์ลงกระดาษหัวจดหมาย) — ติ๊กเพื่อพิมพ์'}</p>}
          <div className="form-grid">
            <Field label="โลโก้บริษัท" hint={images.logo ? undefined : 'ยังไม่มีโลโก้ — อัปโหลดด้านบน'}><select value={L.logo === 'none' ? 'none' : pos(L.logo, L.logo_v)} aria-label="ตำแหน่งโลโก้" onChange={(e) => { const v = e.target.value; if (v === 'none') set({ logo: 'none' }); else { const [vv, hh] = v.split('-') as [PrintVAlign, PrintAlign]; set({ logo: hh, logo_v: vv }); } }}>
              {PRINT_POS9.map((p) => <option key={pos(p.h, p.v)} value={pos(p.h, p.v)}>{p.label}</option>)}<option value="none">ไม่แสดงโลโก้</option></select></Field>
            <Field label="ความสูงโลโก้ (มม.)"><input type="number" min={6} max={40} value={L.logo_mm} disabled={L.logo === 'none'} onChange={(e) => set({ logo_mm: Number(e.target.value) || 18 })} /></Field>
            <Field label="ตำแหน่งชื่อบริษัท/ที่อยู่" hint="เดิม = ซ้ายบน"><select value={pos(L.co_align, L.co_v)} disabled={!L.show_company} aria-label="ตำแหน่งชื่อบริษัท" onChange={(e) => { const [vv, hh] = e.target.value.split('-') as [PrintVAlign, PrintAlign]; set({ co_align: hh, co_v: vv }); }}>
              {PRINT_POS9.map((p) => <option key={pos(p.h, p.v)} value={pos(p.h, p.v)}>{p.label}</option>)}</select></Field>
            <Field label="ตำแหน่งชื่อเอกสาร" hint="เดิม = ขวาบน"><select value={pos(L.title_align, L.title_v)} aria-label="ตำแหน่งชื่อเอกสาร" onChange={(e) => { const [vv, hh] = e.target.value.split('-') as [PrintVAlign, PrintAlign]; set({ title_align: hh, title_v: vv }); }}>
              {PRINT_POS9.map((p) => <option key={pos(p.h, p.v)} value={pos(p.h, p.v)}>{p.label}</option>)}</select></Field>
            <Field label="แถบสีบนสุด" hint={base === 'pro' ? 'แถบสีเหนือส่วนหัว (ต้นแบบมืออาชีพ)' : 'มีเฉพาะต้นแบบมืออาชีพ'}>
              <span className="pf-color"><select value={L.top_bar === 'none' ? 'none' : L.top_bar ? 'color' : ''} disabled={base !== 'pro'} aria-label="แถบสีบนสุด"
                onChange={(e) => set({ top_bar: e.target.value === 'none' ? 'none' : e.target.value === 'color' ? (L.top_bar && L.top_bar !== 'none' ? L.top_bar : '#6f5db8') : '' })}>
                <option value="">ตามสีธีมบริษัท</option><option value="color">เลือกสีเอง</option><option value="none">ไม่แสดง</option></select>
                {base === 'pro' && L.top_bar && L.top_bar !== 'none' && <input type="color" value={L.top_bar} aria-label="สีแถบบนสุด" onChange={(e) => set({ top_bar: e.target.value })} />}</span></Field>
            <Field label="แบบอักษร (ฟอนต์)" hint="ทั้งแผ่นเอกสาร · ตัวอย่างด้านขวาเปลี่ยนทันที"><select value={L.font} aria-label="แบบอักษร" onChange={(e) => set({ font: e.target.value })}>{PRINT_FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></Field>
          </div>
          <p className="muted small">ตำแหน่ง 9 ช่อง: ซ้าย/กลาง/ขวา × บน/กลาง/ล่าง · อยู่ช่องเดียวกัน = ชื่อบริษัทแล้วชื่อเอกสารเรียงลงมา โลโก้อยู่ข้างข้อความ · ข้อความยาวขึ้นบรรทัดใหม่ ไม่ทับกัน</p>
          <table className="grid pf-look"><thead><tr><th>ส่วน</th><th>ขนาดอักษร (pt)</th><th>สี</th></tr></thead><tbody>
            <tr><th>{L.lang === 'en' ? 'ชื่อบริษัทภาษาอังกฤษ (บรรทัดแรก)' : 'ชื่อบริษัทภาษาไทย (บรรทัดแรก)'}</th><td><PtInput label="ขนาดชื่อบริษัท" value={L.co_name_pt} onChange={(v) => set({ co_name_pt: v })} /></td><td><ColorInput label="สีชื่อบริษัท" dflt="#111111" value={L.co_name_color} onChange={(v) => set({ co_name_color: v })} /></td></tr>
            <tr><th>{L.lang === 'en' ? 'ชื่อบริษัทภาษาไทย (บรรทัดที่สอง)' : 'ชื่อบริษัทภาษาอังกฤษ (บรรทัดที่สอง)'}</th><td><PtInput label="ขนาดชื่อบริษัทบรรทัดที่สอง" value={L.co_name2_pt} onChange={(v) => set({ co_name2_pt: v })} /></td><td><ColorInput label="สีชื่อบริษัทบรรทัดที่สอง" dflt="#33333d" value={L.co_name2_color} onChange={(v) => set({ co_name2_color: v })} /></td></tr>
            <tr><th>ที่อยู่และข้อมูลบริษัท</th><td><PtInput label="ขนาดที่อยู่บริษัท" value={L.co_info_pt} onChange={(v) => set({ co_info_pt: v })} /></td><td><ColorInput label="สีที่อยู่บริษัท" dflt="#33333d" value={L.co_info_color} onChange={(v) => set({ co_info_color: v })} /></td></tr>
            <tr><th>ชื่อเอกสาร</th><td><PtInput label="ขนาดชื่อเอกสาร" value={L.title_pt} onChange={(v) => set({ title_pt: v })} /></td><td><ColorInput label="สีชื่อเอกสาร" dflt="#6f5db8" value={L.title_color} onChange={(v) => set({ title_color: v })} /></td></tr>
          </tbody></table>
          <h3 className="small">ส่วนกลาง (ตารางรายการและยอดรวม)</h3>
          <table className="grid pf-look"><thead><tr><th>ส่วน</th><th>ขนาดอักษร (pt)</th><th>สี</th></tr></thead><tbody>
            <tr><th>แถบหัวตาราง/ยอดรวมทั้งสิ้น</th><td className="muted small">—</td><td><ColorInput label="สีแถบ" dflt="#6f5db8" value={L.band_color} onChange={(v) => set({ band_color: v })} /></td></tr>
            <tr><th>ตัวอักษรบนแถบ</th><td className="muted small">—</td><td><ColorInput label="สีตัวอักษรบนแถบ" dflt="#ffffff" value={L.band_text_color} onChange={(v) => set({ band_text_color: v })} /></td></tr>
            <tr><th>ตัวอักษรในตารางและยอดรวม</th><td><PtInput label="ขนาดตัวอักษรในตาราง" value={L.body_pt} onChange={(v) => set({ body_pt: v })} /></td><td><ColorInput label="สีตัวอักษรในตาราง" dflt="#1d1d24" value={L.body_color} onChange={(v) => set({ body_color: v })} /></td></tr>
          </tbody></table>
          <p className="muted small">ว่าง/ตามต้นแบบ = หน้าตาเดิมของต้นแบบ (สีตามธีมบริษัท) · ขนาดอักษรทั้งแผ่นตั้งที่แท็บ ทั่วไป/กระดาษ · ตัวอย่างด้านขวาเปลี่ยนทันที</p>
          </>}
          {pt === 'parts' && <>
          <h3 className="small">ส่วนที่พิมพ์</h3>
          <div className="pf-checks">
            <label><input type="checkbox" checked={L.show_company} onChange={(e) => setHeader(e.target.checked)} /> ส่วนหัวบริษัท (ชื่อ ที่อยู่ โลโก้)</label>
            {([['show_party', 'ลูกค้า/ผู้จำหน่าย'], ['show_totals', 'ยอดรวมท้ายเอกสาร'], ['show_amount_text', 'จำนวนเงินตัวอักษร'],
              ['show_payments', 'รายการรับ/จ่ายเงิน'], ['show_notes', 'หมายเหตุ'], ['show_journal', 'รายการบัญชี (ใบสำคัญ)']] as Array<[keyof PrintLayout, string]>).map(([k, t]) =>
              <label key={k}><input type="checkbox" checked={!!L[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<PrintLayout>)} /> {t}</label>)}
          </div>
          <h3 className="small">ช่องหัวเอกสาร (นอกจากเลขที่/วันที่)</h3>
          <div className="pf-checks">{heads.map((f) => <label key={f.key}><input type="checkbox" checked={L.head_fields.includes(f.key)} onChange={(e) => set({ head_fields: e.target.checked ? [...L.head_fields, f.key] : L.head_fields.filter((x) => x !== f.key) })} /> {f.label}</label>)}</div>
          </>}
          {pt === 'cols' && <>
          <h3 className="small">คอลัมน์ตาราง</h3>
          <table className="grid pf-cols"><thead><tr><th>แสดง</th><th>หัวคอลัมน์</th><th>ภาษาอังกฤษ</th><th className="r">กว้าง</th><th>จัด</th><th /></tr></thead>
            <tbody>{L.columns.map((c, i) => <tr key={c.key}>
              <td className="c"><input type="checkbox" checked={c.show} aria-label={`แสดง ${c.label}`} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, show: e.target.checked } : x)) })} /></td>
              <td><input value={c.label} maxLength={40} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)) })} aria-label="หัวคอลัมน์" /></td>
              <td><input value={c.label_en} maxLength={40} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, label_en: e.target.value } : x)) })} aria-label="หัวคอลัมน์ภาษาอังกฤษ" /></td>
              <td><input className="r" type="number" min={3} max={80} value={c.width} style={{ width: 64 }} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, width: Number(e.target.value) || 3 } : x)) })} aria-label="ความกว้าง" /></td>
              <td><select value={c.align} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, align: e.target.value as 'l' } : x)) })} aria-label="การจัดวาง"><option value="l">ซ้าย</option><option value="c">กลาง</option><option value="r">ขวา</option></select></td>
              <td className="nowrap"><button type="button" className="icon-btn" title="เลื่อนขึ้น" onClick={() => moveCol(i, -1)}>▲</button><button type="button" className="icon-btn" title="เลื่อนลง" onClick={() => moveCol(i, 1)}>▼</button></td>
            </tr>)}</tbody></table>
          </>}
          {pt === 'sign' && <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="ช่องลงชื่อ (คั่นด้วย ,)" wide hint="สูงสุด 4 ช่อง"><input defaultValue={L.signatures.join(', ')} key={`s${slot}${scope}${L.signatures.join()}`} onBlur={(e) => set({ signatures: list(e.target.value) })} /></Field>
            <Field label="ช่องลงชื่อภาษาอังกฤษ (คั่นด้วย ,)" wide hint="ใช้เมื่อภาษาของแบบฟอร์ม = อังกฤษ · ลำดับเดียวกับช่องลงชื่อ"><input defaultValue={L.signatures_en.join(', ')} key={`se${slot}${scope}${L.signatures_en.join()}`} onBlur={(e) => set({ signatures_en: list(e.target.value) })} /></Field>
            {L.signatures.map((s, i) => <Field key={`sg${i}${s}`} label={`รูปลายเซ็นช่อง "${s}"`} hint={signList.length ? undefined : 'เพิ่มรูปลายเซ็นด้านบนก่อน'}>
              <select value={L.signature_images[i] ?? ''} onChange={(e) => { const arr = L.signatures.map((_, k) => L.signature_images[k] ?? null); arr[i] = e.target.value || null; set({ signature_images: arr }); }}>
                <option value="">— เว้นว่างให้เซ็นมือ —</option>{signList.map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}</select></Field>)}
            <Field label="ข้อความท้ายเอกสาร" wide><input value={L.footer} maxLength={300} placeholder="เช่น สินค้าซื้อแล้วไม่รับคืน" onChange={(e) => set({ footer: e.target.value })} /></Field>
          </div>}
        </div>
        <div className="pf-preview">
          <p className="muted small">{sampleData ? `ตัวอย่างจากเอกสารล่าสุด ${sampleData.doc_no}` : sample.isLoading ? 'กำลังโหลดตัวอย่าง…' : 'ยังไม่มีเอกสารชนิดนี้ — ตัวอย่างจะแสดงเมื่อมีเอกสาร'}</p>
          {sampleData && preview && <div className="ds-preview"><PrintSheet data={sampleData} form={preview} prior={0} ys={ys} images={images} /></div>}
        </div>
      </div>}
      {askDel && <Confirm title="กลับไปใช้ต้นแบบ" danger text={`ลบแบบฟอร์มของบริษัท ${scope} หมายเลข ${slot} (${cur?.name ?? ''})?`} okText="ลบ" onOk={remove} onClose={() => setAskDel(false)} />}
    </div>
  );
}
