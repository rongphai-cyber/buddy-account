import { useState } from 'react';
import { Modal, useHotkeys } from '../ui';
import { focusAfterTable } from './LkSelect';

/**
 * Enter ที่ช่องรหัสของบรรทัดว่าง (มีรายการแล้วอย่างน้อย 1 บรรทัด) — ไม่ข้ามออกจากตารางเงียบ ๆ แต่ถามว่าจะทำอะไรต่อ
 * (เจ้าของ 18/11/2569: "Enter ต้องไปแถวที่ 2 ต่อ ถ้าว่างต้องมีข้อมูลให้เลือก หรือไม่คีย์ต่อก็ … ไปหัวข้อบันทึก หรือ F9 เพื่อบันทึก … ไม่ใช่ Enter แล้วผ่านไป")
 * ใช้: const le = useLineEnd({ onSave: () => save() }); <SearchPick … onEmptyEnter={le.onEmptyEnter} /> … {le.dialog}
 */
export function useLineEnd({ onSave, word = 'สินค้า' }: { onSave: () => void; word?: string }) {
  const [at, setAt] = useState<HTMLInputElement | null>(null);
  const close = (then?: (el: HTMLInputElement) => void) => {
    const el = at;
    setAt(null);
    if (el) setTimeout(() => (then ? then(el) : el.focus()), 0);
  };
  const dialog = at && <LineEndDialog word={word}
    onPick={() => close((el) => { el.focus(); (el.parentElement?.querySelector('.pick-btn') as HTMLButtonElement | null)?.click(); })}
    onSave={() => close(() => onSave())}
    onFoot={() => close((el) => focusAfterTable(el))}
    onBack={() => close()} />;
  return { onEmptyEnter: (el: HTMLInputElement) => setAt(el), dialog };
}

function LineEndDialog({ word, onPick, onSave, onFoot, onBack }: { word: string; onPick: () => void; onSave: () => void; onFoot: () => void; onBack: () => void }) {
  // ชั้นปุ่มลัดของหน้าต่างนี้ (อยู่เหนือ "กำแพง" ของ Modal เพราะ effect ของตัวนี้ทำหลัง Modal)
  useHotkeys({ F9: onSave, 'Ctrl+S': onSave });
  return (
    <Modal title={`รายการ${word} — จะทำอะไรต่อ?`} size="confirm" onClose={onBack} footer={<>
      <button onClick={onBack}>กลับไปคีย์ต่อ <kbd>Esc</kbd></button>
      <button onClick={onFoot}>ไปส่วนท้าย (หมายเหตุ)</button>
      <button onClick={onSave}>บันทึก <kbd>F9</kbd></button>
      <button className="primary" autoFocus onClick={onPick}>เลือก{word} <kbd>Enter</kbd></button>
    </>}>
      <p>บรรทัดนี้ยังว่าง — เลือก{word}เพิ่มอีกบรรทัด หรือคีย์ครบแล้วให้บันทึก</p>
      <p className="hint">← → หรือ Tab เลือกปุ่ม · Enter กดปุ่มที่เลือก · F9 บันทึก · Esc กลับไปช่องรหัส</p>
    </Modal>
  );
}
