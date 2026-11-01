-- ทะเบียนภาษีที่ลูกค้า/ธนาคารหักเรา (ใช้เครดิต ภ.ง.ด.50/51): เลขที่/วันที่หนังสือรับรอง 50 ทวิ ที่ได้รับ (ข้อกำหนดเจ้าของ 01/11/2569)
ALTER TABLE doc_header ADD COLUMN wht_cert_no varchar(30);
ALTER TABLE doc_header ADD COLUMN wht_cert_date date;
COMMENT ON COLUMN doc_header.wht_cert_no IS 'เลขที่หนังสือรับรอง 50 ทวิ ที่ผู้จ่ายเงินออกให้เรา (ภาษีถูกหัก — ทะเบียนรายงาน 6.8)';
COMMENT ON COLUMN doc_header.wht_cert_date IS 'วันที่ในหนังสือรับรอง 50 ทวิ ที่ได้รับ';
