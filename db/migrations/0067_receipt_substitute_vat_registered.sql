-- 0067 ใบรับรองแทนใบเสร็จรับเงิน + เจ้าหนี้กลาง + บริษัทไม่จด VAT (เจ้าของ 19/11/2569 · HANDOFF 144)
-- doc_header.receipt_substitute / payer_employee_id: บิลไม่มีชื่อผู้ขาย ใช้เจ้าหนี้กลาง ผู้จ่ายเงินเป็นพนักงาน พิมพ์ใบรับรองแทนใบเสร็จ (บ.ก.111) — ไม่มีภาษีซื้อ ไม่หัก ณ ที่จ่าย
-- ค่าตั้ง gen.vat_registered (ค่าเริ่มต้น จด = เหมือนเดิมทุกบริษัท) · ap.central_supplier_id (สร้างให้เมื่อใช้ครั้งแรก) · ข้อมูลเดิมไม่เปลี่ยน
ALTER TABLE doc_header ADD COLUMN receipt_substitute boolean DEFAULT false NOT NULL;
ALTER TABLE doc_header ADD COLUMN payer_employee_id uuid;
COMMENT ON COLUMN doc_header.receipt_substitute IS 'ใบรับรองแทนใบเสร็จรับเงิน (บ.ก.111) — บิลไม่มีชื่อผู้ขาย ใช้เจ้าหนี้กลาง: ไม่ใช่ใบกำกับภาษี ไม่มีภาษีซื้อ ไม่หัก ณ ที่จ่าย ยอดทั้งหมดเป็นค่าใช้จ่าย (ใหม่ — เจ้าของ 19/11/2569)';
COMMENT ON COLUMN doc_header.payer_employee_id IS 'ผู้จ่ายเงิน (พนักงานบริษัท) ที่ลงชื่อในใบรับรองแทนใบเสร็จรับเงิน (ใหม่ — เจ้าของ 19/11/2569)';
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_payer_employee_id FOREIGN KEY (payer_employee_id) REFERENCES pay_employee(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_payer_employee_id ON doc_header (payer_employee_id);
INSERT INTO sys_setting_def(id, key, module, data_type, default_value, label_th, express_field) VALUES (gen_random_uuid(), 'gen.vat_registered', 'GEN', 'bool', 'true'::jsonb, 'จดทะเบียนภาษีมูลค่าเพิ่ม (ไม่จด = VAT ในบิลซื้อ/ค่าใช้จ่ายรวมเป็นค่าใช้จ่าย ไม่มีภาษีซื้อ — เจ้าของ 19/11/2569)', '(ใหม่)') ON CONFLICT DO NOTHING;
INSERT INTO sys_setting_def(id, key, module, data_type, default_value, label_th, express_field) VALUES (gen_random_uuid(), 'ap.central_supplier_id', 'AP', 'text', 'null'::jsonb, 'เจ้าหนี้กลาง / ผู้ขายไม่ระบุชื่อ — บิลไม่มีชื่อผู้ขาย ใช้รหัสนี้ + ผู้จ่ายเงิน (พนักงาน) + ใบรับรองแทนใบเสร็จ (เจ้าของ 19/11/2569)', '(ใหม่)') ON CONFLICT DO NOTHING;
