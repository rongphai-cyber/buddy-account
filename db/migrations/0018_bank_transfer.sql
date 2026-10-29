-- T4.6 โอนเงินระหว่างบัญชี (BT): บัญชีปลายทาง
ALTER TABLE doc_header ADD COLUMN to_bank_account_id uuid;
COMMENT ON COLUMN doc_header.to_bank_account_id IS 'โอนเข้าบัญชี (โอนเงินระหว่างบัญชี BT)';
ALTER TABLE doc_header ADD CONSTRAINT fk_doc_header_to_bank_account_id FOREIGN KEY (to_bank_account_id) REFERENCES md_bank_account(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_doc_header_to_bank_account_id ON doc_header (to_bank_account_id);
