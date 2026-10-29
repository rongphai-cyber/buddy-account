-- T4.1 ยอดสต๊อกคำนวณสดจากบรรทัดเอกสาร
-- ความเคลื่อนไหวสินค้า (สต๊อกการ์ด) จากบรรทัดเอกสาร: จำนวนหน่วยหลัก + มูลค่าต้นทุน (+เข้า −ออก) — movement 8 มูลค่าตามเครื่องหมาย
CREATE OR REPLACE VIEW v_stock_move WITH (security_invoker = true) AS
SELECT h.company_id, l.item_id, l.warehouse_id, h.doc_date, h.id AS header_id, h.doc_class, h.doc_no, l.id AS line_id, l.line_no, l.movement_code,
       l.base_qty * l.stock_effect AS qty,
       CASE WHEN l.movement_code = '8' THEN COALESCE(l.cost_amount, 0) ELSE COALESCE(l.cost_amount, 0) * l.stock_effect END AS value
FROM doc_line l JOIN doc_header h ON h.id = l.header_id
WHERE h.doc_status <> 'C' AND h.deleted_at IS NULL AND l.deleted_at IS NULL AND l.stock_effect <> 0 AND l.item_id IS NOT NULL AND l.warehouse_id IS NOT NULL;

-- ยอดสต๊อกคงเหลือต่อสินค้า×คลัง (แทน STLOC — กติกาข้อ 8 ไม่เก็บยอดสะสม)
CREATE OR REPLACE VIEW v_stock_balance WITH (security_invoker = true) AS
SELECT company_id, item_id, warehouse_id, sum(qty) AS qty, sum(value) AS value, max(doc_date) AS last_move_date
FROM v_stock_move GROUP BY 1, 2, 3;
