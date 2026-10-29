-- T4.7 ตัดยอดคงเหลือในเช็คเป็นรายได้อื่น (S-BK-12)
ALTER TABLE fin_cheque ADD COLUMN written_off_amount numeric(18,2) DEFAULT 0 NOT NULL;
ALTER TABLE fin_cheque ADD COLUMN writeoff_journal_id uuid;
COMMENT ON COLUMN fin_cheque.written_off_amount IS 'ยอดคงเหลือในเช็คที่ตัดเป็นรายได้อื่น (S-BK-12) [Express: BKTRN.REMCUT]';
COMMENT ON COLUMN fin_cheque.writeoff_journal_id IS 'ใบสำคัญตัดยอดคงเหลือเป็นรายได้';
ALTER TABLE fin_cheque ADD CONSTRAINT fk_fin_cheque_writeoff_journal_id FOREIGN KEY (writeoff_journal_id) REFERENCES gl_journal(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_fin_cheque_writeoff_journal_id ON fin_cheque (writeoff_journal_id);
