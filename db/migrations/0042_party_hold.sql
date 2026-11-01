-- ระงับการขาย (ลูกค้า) คู่กับระงับจ่าย (ผู้จำหน่าย) + เหตุผล (ข้อกำหนดเจ้าของ 01/11/2569)
ALTER TABLE md_customer ADD COLUMN on_hold boolean NOT NULL DEFAULT false;
ALTER TABLE md_customer ADD COLUMN on_hold_reason varchar(200);
ALTER TABLE md_supplier ADD COLUMN on_hold_reason varchar(200);
COMMENT ON COLUMN md_customer.on_hold IS 'ระงับการขาย (ใหม่ — คู่กับระงับจ่ายของผู้จำหน่าย)';
COMMENT ON COLUMN md_customer.on_hold_reason IS 'เหตุผลที่ระงับการขาย';
COMMENT ON COLUMN md_supplier.on_hold_reason IS 'เหตุผลที่ระงับจ่าย';
