-- T2.5 เลขที่เอกสาร (คู่มือบทที่ 9): เลขที่ถัดไปของแต่ละประเภทเอกสาร (ISRUN.DOCNUM)
ALTER TABLE md_doc_type ADD COLUMN next_no bigint DEFAULT 1 NOT NULL;
COMMENT ON COLUMN md_doc_type.next_no IS 'เลขที่ถัดไป (ส่วนตัวเลข 7 หลักต่อท้าย prefix ไม่เริ่มใหม่ทุกปี — คู่มือบทที่ 9) [Express: ISRUN.DOCNUM]';
