-- กุญแจ API อ่าน/พิมพ์เอกสารที่ระบบตัวเองส่งเข้ามา (HANDOFF ข้อ 87 · docs/19 ข้อ 3 — WTS-Living ดึงใบกำกับภาษี RE ของ Buddy)
-- source_system: ระบบที่ใช้กุญแจนี้ (ตั้งแล้ว X-Source-System ต้องตรง) · doc_scope S = เฉพาะเอกสารที่ระบบเดียวกันส่งเข้ามา (ค่าเริ่มต้น) A = ทุกเอกสารของบริษัท
ALTER TABLE sys_api_key ADD COLUMN source_system varchar(30);
ALTER TABLE sys_api_key ADD COLUMN doc_scope char(1) DEFAULT 'S' NOT NULL CHECK (doc_scope IN ('S','A'));
COMMENT ON COLUMN sys_api_key.source_system IS 'ระบบที่ใช้กุญแจนี้ เช่น wts-living (HANDOFF ข้อ 87) — ตั้งแล้ว X-Source-System ต้องตรง · ว่าง = ตามที่คำขอส่งมา';
COMMENT ON COLUMN sys_api_key.doc_scope IS 'อ่าน/พิมพ์เอกสารผ่าน GET /api/v1/docs/:id/print: S=เฉพาะเอกสารที่ระบบเดียวกันส่งเข้ามา A=ทุกเอกสารของบริษัท (ตามสิทธิ์ผู้ใช้)';
