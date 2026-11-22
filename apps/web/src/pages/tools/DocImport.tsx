import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DOC_IMPORT_KINDS, type DocImportGroup } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { Confirm, DateText, ErrorBox, Field, KeyHints, Money, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { download, readBase64 } from './TradeImport';

type DocRow = { ref: string; row: number; date: string; party: string | null; lines: number; amount: string | null; doc_no: string | null; doc_no_source: 'file' | 'auto'; warnings: string[];
  pay_source?: 'main' | 'sheet' | 'cash'; cash_remainder?: string | null; cash_name?: string | null };
type Result = { ok: boolean; committed: boolean; docs: DocRow[]; errors: Array<{ row: number; message: string }>; file_docs: number; file_warnings: string[]; total: string };
const GROUP_TH: Record<DocImportGroup, string> = { settle: 'รับ/จ่ายชำระหนี้', bank: 'ธนาคาร', stock: 'คลังสินค้า', petty: 'เงินสดย่อย' };
const PARTY_TH: Record<DocImportGroup, string> = { settle: 'คู่ค้า', bank: 'บัญชีเงินฝาก', stock: 'คลัง', petty: '' };

/**
 * นำเข้าเอกสารอื่นที่ลงบัญชีจากแฟ้ม Excel (HANDOFF 171 — เจ้าของ 21/11/2569 "ทุกเอกสารที่จะคีย์ ขอมีอ่านบิลด้วย Ai และ นำเข้า Excel")
 * รับ/จ่ายชำระหนี้ · เอกสารธนาคาร · เอกสารคลัง · จ่ายเงินสดย่อย — ขั้นตอนเดียวกับนำเข้าขาย/ซื้อ: แบบฟอร์ม → เลือกแฟ้ม (ตรวจ ไม่บันทึก) → นำเข้า (ทั้งแฟ้มหรือไม่บันทึกเลย)
 */
export function DocImportPage() {
  const can = useCan('OT.IMPTRADE');
  const { me } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const kinds = DOC_IMPORT_KINDS.filter((k) => me?.perms?.[k.menu]?.add !== false);
  const from = kinds.find((k) => k.path === sp.get('kind'));
  const [path, setPath] = useState(from?.path ?? kinds[0]?.path ?? 'ar-receipts');
  const K = DOC_IMPORT_KINDS.find((k) => k.path === path) ?? DOC_IMPORT_KINDS[0]!;
  const defs = useQuery({ queryKey: ['trade-defaults', K.cls], queryFn: () => api.get<{ types: Array<{ id: string; code: string; name_th: string }> }>(`/api/v1/trade-defaults/${K.cls}`) });
  const [docType, setDocType] = useState('');
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  useEffect(() => { const t = defs.data?.types.find((x) => x.id === docType) ?? defs.data?.types[0]; if (t && t.id !== docType) setDocType(t.id); }, [defs.data, docType]);
  const reset = () => { setRes(null); setErr(null); };
  const run = async (commit: boolean, f = file) => {
    if (!f || !docType || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<Result>(`/api/v1/doc-import/${K.path}`, { file_name: f.name, data: f.data, doc_type_id: docType, commit });
      setRes(r);
      if (commit) { toast(`นำเข้า${K.label} ${r.docs.length} ฉบับแล้ว`); qc.invalidateQueries(); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    reset();
    try { const v = { name: f.name, data: await readBase64(f) }; setFile(v); await run(false, v); } catch (e) { setErr(e); }
  };
  const ready = !!res && !res.committed && res.ok && res.docs.length > 0;
  const back = from ? () => nav(from.route) : undefined;
  useHotkeys({ F9: can('add') && ready ? () => setAsk(true) : undefined, Escape: back && !ask ? back : undefined }, [ready, ask, back]);
  const warnCount = res?.docs.filter((x) => x.warnings.length).length ?? 0;
  const fileNos = res?.docs.filter((x) => x.doc_no_source === 'file').length ?? 0;
  const paySheet = K.module === 'AR' ? 'รับชำระ' : 'จ่ายชำระ';
  const partyTh = K.group === 'settle' ? (K.module === 'AR' ? 'ลูกค้า' : 'ผู้จำหน่าย') : PARTY_TH[K.group];

  return (
    <div className="page" data-tone={K.module === 'AR' ? 'sales' : K.module === 'AP' ? 'purchase' : undefined}>
      <PageHead eyebrow="อื่น ๆ › นำเข้าข้อมูล" title="นำเข้าเอกสารจากแฟ้ม Excel"
        lead={<>หนึ่งแถวในแฟ้ม = {K.lines ? K.line : `${K.label}หนึ่งฉบับ`}{K.lines && <> · แถวที่ <b>เลขที่อ้างอิง</b> เดียวกันรวมเป็นเอกสารเดียว</>} · เลือกแฟ้มแล้วระบบ<b>ตรวจก่อน</b> (ยังไม่บันทึก) · กดนำเข้าแล้วบันทึกและลงบัญชีทุกฉบับพร้อมกัน — ถ้าผิดฉบับเดียวจะไม่บันทึกเลย · รหัสในแฟ้มต้องมีในโปรแกรมแล้ว (ไม่เพิ่มข้อมูลหลักให้) · เลขที่อ้างอิงกันนำเข้าซ้ำ</>}
        actions={<>{can('add') && <button className="primary" disabled={!ready || busy} onClick={() => setAsk(true)}>นำเข้า {ready ? `${res!.docs.length} ฉบับ` : ''} <kbd>F9</kbd></button>}
          {back && <button onClick={back} title={`กลับไปหน้า${from!.label}`}>{from!.label} <kbd>Esc</kbd></button>}</>} />
      <div className="card ti-steps">
        <div className="form-grid">
          <Field label="1. ชนิดเอกสาร" req>
            <select value={path} onChange={(e) => { setPath(e.target.value); setDocType(''); setFile(null); reset(); }}>
              {(Object.keys(GROUP_TH) as DocImportGroup[]).map((g) => <optgroup key={g} label={GROUP_TH[g]}>{kinds.filter((k) => k.group === g).map((k) => <option key={k.path} value={k.path}>{k.label}</option>)}</optgroup>)}
            </select>
          </Field>
          <Field label="ประเภทเอกสาร (เลขที่)" req hint={defs.data && !defs.data.types.length ? `ยังไม่มีประเภทเอกสารของ${K.label} — เพิ่มที่ เริ่มระบบ › ประเภทเอกสาร` : undefined}>
            <select value={docType} onChange={(e) => { setDocType(e.target.value); reset(); }}>{defs.data?.types.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name_th}</option>)}</select>
          </Field>
        </div>
        <p className="hint small">แบบฟอร์มมีเฉพาะช่องที่หน้าจอ{K.label}มี · หัวคอลัมน์สีชมพู มี * = ต้องมี · สีเหลือง = ต้องมีตามเงื่อนไข · อื่น ๆ เว้นว่างได้ (ดูแผ่น "คำอธิบาย"){K.payments ? ` · ${K.module === 'AR' ? 'รับ' : 'จ่าย'}เงินด้วยวิธีอื่น: วิธีเดียว = คอลัมน์ "วิธีชำระ" · หลายวิธี = แผ่น "${paySheet}" ใส่เฉพาะวิธีที่ไม่ใช่เงินสด ส่วนที่เหลือ = เงินสด · รวมเกินยอด = ผิด` : ''}</p>
        <div className="ti-actions">
          <button type="button" onClick={() => download(`/api/v1/doc-import/${K.path}/template`, `import-${K.cls}.xlsx`).then((n) => toast(`ดาวน์โหลด ${n} แล้ว`)).catch(setErr)}>⬇ 2. แบบฟอร์มตัวอย่าง {K.label} (.xlsx)</button>
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
          <span>ยอดรวม <b><Money v={res.total} /></b> บาท</span>
          {!res.committed && !res.ok && <span className="muted small">ผ่านการตรวจ {res.docs.length} จาก {res.file_docs} เอกสาร — แก้ในแฟ้มแล้วเลือกแฟ้มใหม่ (ไม่มีอะไรถูกบันทึก)</span>}
          {warnCount > 0 && <span className="warn-text small">มีคำเตือน {warnCount} ฉบับ (บันทึกได้)</span>}
          {fileNos > 0 && <span className="small">เลขที่ตามแฟ้ม <b>{fileNos}</b> ฉบับ · ออกเลขอัตโนมัติ {res.docs.length - fileNos} ฉบับ</span>}
          {res.file_warnings.map((w, i) => <span key={i} className="warn-text small">⚠ {w}</span>)}
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
              <th style={{ width: 60 }}>แถว</th><th style={{ width: 130 }}>เลขที่อ้างอิง</th><th style={{ width: 130 }}>เลขที่เอกสาร</th><th style={{ width: 110 }}>วันที่</th>
              {partyTh && <th>{partyTh}</th>}<th className="r" style={{ width: 90 }}>บรรทัด</th><th className="r" style={{ width: 130 }}>ยอด</th>{K.payments && <th className="r" style={{ width: 170 }}>{K.module === 'AR' ? 'รับ' : 'จ่าย'}ชำระ</th>}
            </tr></thead>
            <tbody>{res.docs.map((x) => <tr key={x.ref}>
              <td className="r num muted">{x.row}</td><td className="mono">{x.ref}</td>
              <td className="mono">{x.doc_no ? <b>{x.doc_no}</b> : <span className="muted small">ออกเลขอัตโนมัติ</span>}{!res.committed && x.doc_no_source === 'file' && <div className="muted small">เลขที่ตามแฟ้ม</div>}</td>
              <td><DateText v={x.date} /></td>
              {partyTh && <td>{x.party}{x.warnings.map((w, i) => <div key={i} className="warn-text small">⚠ {w}</div>)}</td>}
              <td className="r num">{x.lines}</td><td className="r"><b><Money v={x.amount} /></b></td>
              {K.payments && <td className="r small">{x.pay_source === 'sheet' ? `จากแผ่น${paySheet}` : x.pay_source === 'main' ? 'วิธีชำระจากแผ่นนำเข้า' : 'เงินสดทั้งหมด'}{x.cash_remainder && <div>{x.cash_name ?? 'เงินสด'} (ส่วนที่เหลือ) <Money v={x.cash_remainder} /></div>}</td>}
            </tr>)}</tbody>
          </table>
        </div>}
      </>}
      <KeyHints keys={[['F9', 'นำเข้า (เมื่อตรวจผ่าน)'], ...(back ? [['Esc', `กลับไปหน้า${from!.label}`] as [string, string]] : [])]} />
      {ask && res && <Confirm title={`นำเข้า${K.label}`} okText={`นำเข้า ${res.docs.length} ฉบับ`}
        text={<>บันทึก{K.label} <b>{res.docs.length}</b> ฉบับ ยอดรวม <b><Money v={res.total} /></b> บาท และลงบัญชีทันที — ถ้าต้องการแก้ภายหลังให้ยกเลิกทีละฉบับที่หน้า{K.label}</>}
        onOk={() => { setAsk(false); void run(true); }} onClose={() => setAsk(false)} />}
    </div>
  );
}
