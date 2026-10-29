-- T7.3 ผลต่างอัตราแลกเปลี่ยนในการรับ/จ่ายชำระหนี้ต่างประเทศ (บทที่ 26 S-AP-13)
ALTER TABLE doc_header ADD COLUMN fx_amount numeric(18,2) DEFAULT 0 NOT NULL;
COMMENT ON COLUMN doc_header.fx_amount IS 'กำไร(+)/ขาดทุน(−) จากอัตราแลกเปลี่ยน ในใบเสร็จ/ใบสำคัญจ่าย (บทที่ 26 — Express ใช้ช่องภาษีหัก ณ ที่จ่ายแทน)';
