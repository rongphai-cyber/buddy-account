import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, type Location } from 'react-router-dom';
import { net } from './api';
import { Modal } from './ui';
import { isReadOnlyNow } from './roflag';

/**
 * งานที่ยังไม่บันทึก — ด่านเดียวทั้งโปรแกรม (เจ้าของ 19/11/2569 "คีย์มัดจำอยู่ … พอไปคลิกเมนูอื่นๆ … เอกสารที่กำลังบันทึกหายไปเฉยๆ (เงียบๆ) เช็คระบบอื่นๆด้วย" · HANDOFF 149)
 * - ทุกหน้าจอที่แก้ข้อมูลได้ลงทะเบียนสถานะ "มีการแก้ไขที่ยังไม่บันทึก" ด้วย useUnsaved (useDocEdit ทำให้ทุกหน้าเอกสาร · Modal ทำให้ทุกหน้าต่างแบบฟอร์มที่มีปุ่มบันทึก)
 * - ออกจากหน้า (เมนู ค้นหาเมนู ลิงก์ ⏮◀▶⏭ รายการ/Esc ปิดหน้าจอ + ใหม่ ย้อนกลับ/ไปข้างหน้าของเบราว์เซอร์) → useBlocker ถามก่อน
 * - เปลี่ยนบริษัท/สาขา ออกจากระบบ (ไม่ใช่การเปลี่ยนหน้า) → เรียก confirmLeave() ก่อน · ปิดแท็บ/รีเฟรช/พิมพ์ที่อยู่ = beforeunload ของเบราว์เซอร์
 * หน้าต่าง: บันทึก F9 (บันทึกสำเร็จแล้วจึงไปต่อ · ไม่ผ่าน = อยู่หน้าเดิม เห็นข้อผิดพลาด) · ไม่บันทึก — ทิ้งการแก้ไข · กลับไปคีย์ต่อ Esc (ปุ่มเริ่มต้น — Enter พลาดไม่ทิ้งงาน)
 */
type Entry = { id: number; dirty: boolean; word: string; save?: () => unknown; discard?: () => void };
const entries = new Map<number, Entry>();
let seq = 0;
let bypassUntil = 0;
/** หน้าจอ/หน้าต่างที่มีการแก้ไขค้าง (ตัวบนสุด = ลงทะเบียนล่าสุด เช่น หน้าต่างแบบฟอร์มที่เปิดทับหน้าเอกสาร) */
const dirtyEntries = () => [...entries.values()].filter((e) => e.dirty);
/** ชื่องานที่ค้าง (แจ้งที่หน้าเข้าระบบเมื่อหมดเวลาเข้าระบบระหว่างคีย์) */
export const dirtyWords = () => dirtyEntries().map((e) => e.word);
export const anyDirty = () => Date.now() > bypassUntil && dirtyEntries().length > 0;
/** ผู้ใช้เลือกออกแล้ว (ทิ้ง/บันทึกแล้ว) — ปล่อยการเปลี่ยนหน้าช่วงสั้น ๆ ไม่ถามซ้ำ */
const allowLeave = (ms = 8000) => { bypassUntil = Date.now() + ms; };

/**
 * ลงทะเบียนสถานะแก้ไขค้างของหน้าจอ/หน้าต่าง — dirty = ป้าย "มีการแก้ไขที่ยังไม่บันทึก"
 * save = คำสั่งบันทึกของหน้าจอ (ระบบรอจนสถานะกลับเป็นไม่ค้าง = สำเร็จ · ค้างอยู่เมื่อไม่มีงานส่งข้อมูลและไม่มีหน้าต่างเปิด = ไม่ผ่าน)
 */
export function useUnsaved(dirty: boolean, opts: { word?: string; save?: () => unknown; discard?: () => void } = {}): number {
  const id = useRef(0);
  if (!id.current) id.current = ++seq;
  const o = useRef(opts);
  o.current = opts;
  useLayoutEffect(() => {
    entries.set(id.current, { id: id.current, dirty, word: o.current.word ?? 'เอกสาร', save: o.current.save ? () => o.current.save!() : undefined, discard: o.current.discard ? () => o.current.discard!() : undefined });
  });
  useLayoutEffect(() => () => { entries.delete(id.current); }, []);
  return id.current;
}

/* ───────── หน้าต่างถาม (หนึ่งเดียว แสดงโดย UnsavedHost) ───────── */
type Ask = { word: string; canSave: boolean; resolve: (c: 'save' | 'discard' | 'stay') => void };
let showAsk: ((a: Ask | null) => void) | null = null;
let pending: Promise<boolean> | null = null;

/** กดบันทึกของหน้าจอแล้วรอผล: ไม่ค้างแล้ว/ปิดไปแล้ว = สำเร็จ · ยังค้างเมื่อไม่มีงานส่งข้อมูลและไม่มีหน้าต่างเปิด (เช่น ถามวิธีรับเงิน = รอ) = ไม่ผ่าน */
async function saveAndWait(top: Entry): Promise<boolean> {
  top.save?.();
  const start = Date.now();
  let quiet = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 120));
    const e = entries.get(top.id);
    if (!e || !e.dirty) return true;
    const busy = net.inflight > 0 || document.querySelectorAll('.modal').length > 0;
    quiet = busy ? 0 : quiet + 1;
    if (quiet >= 6 || Date.now() - start > 180_000) return false;
  }
}

/**
 * ถามก่อนออกจากงานที่ยังไม่บันทึก → true = ไปต่อได้ (ไม่มีงานค้าง/บันทึกสำเร็จ/ทิ้งแล้ว) · false = อยู่หน้าเดิม
 * ใช้กับทางออกที่ไม่ใช่การเปลี่ยนหน้า: เปลี่ยนบริษัท/สาขา ออกจากระบบ
 */
export function confirmLeave(only?: number): Promise<boolean> {
  const mine = () => dirtyEntries().filter((e) => only === undefined || e.id === only);
  if (only === undefined ? !anyDirty() : !mine().length) return Promise.resolve(true);
  if (pending) return pending;
  pending = (async () => {
    try {
      for (let round = 0; round < 5; round++) {
        const top = mine().at(-1);
        if (!top || (only === undefined && Date.now() <= bypassUntil)) return true;
        const c = await new Promise<'save' | 'discard' | 'stay'>((resolve) => showAsk ? showAsk({ word: top.word, canSave: !!top.save && !isReadOnlyNow(), resolve }) : resolve('stay'));
        showAsk?.(null);
        if (c === 'stay') return false;
        if (c === 'discard') { for (const e of mine()) e.discard?.(); if (only === undefined) allowLeave(); return true; }
        if (!(await saveAndWait(top))) return false;   // บันทึกไม่ผ่าน: อยู่หน้าเดิม เห็นข้อผิดพลาดของหน้าจอ
        if (!mine().length) { if (only === undefined) allowLeave(1500); return true; }   // ยังมีงานค้างอีกชั้น (เช่น หน้าเอกสารใต้หน้าต่างที่บันทึกแล้ว) → ถามต่อ
      }
      return false;
    } finally { pending = null; }
  })();
  return pending;
}

/** วางครั้งเดียวในแอป (ภายใน router): ด่านเปลี่ยนหน้า + ปิดแท็บ + หน้าต่างถาม */
export function UnsavedHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const nav = useNavigate();
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => { showAsk = setAsk; return () => { showAsk = null; }; }, []);
  // ปุ่มเริ่มต้น = กลับไปคีย์ต่อ (Modal โฟกัสปุ่มหลักก่อน — ย้ายมาที่ปุ่มนี้หลังเปิด) · Enter พลาดไม่ทิ้งงาน
  useEffect(() => { if (ask) stay.current?.focus(); }, [ask]);
  // เปลี่ยนหน้า: ที่อยู่/เงื่อนไขต่างจากเดิม หรือกด "+ ใหม่" ที่หน้าใบใหม่ซ้ำ (เปิดใบใหม่ทับใบที่คีย์ค้าง)
  const blocker = useBlocker(({ currentLocation: c, nextLocation: n, historyAction }) =>
    anyDirty() && (c.pathname !== n.pathname || c.search !== n.search || (historyAction === 'PUSH' && c.hash === n.hash)));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    // หน้าจอเพิ่งบันทึก/ทิ้งแล้วเปลี่ยนหน้าเอง (สถานะยังไม่ทันเปลี่ยนตอนตรวจ) → ปล่อยไป
    if (!anyDirty()) { blocker.proceed(); return; }
    const to: Location = blocker.location;
    blocker.reset();
    void confirmLeave().then((ok) => { if (ok) { allowLeave(3000); nav(to.pathname + to.search + to.hash, { state: to.state }); } });
  }, [blocker.state]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ปิดแท็บ/รีเฟรช/พิมพ์ที่อยู่เอง: เบราว์เซอร์ถามด้วยข้อความของเบราว์เซอร์ (แก้ข้อความไม่ได้)
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
  if (!ask) return null;
  return (
    <Modal title="มีการแก้ไขที่ยังไม่บันทึก" size="confirm" onClose={() => ask.resolve('stay')} footer={<>
      {ask.canSave && <button className="primary" onClick={() => ask.resolve('save')}>บันทึก <kbd>F9</kbd></button>}
      <button className="danger" onClick={() => ask.resolve('discard')}>ไม่บันทึก — ทิ้งการแก้ไข</button>
      <button ref={stay} onClick={() => ask.resolve('stay')}>กลับไปคีย์ต่อ <kbd>Esc</kbd></button>
    </>}>
      <UnsavedKeys onSave={ask.canSave ? () => ask.resolve('save') : undefined} />
      <p>{ask.word}ที่กำลังคีย์ยังไม่ได้บันทึก — ถ้าออกจากหน้านี้ การแก้ไขจะหายไป</p>
      <p className="hint">F9 บันทึกแล้วไปต่อ · Esc หรือ Enter กลับไปคีย์ต่อ · ← → หรือ Tab เลือกปุ่ม</p>
    </Modal>
  );
}
/** F9 ในหน้าต่างถาม = บันทึก (ชั้นปุ่มลัดของหน้าต่างบังปุ่มลัดของหน้าจอ) */
function UnsavedKeys({ onSave }: { onSave?: () => void }) {
  useEffect(() => {
    if (!onSave) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'F9') { e.preventDefault(); e.stopPropagation(); onSave(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onSave]);
  return null;
}
