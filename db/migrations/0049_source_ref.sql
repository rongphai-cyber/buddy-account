-- WTS Connect v1 (docs/17 B0.1): เอกสาร/ใบสำคัญที่ระบบอื่นส่งเข้าผ่าน API จำระบบต้นทาง + เลขอ้างอิง + รุ่น · ส่งซ้ำไม่สร้างซ้ำ
ALTER TABLE doc_header ADD COLUMN source_system varchar(30);
ALTER TABLE doc_header ADD COLUMN source_ref varchar(100);
ALTER TABLE doc_header ADD COLUMN source_version integer;
COMMENT ON COLUMN doc_header.source_system IS 'ระบบต้นทางที่ส่งเอกสารผ่าน API (WTS Connect v1) เช่น wts-pos wts-living wts-sop — ว่าง = คีย์ใน Buddy';
COMMENT ON COLUMN doc_header.source_ref IS 'เลขอ้างอิงของเอกสารที่ระบบต้นทาง (ส่งซ้ำด้วยเลขเดิม = ไม่สร้างซ้ำ)';
COMMENT ON COLUMN doc_header.source_version IS 'รุ่นของเอกสารต้นทาง: สูงกว่า = แก้เอกสารเดิม · ต่ำกว่า = ปฏิเสธ';
CREATE UNIQUE INDEX uq_doc_header_company_source_system_source_ref ON doc_header (company_id, source_system, source_ref) WHERE deleted_at IS NULL;
ALTER TABLE gl_journal ADD COLUMN source_system varchar(30);
ALTER TABLE gl_journal ADD COLUMN source_ref varchar(100);
ALTER TABLE gl_journal ADD COLUMN source_version integer;
COMMENT ON COLUMN gl_journal.source_system IS 'ระบบต้นทางที่ส่งเอกสารผ่าน API (WTS Connect v1) เช่น wts-pos wts-living wts-sop — ว่าง = คีย์ใน Buddy';
COMMENT ON COLUMN gl_journal.source_ref IS 'เลขอ้างอิงของเอกสารที่ระบบต้นทาง (ส่งซ้ำด้วยเลขเดิม = ไม่สร้างซ้ำ)';
COMMENT ON COLUMN gl_journal.source_version IS 'รุ่นของเอกสารต้นทาง: สูงกว่า = แก้เอกสารเดิม · ต่ำกว่า = ปฏิเสธ';
CREATE UNIQUE INDEX uq_gl_journal_company_source_system_source_ref ON gl_journal (company_id, source_system, source_ref) WHERE deleted_at IS NULL;
