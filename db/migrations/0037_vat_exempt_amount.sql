-- ประเภท VAT รายบรรทัด 3 แบบ (ข้อกำหนดเจ้าของ 30/10/2569): 0 ยกเว้น · 1 มี VAT · 2 อัตรา 0% — แยกมูลค่ายกเว้นจากอัตรา 0% (ภ.พ.30 ข้อ 2 / ข้อ 3)
ALTER TABLE doc_header ADD COLUMN exempt_amount numeric(18,2) DEFAULT 0 NOT NULL;
COMMENT ON COLUMN doc_header.exempt_amount IS 'มูลค่าที่ได้รับยกเว้น VAT (รายการรหัส VAT 0 — ภ.พ.30 ข้อ 3)';
ALTER TABLE tax_vat_entry ADD COLUMN exempt_amount numeric(18,2) DEFAULT 0 NOT NULL;
COMMENT ON COLUMN tax_vat_entry.exempt_amount IS 'มูลค่าที่ได้รับยกเว้น VAT (ภ.พ.30 ข้อ 3)';
COMMENT ON COLUMN tax_vat_entry.zero_rate_amount IS 'มูลค่าอัตรา 0% (ข้อมูลที่ย้ายจาก Express รวมยอดยกเว้น) [Express: ISVAT.AMTRAT0]';
COMMENT ON COLUMN md_item.vat_code IS 'ประเภท VAT ของสินค้า (0=ยกเว้น 1=มี VAT 2=อัตรา 0% ว่าง=มี VAT) [Express: STMAS.VATCOD]';
COMMENT ON COLUMN doc_line.vat_code IS 'ประเภท VAT รายบรรทัด (0=ยกเว้น 1=มี VAT 2=อัตรา 0%) [Express: VATCOD]';
