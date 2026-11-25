-- HANDOFF 186: เก็บข้อมูล 30 วันหลังเลิกใช้/ค้างชำระ แล้วลบถาวร (เจ้าของ 25/11/2569) — เหตุที่ระงับ · ลูกค้าเดิมไม่แก้ข้อมูล (วันลบที่ตั้งไว้ก่อนหน้านี้คงเดิม)
ALTER TABLE sys_tenant ADD COLUMN suspend_reason varchar(10) CHECK (suspend_reason IN ('UNPAID','OTHER'));
COMMENT ON COLUMN sys_tenant.suspend_reason IS 'เหตุที่ระงับ (สถานะ S): UNPAID=ค้างชำระ (นับ 30 วันแล้วลบข้อมูล) OTHER=เหตุอื่น เช่น ความปลอดภัย (ไม่นับ) · HANDOFF 186';
COMMENT ON COLUMN sys_tenant.purge_after IS 'ลบข้อมูลได้ตั้งแต่วันนี้ (เลิกใช้บริการ หรือระงับเพราะค้างชำระ + 30 วัน · HANDOFF 186 — ระหว่างนี้ลูกค้าขอสำเนาข้อมูลได้ · ผู้ให้บริการลบเองพร้อมพิมพ์รหัสยืนยัน)';
