-- สมุดรายวัน: แท็บภาษีหัก ณ ที่จ่ายของใบสำคัญ (ข้อกำหนดเจ้าของ 30/10/2569)
ALTER TABLE tax_wht_entry ADD COLUMN journal_id uuid;
COMMENT ON COLUMN tax_wht_entry.journal_id IS 'ใบสำคัญที่ป้อนรายการนี้ (สมุดรายวัน แท็บภาษีหัก ณ ที่จ่าย)';
ALTER TABLE tax_wht_entry ADD CONSTRAINT fk_tax_wht_entry_journal_id FOREIGN KEY (journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_tax_wht_entry_journal_id ON tax_wht_entry (journal_id);
