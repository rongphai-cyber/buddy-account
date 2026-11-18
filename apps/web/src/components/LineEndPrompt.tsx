import { useState } from 'react';
import { focusStart, Modal, useHotkeys } from '../ui';

/**
 * บรรทัดรายการว่าง (เจ้าของ 18/11/2569 รอบ 2):
 * - Enter ที่ช่องรหัสว่าง = เปิดรายการสินค้าให้เลือกเลย (คีย์ต่อได้ทันที ไม่ถาม)
 * - Esc (ปิดรายการโดยไม่เลือก / ที่ช่องรหัสว่าง) = "ไม่คีย์ต่อแล้ว" → ถาม บันทึก (F9) · กลับไปคีย์ต่อ · ไปส่วนหัว · ยกเลิกเอกสาร (ใบใหม่)
 * ใช้: const le = useLineEnd({ onSave, onDiscard, hasLines }); <SearchPick … onEmptyEnter={le.onEmptyEnter} onEmptyEscape={le.onEmptyEscape} /> … {le.dialog}
 */
export function useLineEnd({ onSave, onDiscard, hasLines = true, word = 'สินค้า' }: { onSave: () => void; onDiscard?: () => void; hasLines?: boolean; word?: string }) {
  const [at, setAt] = useState<HTMLInputElement | null>(null);
  const openList = (el: HTMLInputElement) => { el.focus(); (el.parentElement?.querySelector('.pick-btn') as HTMLButtonElement | null)?.click(); };
  const close = (then?: (el: HTMLInputElement) => void) => {
    const el = at;
    setAt(null);
    if (el) setTimeout(() => (then ? then(el) : el.focus()), 0);
  };
  const dialog = at && <LineEndDialog word={word} hasLines={hasLines}
    onSave={() => close(() => onSave())}
    onBack={() => close()}
    onHead={() => close(() => focusStart())}
    onDiscard={onDiscard ? () => { if (window.confirm('ยกเลิกเอกสารนี้ — ทิ้งทุกอย่างที่คีย์ไว้ ไม่บันทึก?')) close(() => onDiscard()); } : undefined} />;
  return { onEmptyEnter: openList, onEmptyEscape: (el: HTMLInputElement) => setAt(el), dialog };
}

function LineEndDialog({ word, hasLines, onSave, onBack, onHead, onDiscard }: { word: string; hasLines: boolean; onSave: () => void; onBack: () => void; onHead: () => void; onDiscard?: () => void }) {
  // ชั้นปุ่มลัดของหน้าต่างนี้ (อยู่เหนือ "กำแพง" ของ Modal เพราะ effect ของตัวนี้ทำหลัง Modal)
  useHotkeys({ F9: onSave, 'Ctrl+S': onSave });
  return (
    <Modal title={`ไม่คีย์รายการ${word}ต่อแล้ว — จะทำอะไรต่อ?`} size="confirm" onClose={onBack} footer={<>
      {onDiscard && <button className="danger-outline" onClick={onDiscard}>ยกเลิกเอกสาร</button>}
      <button onClick={onHead}>ไปส่วนหัว</button>
      <button autoFocus={!hasLines} onClick={onBack}>กลับไปคีย์ต่อ <kbd>Esc</kbd></button>
      <button className="primary" autoFocus={hasLines} onClick={onSave}>บันทึก <kbd>F9</kbd></button>
    </>}>
      <p>{hasLines ? `คีย์รายการครบแล้ว — บันทึกเอกสาร หรือกลับไปคีย์${word}ต่อ` : `ยังไม่มีรายการ${word} — กลับไปคีย์ต่อ (Enter ที่ช่องรหัสเปิดรายการให้เลือก)`}</p>
      <p className="hint">← → หรือ Tab เลือกปุ่ม · Enter กดปุ่มที่เลือก · F9 บันทึก · Esc กลับไปช่องรหัส</p>
    </Modal>
  );
}
