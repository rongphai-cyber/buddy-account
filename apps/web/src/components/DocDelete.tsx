import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Confirm, Field, toast, toastError, useHotkeys } from '../ui';

/**
 * ป้าย "เอกสารยกเลิก" สีแดงข้างเลขที่ (ข้อกำหนดเจ้าของ 30/10/2569): เอกสารยังแสดงอยู่ แต่ยอดไม่นำไปใช้ที่ใด และไม่ลงบัญชี
 * คู่กับคลาส `doc-cancelled` ที่หน้าจอ — ตัวเลข/รายการขีดฆ่า
 */
export function CancelStamp({ show, reason }: { show: boolean; reason?: string | null }) {
  if (!show) return null;
  return <span className="cancel-stamp" role="status" title={reason ? `เหตุผล: ${reason}` : undefined}><span>เอกสารยกเลิก</span>{reason ? <small>{`— ${reason}`}</small> : null}</span>;
}

/**
 * ปุ่ม "ลบ" (Alt+D): ลบเอกสารออกจากระบบ — ไม่แสดงที่ใดอีก เลขที่ว่างให้ใช้ใหม่ได้ (ประวัติยังอยู่ในบันทึกการทำงาน)
 * เอกสารที่ยังไม่ยกเลิก: ยกเลิกให้ก่อนแล้วลบในขั้นเดียว · cancelUrl = API ยกเลิกของหน้าจอนั้น
 */
const DEL_NOTE = 'เอกสารจะไม่แสดงในรายการ รายงาน และบัญชีแยกประเภทอีก · เลขที่นี้ว่างให้ใช้ใหม่ได้ · ประวัติการลบเก็บไว้ในบันทึกการทำงาน';
const NOT_CANCELLED = 'เอกสารนี้ยังไม่ได้ยกเลิก — ระบบจะยกเลิกให้ก่อน (ยกเลิกใบสำคัญ คืนสต๊อก ฯลฯ) แล้วจึงลบ';
export function DocDelete({ kind, id, docNo, cancelled, cancelUrl, listPath, canDelete, canCancel }: {
  kind: 'doc' | 'journal'; id: string | null | undefined; docNo?: string | null; cancelled: boolean; cancelUrl: string; listPath: string; canDelete: boolean; canCancel: boolean;
}) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState('');
  const allowed = !!id && canDelete && (cancelled || canCancel);
  useHotkeys({ 'Alt+D': allowed ? () => setAsk(true) : undefined });
  const run = async () => {
    if (!reason.trim()) return toast('ระบุเหตุผลที่ลบก่อน', 'warn');
    try {
      if (!cancelled) await api.post(cancelUrl, { reason: reason.trim() });
      const r = await api.post<{ doc_no: string }>(`/api/v1/docs/${kind}/${id}/delete`, { reason: reason.trim() });
      setAsk(false);
      toast(`ลบ ${r.doc_no} แล้ว — ไม่แสดงในระบบอีก เลขที่นี้ว่างให้ใช้ใหม่ได้`);
      await qc.invalidateQueries();
      nav(listPath, { replace: true });
    } catch (e) { setAsk(false); await qc.invalidateQueries(); toastError(e); }
  };
  return <>
    <button className="danger-outline" disabled={!allowed} onClick={() => setAsk(true)}
      title={!id ? 'บันทึกเอกสารก่อน' : !canDelete ? 'ไม่มีสิทธิ์ลบ' : 'ลบเอกสารนี้ออกจากระบบ — เลขที่ว่างให้ใช้ใหม่ (Alt+D)'}>🗑 ลบ <kbd>Alt+D</kbd></button>
    {ask && <Confirm danger title="ลบเอกสาร" okText={cancelled ? 'ลบเอกสาร' : 'ยกเลิกและลบเอกสาร'} onClose={() => setAsk(false)} onOk={run}
      text={<><b>{`ลบ ${docNo ?? ''} ออกจากระบบ?`}</b><br /><span>{DEL_NOTE}</span>
        {!cancelled && <><br /><span className="bad">{NOT_CANCELLED}</span></>}</>}>
      <Field label="เหตุผลที่ลบ" req><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void run(); } }} /></Field>
    </Confirm>}
  </>;
}

/** ปุ่ม "ปิดหน้าจอ" (Alt+X): ปิดเอกสารนี้กลับหน้าแรก — มีงานค้างให้ยืนยันก่อน */
export function CloseScreen({ dirty }: { dirty?: boolean }) {
  const nav = useNavigate();
  const close = () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ปิดหน้าจอโดยไม่บันทึก?')) nav('/'); };
  useHotkeys({ 'Alt+X': close });
  return <button onClick={close} title="ปิดหน้าจอนี้ กลับหน้าแรก (Alt+X)">✕ ปิดหน้าจอ</button>;
}
