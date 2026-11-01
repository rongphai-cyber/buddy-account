-- อีเมลผู้จำหน่าย คู่กับอีเมลลูกค้า (ข้อกำหนดเจ้าของ 01/11/2569: ระบบซื้อ/เจ้าหนี้ทำงานเหมือนขาย/ลูกหนี้)
ALTER TABLE md_supplier ADD COLUMN email varchar(120);
COMMENT ON COLUMN md_supplier.email IS 'อีเมล (ใหม่ — คู่กับลูกค้า)';
