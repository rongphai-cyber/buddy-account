-- T6.1 ทรัพย์สินถาวร: ค่าเสื่อมสะสมยกมา ณ วันที่ + ค่าเสื่อมที่คำนวณเอง (FAMAS.DPRAMT/LASCAL)
ALTER TABLE fa_asset ADD COLUMN accum_bf_date date;
ALTER TABLE fa_asset ADD COLUMN manual_depr numeric(18,2) DEFAULT 0 NOT NULL;
ALTER TABLE fa_asset ADD COLUMN manual_depr_to date;
COMMENT ON COLUMN fa_asset.accum_bf_date IS 'ค่าเสื่อมสะสมยกมา ณ วันที่ (ยอดยกมาครอบคลุมถึงก่อนวันนี้ · ว่าง = ยอดยกมาเป็นศูนย์ เริ่มคิดตั้งแต่วันเริ่มใช้) [Express: ISPRD.BEG1]';
COMMENT ON COLUMN fa_asset.manual_depr IS 'ค่าเสื่อมที่คำนวณเอง (ตั้งแต่ต้นปีถึงวันที่คำนวณเอง) [Express: FAMAS.DPRAMT]';
COMMENT ON COLUMN fa_asset.manual_depr_to IS 'คำนวณเองถึงวันที่ — โปรแกรมคิดต่อจากวันถัดไป [Express: FAMAS.LASCAL]';
