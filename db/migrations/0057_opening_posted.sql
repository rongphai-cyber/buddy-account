-- ยอดยกมาที่ลงบัญชี (HANDOFF ข้อ 86 · WTS-Living ลูกหนี้/เงินประกันยกมา):
-- ลูกหนี้คงค้างยกมา/มัดจำรับยกมาที่ระบบอื่นส่งมาพร้อมบัญชีคู่ → ลงบัญชี Dr ลูกหนี้ / Cr บัญชีคู่ (มัดจำ: Dr บัญชีคู่ / Cr เงินมัดจำรับ)
-- ว่าง = แบบเดิม (ไม่ลงบัญชี ยอดบัญชีอยู่ที่บันทึกยอดยกมา)
ALTER TABLE doc_header ADD COLUMN opening_offset_account_id uuid;
COMMENT ON COLUMN doc_header.opening_offset_account_id IS 'ยอดยกมาที่ลงบัญชี (ระบบอื่นส่งมา เช่น WTS-Living): บัญชีคู่ของลูกหนี้/มัดจำรับยกมา — ว่าง = ไม่ลงบัญชี (ยอดบัญชีอยู่ที่บันทึกยอดยกมา)';
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_opening_offset_account_id FOREIGN KEY (opening_offset_account_id) REFERENCES gl_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_opening_offset_account_id ON doc_header (opening_offset_account_id);
