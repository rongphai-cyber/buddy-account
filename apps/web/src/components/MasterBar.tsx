import { useEffect, useState, type ReactNode } from 'react';
import { Confirm, revealSelectedRow, toast, toastError, useHotkeys } from '../ui';
import { useReadOnly } from '../readonly';

/**
 * แถบเครื่องมือหน้ากำหนดข้อมูล/แฟ้มหลัก (ข้อกำหนดเจ้าของ 01/11/2569): เพิ่ม · แก้ไข · เลิกใช้/ใช้งาน · ลบ
 * เลือกแถวด้วย ↑↓ หรือชี้เมาส์ · Enter = แก้ไขแถวที่เลือก · Insert = เพิ่ม · Delete = ลบ (ถามก่อน)
 * ชี้เมาส์ = เลือกแถว จึงห้ามให้การเลือกเปลี่ยนความสูงของหน้า (HANDOFF 203 — บรรทัดที่โผล่/หายตามแถวที่เลือกดันตารางลง
 * แถวอื่นเลื่อนมาอยู่ใต้เมาส์ การเลือกสลับไปมา จอสั่น): เหตุผลที่ลบไม่ได้อยู่ในคำแนะนำของปุ่มลบ (deleteWhy) · คำบอกแถวที่เลือกยาวแค่บรรทัดเดียว (ตัดท้าย …)
 * ปุ่มเลิกใช้/ใช้งานกว้างเท่าเดิมทั้งสองคำ
 */
export function useRowSelect<T>(rows: T[] | undefined) {
  const [sel, setSel] = useState(0);
  const n = rows?.length ?? 0;
  useEffect(() => { if (sel >= n) setSel(Math.max(0, n - 1)); }, [n, sel]);
  return { sel, setSel, n, row: (rows?.[sel] ?? null) as T | null, cls: (i: number) => (i === sel ? 'sel' : undefined), hover: (i: number) => () => setSel(i) };
}

export function MasterBar<T>({ rs, word, label, onAdd, onEdit, onToggle, isActive, onDelete, deleteText, deleteWhy, canAdd = true, canEdit = true, canDelete = true, extra, editWord }: {
  rs: ReturnType<typeof useRowSelect<T>>; word: string; label: (r: T) => string;
  onAdd?: () => void; onEdit?: (r: T) => void;
  /** เลิกใช้/ใช้งาน (สลับสถานะ) */ onToggle?: (r: T) => Promise<unknown>; isActive?: (r: T) => boolean;
  onDelete?: (r: T) => Promise<unknown>; deleteText?: (r: T) => string;
  /** เหตุผลที่ลบแถวที่เลือกไม่ได้ (แสดงเมื่อชี้ปุ่มลบ — ไม่เป็นบรรทัดในหน้า) */ deleteWhy?: string | null;
  canAdd?: boolean; canEdit?: boolean; canDelete?: boolean;
  /** ปุ่มเพิ่มเติมของหน้านั้น (ต่อจากปุ่มมาตรฐาน) */ extra?: ReactNode;
  /** คำบนปุ่มแก้ไข/คลิกแถว เช่น "สิทธิ์" (ค่าเริ่มต้น แก้ไข) */ editWord?: string;
}) {
  const [ask, setAsk] = useState<T | null>(null);
  const r = rs.row;
  // ดูอย่างเดียว (HANDOFF 164): ปุ่ม "แก้ไข" = "ดู" เปิดรายการให้ดูได้ (ช่องในหน้าต่างแก้ไม่ได้ · บันทึกไม่ได้)
  const view = useReadOnly();
  const canOpen = canEdit || view;
  useHotkeys({
    Insert: canAdd && onAdd ? onAdd : undefined,
    Enter: r && canOpen && onEdit ? () => onEdit(r) : undefined,
    Delete: r && canDelete && onDelete ? () => setAsk(r) : undefined,
    ArrowDown: rs.n ? () => { rs.setSel(Math.min(rs.sel + 1, rs.n - 1)); revealSelectedRow(); } : undefined,
    ArrowUp: rs.n ? () => { rs.setSel(Math.max(rs.sel - 1, 0)); revealSelectedRow(); } : undefined,
  }, []);
  const toggle = () => r && onToggle?.(r).then(() => toast(isActive?.(r) ? `เลิกใช้ ${label(r)} แล้ว` : `เปิดใช้ ${label(r)} แล้ว`)).catch(toastError);
  return (
    <div className="toolbar master-bar" role="toolbar" aria-label="แถบเครื่องมือ">
      {onAdd && <button className="primary" disabled={!canAdd} onClick={onAdd}>+ เพิ่ม{word} <kbd>Ins</kbd></button>}
      {onEdit && (view
        ? <button disabled={!r} onClick={() => r && onEdit(r)} title="เปิดดูรายการที่เลือก (ดูอย่างเดียว)">ดู <kbd>Enter</kbd></button>
        : <button disabled={!r || !canEdit} onClick={() => r && onEdit(r)}>{editWord ?? 'แก้ไข'} <kbd>Enter</kbd></button>)}
      {onToggle && <button disabled={!r || !canEdit} onClick={toggle}><StableLabel on={!!(r && isActive && !isActive(r))} yes="ใช้งาน" no="เลิกใช้" /></button>}
      {onDelete && <button className="danger-outline" disabled={!r || !canDelete} title={r && !canDelete ? deleteWhy ?? undefined : undefined} onClick={() => r && setAsk(r)}>ลบ <kbd>Del</kbd></button>}
      {extra}
      <span className="hint" title={r ? label(r) : undefined}>{r && <>เลือก: <b>{label(r)}</b> · </>}<span>{view ? '↑↓ เลือกแถว · คลิกแถว = ดู' : editWord ? `↑↓ เลือกแถว · คลิกแถว = ${editWord}` : '↑↓ เลือกแถว · คลิกแถว = แก้ไข'}</span></span>
      {ask && onDelete && <Confirm danger title={`ลบ${word}`} text={deleteText?.(ask) ?? `ลบ${word} ${label(ask)}? ลบได้เฉพาะรายการที่ยังไม่ถูกใช้ — ถ้าใช้แล้วให้เปลี่ยนเป็นเลิกใช้`} okText="ลบ"
        onClose={() => setAsk(null)} onOk={() => { const x = ask; setAsk(null); onDelete(x).then(() => toast(`ลบ${word} ${label(x)} แล้ว`)).catch(toastError); }} />}
    </div>
  );
}

/** ป้ายปุ่มที่สลับคำตามแถวที่เลือก: กว้างเท่าคำที่ยาวกว่าเสมอ (ปุ่มไม่หด/ขยาย แถบเครื่องมือไม่ขึ้นบรรทัดใหม่) */
function StableLabel({ on, yes, no }: { on: boolean; yes: string; no: string }) {
  return <span className="stable-label"><span className={on ? undefined : 'off'} aria-hidden={!on}>{yes}</span><span className={on ? 'off' : undefined} aria-hidden={on}>{no}</span></span>;
}

/**
 * แถบเครื่องมือตารางที่กรอกในแถว (ตารางข้อมูล · วิธีรับ/จ่ายชำระ): เพิ่มแถว · เลิกใช้/ใช้งาน · ลบแถว · ยกเลิกการแก้ไข · บันทึก
 * แถวปัจจุบัน = แถวที่เคอร์เซอร์อยู่ (cur) · Enter ช่องสุดท้าย → ไปปุ่มบันทึก (saveRef)
 */
export function GridBar({ word, cur, label, onAdd, onDelete, canDelete, isActive, onToggle, dirty, busy, onSave, onRevert, canEdit = true, saveRef }: {
  word: string; cur: number | null; label?: string;
  onAdd: () => void; onDelete: (i: number) => void; canDelete: (i: number) => boolean;
  isActive: (i: number) => boolean; onToggle: (i: number) => void;
  dirty: boolean; busy: boolean; onSave: () => void; onRevert: () => void; canEdit?: boolean;
  saveRef?: { current: HTMLButtonElement | null };
}) {
  const has = cur !== null && canEdit;
  return (
    <div className="toolbar master-bar" role="toolbar" aria-label="แถบเครื่องมือ">
      <button disabled={!canEdit} onClick={onAdd}>+ เพิ่ม{word} <kbd>Ins</kbd></button>
      <button disabled={!has} onClick={() => cur !== null && onToggle(cur)}><StableLabel on={has && !isActive(cur!)} yes="ใช้งาน" no="เลิกใช้" /></button>
      <button className="danger-outline" disabled={!has || !canDelete(cur!)} title={has && !canDelete(cur!) ? 'ใช้ในเอกสารแล้ว ลบไม่ได้ — เปลี่ยนเป็นเลิกใช้' : undefined} onClick={() => cur !== null && onDelete(cur)}>ลบแถว</button>
      <button disabled={!dirty || busy} onClick={() => window.confirm('ทิ้งการแก้ไขที่ยังไม่บันทึก?') && onRevert()}>ยกเลิกการแก้ไข</button>
      <button ref={saveRef} className="primary" disabled={!canEdit || busy || !dirty} onClick={onSave}>บันทึก <kbd>F9</kbd></button>
      <span className="hint" title={label}>{label && <>แถว: <b>{label}</b> · </>}<span>Enter ช่องสุดท้าย → ปุ่มบันทึก · ลบได้เฉพาะแถวที่ยังไม่ถูกใช้</span></span>
    </div>
  );
}
