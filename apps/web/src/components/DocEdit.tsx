import { useEffect, useState } from 'react';
import { Modal, toast, useHotkeys } from '../ui';

/**
 * โหมดดู/แก้ไขของหน้าเอกสาร (ข้อกำหนดเจ้าของ 30/10/2569)
 * - เอกสารที่บันทึกแล้วเปิดมาแบบดูอย่างเดียว ต้องกด "แก้ไข" (Alt+E) ก่อนจึงแก้ได้ · บันทึกแล้วกลับเป็นดูอย่างเดียว
 * - คีย์ช่องสุดท้ายแล้วกด Enter → ถามบันทึก / บันทึกแล้วเพิ่มใบใหม่ / กลับไปแก้ (ใช้กับ navKey(e, ed.end))
 */
export function useDocEdit({ id, allowed, dirty, onSave, onDiscard, word = 'เอกสาร', noNew }: {
  id: string | undefined; allowed: boolean; dirty: boolean;
  onSave: (andNew?: boolean) => void; onDiscard?: () => void; word?: string;
  /** หน้าที่ไม่มี "บันทึก+ใหม่" */ noNew?: boolean;
}) {
  const [editing, setEditing] = useState(!id);
  const [ask, setAsk] = useState(false);
  useEffect(() => setEditing(!id), [id]);
  const locked = !!id && !editing;
  const start = () => { setEditing(true); toast(`แก้ไข${word} — แก้แล้วกด F9 เพื่อบันทึก`); };
  const stop = () => {
    if (dirty && !window.confirm('ทิ้งการแก้ไขที่ยังไม่บันทึก?')) return;
    setEditing(false); onDiscard?.();
  };
  useHotkeys({ 'Alt+E': id && allowed ? () => (locked ? start() : stop()) : undefined }, []);
  const editButton = id
    ? <button disabled={!allowed} onClick={() => (locked ? start() : stop())} title={allowed ? (locked ? `เปิดให้แก้ไข${word}นี้` : 'เลิกแก้ไข กลับเป็นดูอย่างเดียว') : `${word}นี้แก้ไขไม่ได้`}>{locked ? 'แก้ไข' : 'เลิกแก้ไข'} <kbd>Alt+E</kbd></button>
    : null;
  const save = (andNew?: boolean) => { setAsk(false); onSave(andNew); };
  const dialog = ask && (
    <Modal title={`คีย์ครบแล้ว — บันทึก${word}?`} size="confirm" onClose={() => setAsk(false)} footer={<>
      <button onClick={() => setAsk(false)}>กลับไปแก้ <kbd>Esc</kbd></button>
      {!noNew && <button onClick={() => save(true)}>บันทึก + เพิ่มใบใหม่</button>}
      <button className="primary" autoFocus onClick={() => save()}>บันทึก <kbd>Enter</kbd></button>
    </>}>
      <p>{id ? `บันทึกการแก้ไข${word}นี้` : `บันทึก${word}ใหม่`}{noNew ? '' : ' หรือบันทึกแล้วเริ่มใบถัดไปทันที'}</p>
      <p className="hint">← → หรือ Tab เลือกปุ่ม · Enter กดปุ่มที่เลือก · Esc กลับไปแก้</p>
    </Modal>
  );
  return {
    /** ห้ามแก้ (เอกสารที่บันทึกแล้วยังไม่กดแก้ไข) */
    locked,
    editButton,
    dialog,
    /** Enter ที่ช่องสุดท้ายของหน้า */
    end: () => { if (!locked) setAsk(true); },
    /** หลังบันทึกเอกสารเดิมสำเร็จ — กลับเป็นดูอย่างเดียว */
    lock: () => setEditing(false),
  };
}
