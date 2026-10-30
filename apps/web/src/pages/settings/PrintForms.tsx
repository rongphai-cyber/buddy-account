import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { DOC_CLASSES, normalizeLayout, PRINT_BASES, PRINT_LOGO_POS, PRINT_HEAD_FIELDS, printFamily, type PrintBase, type PrintFormEntry, type PrintLayout } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { Confirm, ErrorBox, Field, PageHead, toast, useHotkeys, useYearSystem } from '../../ui';
import { PrintSheet, type PrintData } from '../../components/DocPrint';
import { CompanyImagesPanel, useCompanyImages } from '../../components/CompanyImages';

type FormsResp = { menu: PrintFormEntry[]; custom: Array<{ slot: number; name: string; base: string; status: string }>; sample: { kind: 'doc' | 'journal'; id: string } | null };
const SCOPES = [...Object.entries(DOC_CLASSES).map(([k, v]) => ({ k, label: `${k} ${v.label}` })), { k: 'GL', label: 'GL ใบสำคัญ (สมุดรายวัน)' }];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

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
  const [base, setBase] = useState<PrintBase>('grid');
  const [L, setL] = useState<PrintLayout | null>(null);
  const [status, setStatus] = useState<'A' | 'I'>('A');
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [askDel, setAskDel] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  useEffect(() => {
    if (!forms.data) return;
    const c = forms.data.custom.find((x) => x.slot === slot);
    const m = forms.data.menu.find((x) => x.slot === slot);
    setName(m?.name ?? c?.name ?? `แบบฟอร์ม ${slot}`); setBase((m?.base ?? 'grid') as PrintBase); setStatus(c?.status === 'I' ? 'I' : 'A');
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
  const moveCol = (i: number, dir: -1 | 1) => { if (!L) return; const c = [...L.columns]; const j = i + dir; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j]!, c[i]!]; set({ columns: c }); };

  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="รายงาน › แบบฟอร์มพิมพ์เอกสาร" title="แบบฟอร์มพิมพ์เอกสาร" lead="ฟอร์ม 1–4 เป็นต้นแบบในโปรแกรม (มีเส้น/ไม่มีเส้น/ครึ่งหน้า/ต่อเนื่อง) — บันทึกทับหมายเลขเดิมหรือเพิ่มหมายเลข 5–9 ได้ เมนูพิมพ์ของเอกสารแสดงตามลำดับหมายเลข (Alt+P = ฟอร์ม 1)" />
      <div className="toolbar">
        <label>ชนิดเอกสาร <select value={scope} onChange={(e) => { if (dirty && !window.confirm('ทิ้งการแก้ไข?')) return; setSp({ scope: e.target.value }); setSlot(1); }}>{SCOPES.map((s) => <option key={s.k} value={s.k}>{s.label}</option>)}</select></label>
        <label>หมายเลขฟอร์ม <select value={slot} onChange={(e) => { if (dirty && !window.confirm('ทิ้งการแก้ไข?')) return; setSlot(Number(e.target.value)); }}>
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
          <div className="form-grid">
            <Field label="ชื่อแบบฟอร์ม (ในเมนูพิมพ์)" req wide><input value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
            <Field label="ต้นแบบ / ขนาดกระดาษ" wide hint={PRINT_BASES.find((b) => b.key === base)?.hint}><select value={base} onChange={(e) => { setBase(e.target.value as PrintBase); setDirty(true); }}>{PRINT_BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
            <Field label="หัวเรื่อง" wide hint={`ว่าง = ชื่อประเภทเอกสาร${sampleData ? ` (${sampleData.title})` : ''}`}><input value={L.title} maxLength={120} placeholder="เช่น ใบส่งของ/ใบกำกับภาษี" onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="หัวเรื่องภาษาอังกฤษ" wide><input value={L.title_en} maxLength={120} placeholder="INVOICE / TAX INVOICE" onChange={(e) => set({ title_en: e.target.value })} /></Field>
            <Field label="สำเนาที่พิมพ์ (คั่นด้วย ,)" wide hint="เช่น ต้นฉบับ, สำเนา — หนึ่งแผ่นต่อคำ ว่าง = แผ่นเดียว"><input defaultValue={L.copies.join(', ')} key={`c${slot}${scope}${L.copies.join()}`} onBlur={(e) => set({ copies: list(e.target.value) })} /></Field>
            <Field label="ขนาดอักษร (pt)"><input type="number" min={7} max={16} value={L.font_pt} onChange={(e) => set({ font_pt: Number(e.target.value) || 10 })} /></Field>
            <Field label="บรรทัดขั้นต่ำในตาราง" hint="เติมบรรทัดว่างให้สูงเท่ากันทุกใบ"><input type="number" min={0} max={40} value={L.min_rows} onChange={(e) => set({ min_rows: Number(e.target.value) || 0 })} /></Field>
            <Field label="โลโก้บริษัท" hint={images.logo ? undefined : 'ยังไม่มีโลโก้ — อัปโหลดด้านบน'}><select value={L.logo} onChange={(e) => set({ logo: e.target.value as PrintLayout['logo'] })}>{PRINT_LOGO_POS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></Field>
            <Field label="ความสูงโลโก้ (มม.)"><input type="number" min={6} max={40} value={L.logo_mm} disabled={L.logo === 'none'} onChange={(e) => set({ logo_mm: Number(e.target.value) || 18 })} /></Field>
            <Field label="แสดงในเมนูพิมพ์"><select value={status} onChange={(e) => { setStatus(e.target.value as 'A' | 'I'); setDirty(true); }}><option value="A">แสดง</option><option value="I">ซ่อนหมายเลขนี้</option></select></Field>
          </div>
          <h3 className="small">ส่วนที่พิมพ์</h3>
          <div className="pf-checks">
            {([['show_company', 'ชื่อ/ที่อยู่กิจการ'], ['show_party', 'ลูกค้า/ผู้จำหน่าย'], ['show_totals', 'ยอดรวมท้ายเอกสาร'], ['show_amount_text', 'จำนวนเงินตัวอักษร'],
              ['show_payments', 'รายการรับ/จ่ายเงิน'], ['show_notes', 'หมายเหตุ'], ['show_journal', 'รายการบัญชี (ใบสำคัญ)']] as Array<[keyof PrintLayout, string]>).map(([k, t]) =>
              <label key={k}><input type="checkbox" checked={!!L[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<PrintLayout>)} /> {t}</label>)}
          </div>
          <h3 className="small">ช่องหัวเอกสาร (นอกจากเลขที่/วันที่)</h3>
          <div className="pf-checks">{heads.map((f) => <label key={f.key}><input type="checkbox" checked={L.head_fields.includes(f.key)} onChange={(e) => set({ head_fields: e.target.checked ? [...L.head_fields, f.key] : L.head_fields.filter((x) => x !== f.key) })} /> {f.label}</label>)}</div>
          <h3 className="small">คอลัมน์ตาราง</h3>
          <table className="grid pf-cols"><thead><tr><th>แสดง</th><th>หัวคอลัมน์</th><th className="r">กว้าง</th><th>จัด</th><th /></tr></thead>
            <tbody>{L.columns.map((c, i) => <tr key={c.key}>
              <td className="c"><input type="checkbox" checked={c.show} aria-label={`แสดง ${c.label}`} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, show: e.target.checked } : x)) })} /></td>
              <td><input value={c.label} maxLength={40} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, label: e.target.value } : x)) })} aria-label="หัวคอลัมน์" /></td>
              <td><input className="r" type="number" min={3} max={80} value={c.width} style={{ width: 64 }} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, width: Number(e.target.value) || 3 } : x)) })} aria-label="ความกว้าง" /></td>
              <td><select value={c.align} onChange={(e) => set({ columns: L.columns.map((x) => (x.key === c.key ? { ...x, align: e.target.value as 'l' } : x)) })} aria-label="การจัดวาง"><option value="l">ซ้าย</option><option value="c">กลาง</option><option value="r">ขวา</option></select></td>
              <td className="nowrap"><button type="button" className="icon-btn" title="เลื่อนขึ้น" onClick={() => moveCol(i, -1)}>▲</button><button type="button" className="icon-btn" title="เลื่อนลง" onClick={() => moveCol(i, 1)}>▼</button></td>
            </tr>)}</tbody></table>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="ช่องลงชื่อ (คั่นด้วย ,)" wide hint="สูงสุด 4 ช่อง"><input defaultValue={L.signatures.join(', ')} key={`s${slot}${scope}${L.signatures.join()}`} onBlur={(e) => set({ signatures: list(e.target.value) })} /></Field>
            {L.signatures.map((s, i) => <Field key={`sg${i}${s}`} label={`รูปลายเซ็นช่อง "${s}"`} hint={signList.length ? undefined : 'เพิ่มรูปลายเซ็นด้านบนก่อน'}>
              <select value={L.signature_images[i] ?? ''} onChange={(e) => { const arr = L.signatures.map((_, k) => L.signature_images[k] ?? null); arr[i] = e.target.value || null; set({ signature_images: arr }); }}>
                <option value="">— เว้นว่างให้เซ็นมือ —</option>{signList.map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}</select></Field>)}
            <Field label="ข้อความท้ายเอกสาร" wide><input value={L.footer} maxLength={300} placeholder="เช่น สินค้าซื้อแล้วไม่รับคืน" onChange={(e) => set({ footer: e.target.value })} /></Field>
          </div>
        </div>
        <div className="pf-preview">
          <p className="muted small">{sampleData ? `ตัวอย่างจากเอกสารล่าสุด ${sampleData.doc_no}` : sample.isLoading ? 'กำลังโหลดตัวอย่าง…' : 'ยังไม่มีเอกสารชนิดนี้ — ตัวอย่างจะแสดงเมื่อมีเอกสาร'}</p>
          {sampleData && preview && <div className="ds-preview"><PrintSheet data={sampleData} form={preview} ys={ys} images={images} /></div>}
        </div>
      </div>}
      {askDel && <Confirm title="กลับไปใช้ต้นแบบ" danger text={`ลบแบบฟอร์มของบริษัท ${scope} หมายเลข ${slot} (${cur?.name ?? ''})?`} okText="ลบ" onOk={remove} onClose={() => setAskDel(false)} />}
    </div>
  );
}
