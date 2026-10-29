-- T4.5 ทะเบียนหมายเลขสินค้า (S-IC-12..14): ช่องตามคู่มือที่ยังไม่มี
ALTER TABLE md_serial ADD COLUMN ref_code varchar(30);
ALTER TABLE md_serial ADD COLUMN customer_name varchar(200);
ALTER TABLE md_serial ADD COLUMN salesperson_id uuid;
ALTER TABLE md_serial ADD COLUMN print_count integer DEFAULT 0 NOT NULL;
ALTER TABLE md_serial ADD COLUMN last_printed_at timestamptz;
COMMENT ON COLUMN md_serial.ref_code IS 'รหัสอ้างอิง (สื่อความหมาย เช่น CDROM ASUS 48X) [Express: ISSN.M_INFO]';
COMMENT ON COLUMN md_serial.customer_name IS 'ชื่อลูกค้า (กรณีไม่มีรหัส) [Express: ISSN.CUSNAM]';
COMMENT ON COLUMN md_serial.salesperson_id IS 'ผู้ขาย [Express: ISSN.SLMNAM]';
COMMENT ON COLUMN md_serial.print_count IS 'จำนวนครั้งที่พิมพ์บัตรรับประกัน [Express: ISSN.PRNCNT]';
COMMENT ON COLUMN md_serial.last_printed_at IS 'พิมพ์บัตรรับประกันล่าสุด [Express: ISSN.PRNDAT]';
ALTER TABLE md_serial ADD CONSTRAINT fk_md_serial_salesperson_id FOREIGN KEY (salesperson_id) REFERENCES md_salesperson(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX IF NOT EXISTS ix_fk_md_serial_salesperson_id ON md_serial (salesperson_id);
