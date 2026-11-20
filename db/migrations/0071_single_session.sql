-- 0071 1 รหัสเข้าได้ทีละ 1 เครื่อง (HANDOFF 156 · เจ้าของ 20/11/2569 "เพิ่มตัวเลือกแบบจำกัด")
-- ค่าเริ่มต้น ปิด = ทุกลูกค้าเหมือนเดิม (รหัสเดียวเข้าได้หลายเครื่อง) · ผู้ให้บริการเปิดรายลูกค้าที่หน้า ลูกค้าผู้ใช้บริการ · ผู้ดูแลของลูกค้าเปิดรายผู้ใช้ได้
ALTER TABLE sys_tenant ADD COLUMN single_session boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN sys_tenant.single_session IS '1 รหัสเข้าได้ทีละ 1 เครื่อง ทุกผู้ใช้ของลูกค้านี้ (ผู้ให้บริการตั้งที่หน้า ลูกค้าผู้ใช้บริการ · ค่าเริ่มต้น ปิด) — เข้าระบบจากเครื่องใหม่ = เครื่องเดิมออกจากระบบ · HANDOFF 156';
ALTER TABLE sys_user ADD COLUMN single_session boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN sys_user.single_session IS '1 รหัสเข้าได้ทีละ 1 เครื่อง เฉพาะผู้ใช้นี้ (เข้มกว่าค่าของลูกค้าได้ ผ่อนไม่ได้ — ลูกค้าเปิดแล้วทุกคนถูกจำกัด) · HANDOFF 156';
ALTER TABLE sys_session ADD COLUMN end_reason varchar(20);
COMMENT ON COLUMN sys_session.end_reason IS 'เหตุที่สิ้นสุด: ว่าง = ออกจากระบบเอง · REPLACED = เข้าระบบจากเครื่องอื่น (1 รหัส 1 เครื่อง · HANDOFF 156)';
