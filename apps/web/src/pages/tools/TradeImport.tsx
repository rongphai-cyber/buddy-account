import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TRADE_KINDS } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { Confirm, DateText, ErrorBox, Field, KeyHints, Money, PageHead, Pill, toast, useHotkeys } from '../../ui';

const KINDS = TRADE_KINDS.filter((k) => !k.order);
type DocRow = { ref: string; row: number; date: string; party_code: string; party_name: string | null; lines: number; amount: string | null; vat_amount: string | null; net_amount: string | null; doc_no: string | null; warnings: string[] };
type Result = { ok: boolean; committed: boolean; price_type: string; vat_rate: string; docs: DocRow[]; errors: Array<{ row: number; message: string }>; file_docs: number; total_net: string };
type Defaults = { types: Array<{ id: string; code: string; name_th: string; price_type: string | null; vat_rate: string | null }>; vat_rate: number | string; price_type: string };

/** ดาวน์โหลดแบบฟอร์มตัวอย่าง (คุกกี้ session) */
async function download(url: string, fallback: string) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? 'ดาวน์โหลดไม่สำเร็จ'); }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallback;
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return name;
}
const readBase64 = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('อ่านแฟ้มไม่ได้')); r.readAsDataURL(f); });

/**
 * นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel (ข้อกำหนดเจ้าของข้อ 7, 30/10/2569)
 * เลือกชนิดเอกสาร → ดาวน์โหลดแบบฟอร์ม → เลือกแฟ้ม (ระบบตรวจทันที ยังไม่บันทึก) → นำเข้า (บันทึกและลงบัญชีทุกฉบับพร้อมกัน ผิดฉบับเดียวไม่บันทึกเลย)
 */
export function TradeImportPage() {
  const can = useCan('OT.IMPTRADE');
  const { me } = useSession();
  const qc = useQueryClient();
  // ชนิดที่ผู้ใช้เพิ่มเอกสารได้ (ตามสิทธิ์เมนูของเอกสารนั้น)
  const kinds = KINDS.filter((k) => me?.perms?.[k.menu]?.add !== false);
  const [path, setPath] = useState(kinds[0]?.path ?? 'sales-invoices');
  const K = KINDS.find((k) => k.path === path) ?? KINDS[0]!;
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<Defaults>(`/api/v1/trade-defaults/${K.cls}`) });
  const [docType, setDocType] = useState('');
  const [priceType, setPriceType] = useState('');
  const [vatRate, setVatRate] = useState('');
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  // ค่าเริ่มต้นตามประเภทเอกสาร (เหมือนหน้าบันทึกเอกสาร)
  useEffect(() => {
    const t = defs.data?.types.find((x) => x.id === docType) ?? defs.data?.types[0];
    if (!defs.data || !t) return;
    if (t.id !== docType) setDocType(t.id);
    setPriceType(t.price_type || defs.data.price_type || '2');
    setVatRate(String(Number(t.vat_rate ?? defs.data.vat_rate ?? 7)));
  }, [defs.data, docType]);
  const reset = () => { setRes(null); setErr(null); };
  const run = async (commit: boolean, f = file) => {
    if (!f || !docType || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<Result>(`/api/v1/trade-import/${K.path}`, { file_name: f.name, data: f.data, doc_type_id: docType, price_type: priceType, vat_rate: vatRate, commit });
      setRes(r);
      if (commit) {
        toast(`นำเข้า${K.label} ${r.docs.length} ฉบับแล้ว`);
        qc.invalidateQueries();
      }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    reset();
    try { const v = { name: f.name, data: await readBase64(f) }; setFile(v); await run(false, v); } catch (e) { setErr(e); }
  };
  const ready = !!res && !res.committed && res.ok && res.docs.length > 0;
  useHotkeys({ F9: can('add') && ready ? () => setAsk(true) : undefined }, [ready]);
  const partyTh = K.party === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย';
  const warnCount = res?.docs.filter((x) => x.warnings.length).length ?? 0;

  return (
    <div className="page" data-tone={K.module === 'AR' ? 'sales' : 'purchase'}>
      <PageHead eyebrow="อื่น ๆ › นำเข้าข้อมูล" title="นำเข้ารายการขาย/ซื้อจากแฟ้ม Excel"
        lead={<>หนึ่งแถวในแฟ้ม = สินค้าหนึ่งบรรทัด · แถวที่ <b>เลขที่อ้างอิง</b> เดียวกันรวมเป็นเอกสารเดียว · เลือกแฟ้มแล้วระบบ<b>ตรวจก่อน</b> (ยังไม่บันทึก) · กดนำเข้าแล้วบันทึกและลงบัญชีทุกฉบับพร้อมกัน — ถ้าผิดฉบับเดียวจะไม่บันทึกเลย · เลขที่เอกสารออกตามประเภทเอกสาร เลขที่อ้างอิงเก็บในช่อง "อ้างอิง" และกันนำเข้าซ้ำ</>}
        actions={can('add') && <button className="primary" disabled={!ready || busy} onClick={() => setAsk(true)}>นำเข้า {ready ? `${res!.docs.length} ฉบับ` : ''} <kbd>F9</kbd></button>} />
      <div className="card ti-steps">
        <div className="form-grid">
          <Field label="1. ชนิดเอกสาร" req>
            <select value={path} onChange={(e) => { setPath(e.target.value); setDocType(''); setFile(null); reset(); }}>
              <optgroup label="ขาย">{kinds.filter((k) => k.module === 'AR').map((k) => <option key={k.path} value={k.path}>{k.label}</option>)}</optgroup>
              <optgroup label="ซื้อ">{kinds.filter((k) => k.module === 'AP').map((k) => <option key={k.path} value={k.path}>{k.label}</option>)}</optgroup>
            </select>
          </Field>
          <Field label="ประเภทเอกสาร (เลขที่)" req hint={defs.data && !defs.data.types.length ? `ยังไม่มีประเภทเอกสารของ${K.label} — เพิ่มที่ เริ่มระบบ › ประเภทเอกสาร` : undefined}>
            <select value={docType} onChange={(e) => { setDocType(e.target.value); reset(); }}>{defs.data?.types.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name_th}</option>)}</select>
          </Field>
          <Field label="ประเภทราคาในแฟ้ม" hint="ราคาต่อหน่วยในแฟ้มรวมหรือแยกภาษี">
            <select value={priceType} onChange={(e) => { setPriceType(e.target.value); reset(); }}><option value="2">2 แยกภาษี (ราคาก่อน VAT)</option><option value="1">1 รวมภาษีแล้ว</option><option value="0">0 ยกเว้นภาษี</option></select>
          </Field>
          <Field label="อัตราภาษี %"><input className="r" inputMode="decimal" value={vatRate} onChange={(e) => { setVatRate(e.target.value.replace(/[^\d.]/g, '')); reset(); }} /></Field>
        </div>
        <div className="ti-actions">
          <button type="button" onClick={() => download(`/api/v1/trade-import/${K.path}/template`, `import-${K.cls}.xlsx`).then((n) => toast(`ดาวน์โหลด ${n} แล้ว`)).catch(setErr)}>⬇ 2. แบบฟอร์มตัวอย่าง {K.label} (.xlsx)</button>
          {can('add') && <label className="btn primary-soft">⬆ 3. เลือกแฟ้มที่กรอกแล้ว (.xlsx / .csv)…<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>}
          {file && <span className="muted small">แฟ้ม: <b>{file.name}</b></span>}
          {file && !res?.committed && <button type="button" disabled={busy} onClick={() => run(false)}>↻ ตรวจแฟ้มอีกครั้ง</button>}
          {busy && <span className="muted">กำลังตรวจ…</span>}
        </div>
      </div>
      <ErrorBox error={err ?? defs.error} />
      {res && <>
        <div className="ti-summary">
          {res.committed ? <Pill tone="n">✓ นำเข้าแล้ว {res.docs.length} ฉบับ</Pill> : res.ok ? <Pill tone="n">พร้อมนำเข้า {res.docs.length} ฉบับ</Pill> : <Pill tone="x">ต้องแก้ {res.errors.length} รายการ</Pill>}
          <span>ยอดรวม <b><Money v={res.total_net} /></b> บาท</span>
          {!res.committed && !res.ok && <span className="muted small">ผ่านการตรวจ {res.docs.length} จาก {res.file_docs} เอกสาร — แก้ในแฟ้มแล้วเลือกแฟ้มใหม่ (ไม่มีอะไรถูกบันทึก)</span>}
          {warnCount > 0 && <span className="warn-text small">มีคำเตือน {warnCount} ฉบับ (บันทึกได้)</span>}
        </div>
        {res.errors.length > 0 && <div className="table-wrap ti-errors">
          <table className="grid">
            <thead><tr><th style={{ width: 70 }}>แถวที่</th><th>ต้องแก้</th></tr></thead>
            <tbody>{res.errors.map((e, i) => <tr key={i}><td className="r num">{e.row}</td><td>{e.message}</td></tr>)}</tbody>
          </table>
        </div>}
        {res.docs.length > 0 && <div className="table-wrap">
          <table className="grid">
            <thead><tr>
              <th style={{ width: 60 }}>แถว</th><th style={{ width: 130 }}>เลขที่อ้างอิง</th>{res.committed && <th style={{ width: 120 }}>เลขที่เอกสาร</th>}<th style={{ width: 110 }}>วันที่</th>
              <th>{partyTh}</th><th className="r" style={{ width: 60 }}>บรรทัด</th><th className="r" style={{ width: 120 }}>มูลค่า</th><th className="r" style={{ width: 100 }}>VAT</th><th className="r" style={{ width: 120 }}>รวม</th>
            </tr></thead>
            <tbody>{res.docs.map((x) => <tr key={x.ref}>
              <td className="r num muted">{x.row}</td><td className="mono">{x.ref}</td>{res.committed && <td className="mono"><b>{x.doc_no}</b></td>}<td><DateText v={x.date} /></td>
              <td><span className="mono">{x.party_code}</span> {x.party_name}{x.warnings.map((w, i) => <div key={i} className="warn-text small">⚠ {w}</div>)}</td>
              <td className="r num">{x.lines}</td><td className="r"><Money v={x.amount} /></td><td className="r"><Money v={x.vat_amount} /></td><td className="r"><b><Money v={x.net_amount} /></b></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </>}
      <KeyHints keys={[['F9', 'นำเข้า (เมื่อตรวจผ่าน)']]} />
      {ask && res && <Confirm title={`นำเข้า${K.label}`} okText={`นำเข้า ${res.docs.length} ฉบับ`}
        text={<>บันทึก{K.label} <b>{res.docs.length}</b> ฉบับ ยอดรวม <b><Money v={res.total_net} /></b> บาท และลงบัญชีทันที — ถ้าต้องการแก้ภายหลังให้ยกเลิกทีละฉบับที่หน้า{K.label}</>}
        onOk={() => { setAsk(false); void run(true); }} onClose={() => setAsk(false)} />}
    </div>
  );
}
