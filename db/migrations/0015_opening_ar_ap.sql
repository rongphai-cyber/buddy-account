-- T3.10 ลูกหนี้/เจ้าหนี้คงค้างยกมา (S-OB-03/04)
ALTER TABLE doc_header ADD COLUMN is_opening boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN doc_header.is_opening IS 'ลูกหนี้/เจ้าหนี้คงค้างยกมา (คู่มือ S-OB-03/04): ลงวันที่ก่อนเริ่มใช้ ไม่ลงบัญชี ไม่ตัดสต๊อก ไม่เข้าแฟ้มภาษี';
