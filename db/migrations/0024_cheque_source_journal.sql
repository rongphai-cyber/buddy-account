-- T7.1 เช็คที่ป้อนจากสมุดรายวัน (S-GL-04): ผูกเช็คกับใบสำคัญ
ALTER TABLE fin_cheque ADD COLUMN source_journal_id uuid;
COMMENT ON COLUMN fin_cheque.source_journal_id IS 'ใบสำคัญที่ป้อนเช็คนี้ (บันทึกจากสมุดรายวัน S-GL-04)';
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_source_journal_id FOREIGN KEY (source_journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_source_journal_id ON fin_cheque (source_journal_id);
