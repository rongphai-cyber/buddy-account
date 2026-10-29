-- T7.1 สถานะใบเสนอราคา (ตาราง 44) / เงินสดย่อย (ตาราง 53)
ALTER TABLE doc_header ADD COLUMN status_code varchar(10);
COMMENT ON COLUMN doc_header.status_code IS 'สถานะตามตารางข้อมูล: ใบเสนอราคา ตาราง 44 · ใบเบิก/จ่ายเงินสดย่อย ตาราง 53 [Express: QTSTAT / PCSTAT]';
