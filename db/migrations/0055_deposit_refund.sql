-- คืนเงินมัดจำ + ใบเสร็จหักเงินมัดจำ (05/11/2569 — WTS-Living ย้ายออก): หมวดเอกสารใหม่ RD (Express ไม่มี) · doc_link DEPOSIT ใช้กับ AI → RE/RD ด้วย
COMMENT ON COLUMN doc_header.doc_class IS 'ชนิดเอกสาร = หมวดเอกสารของ Express (ISRUN.DOCTYP): ขาย QT SO AI IV HS DR CN(ลดหนี้) OI BS(วางบิล) RE RD(คืนเงินมัดจำ — Buddy เพิ่ม) | ซื้อ PO AE RR HP CP DN(ลดหนี้) OE BR PS | สินค้า OU RL JU CA | ธนาคาร BD BW BT BU BV BQ QP | เงินสดย่อย DP VR [Express: ARTRN/APTRN.RECTYP, OESO.SORECTYP, STTRN.POSOPR]';
COMMENT ON COLUMN doc_header.deposit_amount IS 'หักเงินมัดจำ (บิล IV/HS/RR/HP · ใบเสร็จ RE = มัดจำที่หักแทนเงินรับ · RD = ยอดคืนเงินมัดจำ) [Express: ADVAMT]';
COMMENT ON COLUMN doc_link.link_type IS 'FULFIL (SO→IV, PO→RR) CONVERT (QT→SO) DEPOSIT (AI→IV/HS/RE/RD, AE→RR) ADJUST (IV→DR/SR, RR→CP/GR)';
-- ประเภทเอกสาร RD คืนเงินมัดจำ ให้บริษัทที่มีอยู่ (บริษัทใหม่ได้จาก STANDARD_DOC_TYPES) — สมุดรายวันจ่าย 01 · มีรหัส RD อยู่แล้วข้าม (เพิ่มเองที่ เริ่มระบบ › เลขที่เอกสาร)
INSERT INTO md_doc_type (id, company_id, code, doc_class, module, name_th, name_en, journal_book_id, is_tax_invoice)
  SELECT gen_random_uuid(), c.id, 'RD', 'RD', 'AR', 'คืนเงินมัดจำ', 'Deposit Refund',
         (SELECT b.id FROM gl_journal_book b WHERE b.company_id = c.id AND b.code = '01' AND b.deleted_at IS NULL LIMIT 1), false
    FROM sys_company c
   WHERE c.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM md_doc_type t WHERE t.company_id = c.id AND t.code = 'RD' AND t.deleted_at IS NULL);
