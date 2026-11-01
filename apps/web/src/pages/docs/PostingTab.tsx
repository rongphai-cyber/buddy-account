import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { d } from '@buddy/core';
import { api } from '../../api';
import { ErrorBox, Money, Pill } from '../../ui';
import { DocLink } from '../../components/DocLink';

type JLine = { line_no: number; account_no: string; account_name: string; debit: string; credit: string; posting_role: string | null; resolved_from: string | null };
type Journal = { id?: string; voucher_no: string; book_code: string; book_name: string; doc_status?: string; lines: JLine[] };
const FROM: Record<string, string> = { '1': 'ประเภทเอกสาร', '2': 'แฟ้มหลัก', '3': 'บัญชีเพื่อลงรายวัน', S: 'บัญชีพัก ⚠' };

/** ตารางใบสำคัญ พร้อมที่มาของบัญชีแต่ละบรรทัด (3 ชั้นของบทที่ 10) */
function JournalBoxes({ journals }: { journals: Journal[] }) {
  return <>{journals.map((j, i) => {
    const dr = j.lines.reduce((s, l) => s.plus(d(l.debit)), d(0)), cr = j.lines.reduce((s, l) => s.plus(d(l.credit)), d(0));
    return (
      <div key={j.id ?? i} className="box">
        <p><b>{j.id ? <DocLink id={j.id} no={j.voucher_no} cls="GL" /> : <span className="mono">{j.voucher_no}</span>}</b> สมุด {j.book_code} {j.book_name} {j.doc_status === 'C' && <Pill tone="x">ยกเลิก</Pill>}</p>
        <table className="grid"><thead><tr><th style={{ width: 110 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th className="r">เดบิต</th><th className="r">เครดิต</th><th style={{ width: 150 }}>ที่มาของบัญชี</th></tr></thead>
          <tbody>{j.lines.map((l) => <tr key={l.line_no} className={l.resolved_from === 'S' ? 'row-late' : undefined}><td className="mono">{l.account_no}</td><td>{l.account_name}</td><td className="r"><Money v={l.debit} blankZero /></td><td className="r"><Money v={l.credit} blankZero /></td>
            <td className="small muted">{FROM[l.resolved_from ?? ''] ?? ''}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2} className="r">รวม</td><td className="r"><Money v={dr.toFixed(2)} /></td><td className="r"><Money v={cr.toFixed(2)} /></td><td /></tr></tfoot></table>
      </div>
    );
  })}</>;
}

/** แท็บ "ใบสำคัญที่ลงบัญชี" ของเอกสารที่บันทึกแล้ว */
export function DocJournalTab({ id }: { id: string }) {
  const journal = useQuery({ queryKey: ['doc-journal', id], queryFn: () => api.get<{ journals: Journal[] }>(`/api/v1/docs/${id}/journal`) });
  return (
    <div><ErrorBox error={journal.error} />{journal.data && <JournalBoxes journals={journal.data.journals} />}
      {journal.data && !journal.data.journals.length && <p className="muted">ยังไม่มีใบสำคัญ (ไม่เชื่อมต่อระบบบัญชี หรือเอกสารชนิดนี้ไม่ลงบัญชี)</p>}</div>
  );
}

/**
 * แท็บการลงบัญชีของทุกหน้าจอเอกสารที่ลงบัญชี (ข้อกำหนดเจ้าของ 01/11/2569)
 * บันทึกแล้ว (ดูอย่างเดียว) = ใบสำคัญจริง · ใบใหม่/กำลังแก้ไข = ตัวอย่างจากเซิร์ฟเวอร์ (บันทึกจริงแล้วถอยกลับ — ตรงกับตอนกดบันทึก)
 */
export function PostingTab({ id, path, editing, bodyOf }: { id: string | null | undefined; path: string; editing: boolean; bodyOf: () => unknown }) {
  if (id && !editing) return <DocJournalTab id={id} />;
  return <PostingPreview id={id} path={path} bodyOf={bodyOf} />;
}

function PostingPreview({ id, path, bodyOf }: { id: string | null | undefined; path: string; bodyOf: () => unknown }) {
  const [res, setRes] = useState<{ journals: Journal[]; warnings: string[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const body = bodyOf();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try { setRes(await api.post<{ journals: Journal[]; warnings: string[] }>(`/api/v1/${path}/posting-preview${id ? `?id=${id}` : ''}`, body)); } catch (e) { setErr(e); setRes(null); } finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);
  return (
    <div className="posting-preview">
      <p className="notebox">ตัวอย่างการลงบัญชี — <b>ยังไม่ได้บันทึก</b> · กดบันทึกแล้วระบบลงบัญชีตามนี้ทันที (แก้รายการแล้วกดคำนวณใหม่) <button type="button" disabled={busy} onClick={() => void run()}>{busy ? 'กำลังคำนวณ…' : '↻ คำนวณใหม่'}</button></p>
      <ErrorBox error={err} />
      {res && <JournalBoxes journals={res.journals} />}
      {res && !res.journals.length && <p className="muted">เอกสารนี้ไม่ลงบัญชี (ไม่เชื่อมต่อระบบบัญชี หรือเอกสารชนิดนี้ไม่ลงบัญชี)</p>}
      {res?.warnings.map((w) => <p key={w} className="notebox">⚠ {w}</p>)}
    </div>
  );
}
