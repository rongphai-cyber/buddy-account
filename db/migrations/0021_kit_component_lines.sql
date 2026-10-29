-- สินค้าชุดตัด/รับสต๊อกที่ส่วนประกอบ: บรรทัด K อ้างบรรทัดชุด
ALTER TABLE doc_line DROP CONSTRAINT IF EXISTS doc_line_line_kind_check;
ALTER TABLE doc_line ADD CONSTRAINT doc_line_line_kind_check CHECK (line_kind IN ('I','G','T','K'));
COMMENT ON COLUMN doc_line.line_kind IS 'I=สินค้า/บริการ G=บรรทัดบัญชี (ระบุบัญชีตรง) T=ข้อความ K=ส่วนประกอบสินค้าชุดที่ตัด/รับสต๊อก (อ้างบรรทัดชุดด้วย source_line_id)';
