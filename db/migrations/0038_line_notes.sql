-- หมายเหตุรายการแยกจากหมายเหตุเอกสาร (ข้อกำหนดเจ้าของ 30/10/2569): เก็บกับบรรทัดโดยตรง + ติ๊กพิมพ์
-- (เดิมเก็บใน doc_note ผูก line_id ซึ่งหายเมื่อแก้เอกสารแล้วบรรทัดถูกสร้างใหม่)
ALTER TABLE doc_line ADD COLUMN line_note text;
ALTER TABLE doc_line ADD COLUMN line_note_print boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN doc_line.line_note IS 'หมายเหตุของรายการ (หลายบรรทัด คีย์ตอนคีย์รายการ — ข้อกำหนดเจ้าของ 30/10/2569) [Express: ARTRNRM (บรรทัด)]';
COMMENT ON COLUMN doc_line.line_note_print IS 'พิมพ์หมายเหตุรายการใต้บรรทัดนี้ในเอกสาร';
ALTER TABLE doc_settlement ADD COLUMN line_note text;
ALTER TABLE doc_settlement ADD COLUMN line_note_print boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN doc_settlement.line_note IS 'หมายเหตุของรายการ (หลายบรรทัด คีย์ตอนคีย์รายการ — ข้อกำหนดเจ้าของ 30/10/2569)';
COMMENT ON COLUMN doc_settlement.line_note_print IS 'พิมพ์หมายเหตุรายการใต้บรรทัดนี้ในเอกสาร';
ALTER TABLE gl_journal_line ADD COLUMN line_note text;
ALTER TABLE gl_journal_line ADD COLUMN line_note_print boolean DEFAULT false NOT NULL;
COMMENT ON COLUMN gl_journal_line.line_note IS 'หมายเหตุของรายการ (หลายบรรทัด คีย์ตอนคีย์รายการ — ข้อกำหนดเจ้าของ 30/10/2569)';
COMMENT ON COLUMN gl_journal_line.line_note_print IS 'พิมพ์หมายเหตุรายการใต้บรรทัดนี้ในเอกสาร';
-- ย้ายหมายเหตุรายบรรทัดเดิม (รวมที่ย้ายจาก Express) มาไว้ที่บรรทัด — เดิมพิมพ์ออกอยู่แล้วจึงตั้ง "พิมพ์"
UPDATE doc_line l SET line_note = x.t, line_note_print = true
  FROM (SELECT line_id, string_agg(text, E'\n' ORDER BY seq) AS t FROM doc_note WHERE line_id IS NOT NULL AND deleted_at IS NULL GROUP BY line_id) x
 WHERE l.id = x.line_id;
UPDATE doc_note SET deleted_at = now() WHERE line_id IS NOT NULL AND deleted_at IS NULL;
