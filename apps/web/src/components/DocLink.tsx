import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { docPath } from '@buddy/core';
import { api } from '../api';
import { ErrorBox } from '../ui';

/**
 * เลขที่เอกสารอ้างอิงที่คลิกเปิดเอกสารนั้นได้ (ข้อกำหนดเจ้าของ 30/10/2569 — ทุกแท็บ ทุกหน้าจอ)
 * cls = doc_class ('GL' = ใบสำคัญ) · ไม่รู้ชนิด = ไปหน้า /doc/:id ให้ระบบหาเอง
 * keep = หน้าปัจจุบันมีงานที่ยังไม่บันทึก → เปิดในแท็บใหม่ ไม่ทิ้งงานที่คีย์ค้าง
 */
export function DocLink({ id, no, cls, opening, keep, children }: {
  id: string | null | undefined; no: string | null | undefined; cls?: string | null; opening?: boolean; keep?: boolean; children?: React.ReactNode;
}) {
  const nav = useNavigate();
  const text = children ?? no;
  if (!no && !children) return null;
  const to = id ? (cls ? docPath(cls, id, opening) : `/doc/${id}`) : null;
  if (!to) return <span className="mono">{text}</span>;
  return (
    <a href={to} className="doc-link mono" title={`เปิดเอกสาร ${no ?? ''}${keep ? ' (แท็บใหม่ — งานที่ยังไม่บันทึกอยู่ที่หน้านี้)' : ''}`} target={keep ? '_blank' : undefined} rel={keep ? 'noopener' : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (keep || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault(); nav(to);
      }}>{text}</a>
  );
}

/** /doc/:id — หาชนิดเอกสารแล้วเปิดหน้าจอของเอกสารนั้น (แทนที่ประวัติ กด ย้อนกลับ แล้วกลับหน้าเดิม) */
export function DocLocatePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    api.get<{ doc_no: string; doc_class: string; is_opening: boolean }>(`/api/v1/locate/doc/${id}`).then((h) => {
      if (!live) return;
      const to = docPath(h.doc_class, id, h.is_opening);
      if (to) nav(to, { replace: true }); else setErr(new Error(`เอกสาร ${h.doc_no} (${h.doc_class}) ไม่มีหน้าจอให้เปิด — ดูได้จากรายงานหรือใบสำคัญที่ลงบัญชี`));
    }, (e) => live && setErr(e));
    return () => { live = false; };
  }, [id, nav]);
  return <div className="page">{err ? <ErrorBox error={err} /> : <p className="muted">กำลังเปิดเอกสาร…</p>}</div>;
}
