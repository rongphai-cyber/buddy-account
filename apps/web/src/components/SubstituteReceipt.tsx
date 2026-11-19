import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { fmt, formatDate } from '@buddy/core';
import { api } from '../api';
import { ErrorBox, Modal, useYearSystem } from '../ui';

type Data = {
  company: { name: string; tax_id: string | null; address: string | null };
  doc_no: string; doc_date: string; cancelled: boolean; ref_no: string | null;
  lines: Array<{ date: string; description: string; amount: string }>;
  total: string; total_text: string; payer: { name: string; position: string | null } | null;
};

/**
 * ใบรับรองแทนใบเสร็จรับเงิน แบบ บ.ก.111 ของกรมสรรพากร (เจ้าของ 19/11/2569):
 * บิลไม่มีชื่อผู้ขาย (เจ้าหนี้กลาง) — ผู้จ่ายเงินเป็นพนักงานบริษัท ลงชื่อรับรองว่าจ่ายจริงและเรียกใบเสร็จจากผู้รับไม่ได้
 * คอลัมน์ วันเดือนปี / รายละเอียดรายจ่าย / จำนวนเงิน · รวม (ตัวเลข + ตัวอักษร) · ลายมือชื่อผู้จ่ายเงิน (ชื่อ ตำแหน่ง) และผู้อนุมัติ
 */
function Sheet({ x }: { x: Data }) {
  const ys = useYearSystem();
  return (
    <div className="doc-sheet sub-receipt">
      <p className="sr-form">บ.ก. 111</p>
      <h2>ใบรับรองแทนใบเสร็จรับเงิน</h2>
      <p className="sr-co">{x.company.name}{x.company.tax_id ? ` · เลขประจำตัวผู้เสียภาษี ${x.company.tax_id}` : ''}</p>
      {x.company.address && <p className="sr-co small">{x.company.address}</p>}
      <p className="sr-ref">อ้างอิงเอกสาร {x.doc_no}{x.ref_no ? ` · เลขที่บิล ${x.ref_no}` : ''}{x.cancelled ? ' · ยกเลิกแล้ว' : ''}</p>
      <table>
        <thead><tr><th style={{ width: '22%' }}>วัน เดือน ปี</th><th>รายละเอียดรายจ่าย</th><th style={{ width: '22%' }}>จำนวนเงิน</th></tr></thead>
        <tbody>
          {x.lines.map((l, i) => <tr key={i}><td className="c">{formatDate(l.date, ys)}</td><td>{l.description}</td><td className="r">{fmt(l.amount)}</td></tr>)}
          {Array.from({ length: Math.max(0, 8 - x.lines.length) }, (_, i) => <tr key={`e${i}`} className="sr-empty"><td>&nbsp;</td><td /><td /></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={2} className="r"><b>รวมทั้งสิ้น</b> ({x.total_text})</td><td className="r"><b>{fmt(x.total)}</b></td></tr></tfoot>
      </table>
      <p className="sr-cert">ข้าพเจ้า {x.payer?.name ?? '................................................'} ตำแหน่ง {x.payer?.position || '................................'}
        {' '}ขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกใบเสร็จรับเงินจากผู้รับได้ และข้าพเจ้าได้จ่ายไปในงานของ {x.company.name} โดยแท้</p>
      <div className="sr-signs">
        <div><div className="sr-line" /><div>ลงชื่อ ผู้จ่ายเงิน</div><div>({x.payer?.name ?? '................................'})</div><div>{x.payer?.position ?? ''}</div><div>วันที่ ......../......../........</div></div>
        <div><div className="sr-line" /><div>ลงชื่อ ผู้อนุมัติ</div><div>(................................)</div><div>&nbsp;</div><div>วันที่ ......../......../........</div></div>
      </div>
    </div>
  );
}

/** ปุ่มบนแถบเครื่องมือของเอกสารซื้อ/ค่าใช้จ่ายที่ใช้เจ้าหนี้กลาง: ดูทางจอ แล้วพิมพ์ */
export function SubstituteReceiptButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(false);
  const q = useQuery({ enabled: open, queryKey: ['substitute-receipt', id], queryFn: () => api.get<Data>(`/api/v1/docs/${id}/substitute-receipt`), staleTime: 0 });
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => { try { window.focus(); window.print(); } catch { done(); } }, 150);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);
  return <>
    <button type="button" onClick={() => setOpen(true)} title="บิลไม่มีชื่อผู้ขาย — พิมพ์ใบรับรองแทนใบเสร็จรับเงิน (บ.ก.111) ให้ผู้จ่ายเงินลงชื่อ">🧾 ใบรับรองแทนใบเสร็จ</button>
    {open && <Modal title="ใบรับรองแทนใบเสร็จรับเงิน (บ.ก.111)" size="wide" onClose={() => setOpen(false)}
      footer={<><button onClick={() => setOpen(false)}>ปิด</button><button className="primary" disabled={!q.data} onClick={() => setPrinting(true)} autoFocus>พิมพ์</button></>}>
      <ErrorBox error={q.error} />
      {q.data && <div className="sr-preview"><Sheet x={q.data} /></div>}
    </Modal>}
    {printing && q.data && createPortal(<div className="doc-print"><Sheet x={q.data} /></div>, document.body)}
  </>;
}
