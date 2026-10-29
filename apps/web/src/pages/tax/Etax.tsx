import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ETAX_TYPES, todayIso, type EtaxTypeCode } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { DateInput, DateText, ErrorBox, Field, KeyHints, Money, PageHead, Pill, toast, useHotkeys } from '../../ui';

type Row = { id: string; doc_no: string; doc_date: string; doc_class: string; type_code: EtaxTypeCode; party_name: string | null; net_amount: string; purpose_code: string | null; errors: string[] };
const KEY = 'buddy.etax.iv_type';
const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } }, set: (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* ไม่มีที่เก็บ */ } } };

/** ดาวน์โหลดแฟ้มจาก API (คุกกี้ session) */
async function download(url: string) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? 'สร้างแฟ้มไม่สำเร็จ'); }
  const name = decodeURIComponent(/filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'etax.zip');
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return name;
}

/**
 * ส่งออกใบกำกับภาษีอิเล็กทรอนิกส์ (T7.6) — แฟ้ม XML ตาม ETDA ขมธอ. 3-2560 รุ่น 2.0 จากเอกสารขายที่บันทึกแล้ว
 * ยังไม่ลงลายมือชื่ออิเล็กทรอนิกส์ (ต้องมีใบรับรองของกิจการ) — ใช้ส่งต่อให้ผู้ให้บริการ e-Tax/โปรแกรมลงนาม หรือตรวจรูปแบบก่อนยื่นจริง
 */
export function EtaxPage() {
  const can = useCan('FI.VAT.ETAX');
  const { me } = useSession();
  const today = me?.work_date ?? todayIso();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [ivType, setIvType] = useState<EtaxTypeCode>(() => (store.get() as EtaxTypeCode) || 'T02');
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['etax', from, to, ivType], queryFn: () => api.get<{ rows: Row[] }>('/api/v1/etax/docs', { from, to, iv_type: ivType }), staleTime: 0 });
  const rows = q.data?.rows ?? [];
  const ok = rows.filter((r) => !r.errors.length);
  const params = (ids?: string[]) => new URLSearchParams({ from, to, iv_type: ivType, ...(ids?.length ? { ids: ids.join(',') } : {}) }).toString();
  const run = async (url: string) => {
    setBusy(true); setErr(null);
    try { toast(`ดาวน์โหลด ${await download(url)} แล้ว`); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const exportZip = () => { const ids = [...pick].filter((id) => ok.some((r) => r.id === id)); void run(`/api/v1/etax/export?${params(ids)}`); };
  useHotkeys({ F9: can('print') && ok.length ? exportZip : undefined }, [ok.length, pick, from, to, ivType]);
  const toggle = (id: string) => setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="page" data-tone="tax">
      <PageHead eyebrow="การเงิน › ภาษีมูลค่าเพิ่ม" title="ส่งออก e-Tax Invoice (XML)"
        lead={<>สร้างแฟ้ม XML ตามมาตรฐาน ETDA ขมธอ. 3-2560 จากใบกำกับภาษีขาย ใบลดหนี้ และใบเพิ่มหนี้ที่บันทึกแล้ว — <b>ยังไม่ลงลายมือชื่ออิเล็กทรอนิกส์</b> (ต้องใช้ใบรับรองของกิจการ) จึงยังยื่นกรมสรรพากรโดยตรงไม่ได้ ใช้ส่งให้ผู้ให้บริการลงนาม/นำส่ง หรือตรวจข้อมูลล่วงหน้า</>}
        actions={can('print') && <button className="primary" disabled={busy || !ok.length} onClick={exportZip}>⬇ ดาวน์โหลด {pick.size ? `ที่เลือก ${[...pick].filter((id) => ok.some((r) => r.id === id)).length}` : `ทั้งหมด ${ok.length}`} ฉบับ (zip) <kbd>F9</kbd></button>} />
      <div className="toolbar">
        <Field label="ตั้งแต่"><DateInput value={from} onChange={setFrom} /></Field>
        <Field label="ถึง"><DateInput value={to} onChange={setTo} /></Field>
        <Field label="ชื่อเอกสารของขายเชื่อ" hint="ตามที่พิมพ์บนใบกำกับภาษีของกิจการ">
          <select value={ivType} onChange={(e) => { setIvType(e.target.value as EtaxTypeCode); store.set(e.target.value); }}>
            {(['T02', 'T04', '388'] as const).map((c) => <option key={c} value={c}>{c} {ETAX_TYPES[c].name}</option>)}
          </select>
        </Field>
        <span className="muted small">พร้อม {ok.length} · ต้องแก้ {rows.length - ok.length} · ขายสด = T03 ใบเสร็จรับเงิน/ใบกำกับภาษี · ลดหนี้ 81 · เพิ่มหนี้ 80</span>
      </div>
      <ErrorBox error={err ?? q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 32 }} /><th style={{ width: 130 }}>เลขที่</th><th style={{ width: 100 }}>วันที่</th><th style={{ width: 210 }}>ชนิด e-Tax</th><th>ผู้ซื้อ</th><th className="r" style={{ width: 130 }}>ยอดรวม</th><th>ตรวจ</th><th style={{ width: 70 }} /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{!r.errors.length && <input type="checkbox" checked={pick.has(r.id)} onChange={() => toggle(r.id)} aria-label={`เลือก ${r.doc_no}`} />}</td>
                <td className="mono">{r.doc_no}</td><td><DateText v={r.doc_date} /></td>
                <td>{r.type_code} {ETAX_TYPES[r.type_code]?.name}{r.purpose_code ? <span className="muted small"> ({r.purpose_code})</span> : null}</td>
                <td>{r.party_name}</td><td className="r"><Money v={r.net_amount} /></td>
                <td>{r.errors.length ? <ul className="small bad" style={{ margin: 0, paddingLeft: 16 }}>{r.errors.map((e) => <li key={e}>{e}</li>)}</ul> : <Pill tone="n">พร้อม</Pill>}</td>
                <td>{!r.errors.length && can('print') && <button className="icon" title="ดาวน์โหลด XML ฉบับนี้" disabled={busy} onClick={() => void run(`/api/v1/etax/doc/${r.id}?iv_type=${ivType}`)}>XML</button>}</td>
              </tr>
            ))}
            {q.data && !rows.length && <tr><td colSpan={8} className="empty">ไม่มีเอกสารขายในช่วงวันที่นี้</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">แฟ้ม zip มีแฟ้ม XML ฉบับละ 1 แฟ้ม + สรุป.csv (รายการที่ข้ามพร้อมเหตุผล) · เหตุผลใบลดหนี้: มีรับคืนสินค้า = CDNG05 อื่น ๆ = 99 ตามหมายเหตุของเอกสาร · ยอดเงินในแฟ้มไม่รวม VAT ตามมาตรฐาน · เมื่อมีใบรับรองอิเล็กทรอนิกส์แล้วจะเพิ่มการลงนาม (XAdES) และนำส่ง</p>
      <KeyHints keys={[['F9', 'ดาวน์โหลด zip'], ['คลิกช่อง', 'เลือกเฉพาะบางฉบับ']]} />
    </div>
  );
}
