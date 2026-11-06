-- คืนเงินมัดจำที่มี VAT ด้วยใบลดหนี้ (06/11/2569 — เจ้าของ "คืนเงินมัดจำที่มี VAT ด้วยใบลดหนี้"):
-- เก็บภาษีขายที่ลดต่อใบมัดจำในใบคืนเงินมัดจำ (RD) — ใบที่คืนครบปิดภาษีของใบมัดจำได้ตรงสตางค์ (ภาษีของใบมัดจำ − ภาษีของใบคืนอื่น)
ALTER TABLE doc_link ADD COLUMN vat_amount numeric(18,2);
COMMENT ON COLUMN doc_link.vat_amount IS 'ภาษีขายที่ลดของยอดนี้ (ใบคืนเงินมัดจำ RD ที่คืนมัดจำมี VAT = ใบลดหนี้ · 0 = มัดจำไม่มี VAT · ว่าง = ลิงก์ชนิดอื่น)';
-- ใบคืนเงินมัดจำที่บันทึกก่อนหน้านี้คืนเฉพาะมัดจำไม่มี VAT
UPDATE doc_link SET vat_amount = 0 WHERE link_type = 'DEPOSIT' AND to_header_id IN (SELECT id FROM doc_header WHERE doc_class = 'RD');
