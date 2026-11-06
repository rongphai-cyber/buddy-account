-- รหัสเหตุผลใบลดหนี้ e-Tax ของใบคืนเงินมัดจำที่มี VAT (HANDOFF ข้อ 90 · docs/19 ข้อ 8 — สำนักงานบัญชี "ไม่กำหนดรหัส ระบุเหตุผลเพิ่มเติมได้"):
-- ผู้ใช้เลือกรหัสจากรายการมาตรฐาน ETDA (CDNG01-05/99 สินค้า · CDNS01-04/99 บริการ) · ว่าง (ใบเดิม) = CDNS04 บอกเลิกสัญญาบริการ
ALTER TABLE doc_header ADD COLUMN etax_purpose_code varchar(10);
COMMENT ON COLUMN doc_header.etax_purpose_code IS 'รหัสเหตุผลใบลดหนี้ e-Tax (ETDA CDNG01-05/99 CDNS01-04/99) ของใบคืนเงินมัดจำ (RD) ที่มี VAT — ผู้ใช้เลือก (docs/19 ข้อ 8 · HANDOFF ข้อ 90) · ว่าง = ค่าเริ่มต้น CDNS04 บอกเลิกสัญญาบริการ';
