/** หน้าที่เปิดอยู่เป็นโหมดดูอย่างเดียว (HANDOFF 157 · readonly.tsx ตั้งค่า) — แยกไฟล์ไม่มี import กันวนกับ session/unsaved */
let ro = false;
export const isReadOnlyNow = () => ro;
export const setReadOnlyNow = (v: boolean) => { ro = v; };
