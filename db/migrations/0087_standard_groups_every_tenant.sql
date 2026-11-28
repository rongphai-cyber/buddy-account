-- 0087 กลุ่มผู้ใช้ตั้งต้นให้ลูกค้าทุกราย (HANDOFF 208 ข้อ C3 · เจ้าของ 28/11/2569 "ขอเพิ่มการตั้งต้นให้ด้วยได้หรือไม่ทุกบริษัทลูกค้า") — ครั้งเดียว รันซ้ำไม่เพิ่ม
-- กลุ่มและสิทธิ์ = STANDARD_GROUPS ใน apps/server/src/standard-groups.ts (สร้างรายการด้านล่างจากโค้ดนั้น · ชุดทดสอบ standard-groups-0087 เทียบผลกับปุ่ม "+ กลุ่มตั้งต้น")
-- ลูกค้าที่ยังใช้งาน (ไม่ถูกลบ ไม่ล้างข้อมูล ไม่ได้ย้ายไปเครื่องอื่น) ทั้งลูกค้าจริงและข้อมูลตัวอย่าง:
--   1) เพิ่มเฉพาะรหัสกลุ่มที่ลูกค้ายังไม่เคยมี — มีรหัสเดียวกันอยู่แล้ว (ตั้งเองหรือแก้แล้ว) = ไม่แตะ · เคยมีแต่ลบไปแล้ว = ไม่เพิ่มคืน (ผู้ดูแลกด "+ กลุ่มตั้งต้น" เองถ้าต้องการ)
--   2) สิทธิ์รายเมนูของกลุ่มที่เพิ่มใหม่เท่านั้น ในทุกบริษัทของลูกค้า — กลุ่ม/สิทธิ์/กลุ่มของผู้ใช้ที่มีอยู่เดิมไม่เปลี่ยน ไม่ลบ
--   3) แฟ้มบันทึกเหตุการณ์ STD_GROUPS_ADDED 1 แถวต่อลูกค้าที่ได้กลุ่มเพิ่ม (ลูกค้าเห็นที่ สิ่งที่ผู้ให้บริการทำกับบัญชีของท่าน)
-- กลุ่มของผู้ให้บริการ (tenant_id ว่าง) ไม่แตะ · ADMIN ไม่อยู่ในชุดนี้ (สร้างพร้อมลูกค้าอยู่แล้ว)
WITH std(code, name) AS (VALUES
  ('SALE', 'ฝ่ายขาย'),
  ('PURCH', 'ฝ่ายจัดซื้อ'),
  ('ACC', 'ฝ่ายบัญชี'),
  ('FIN', 'ฝ่ายการเงิน'),
  ('GA', 'ฝ่ายธุรการ'),
  ('HR', 'ฝ่ายบุคคล'),
  ('VIEW', 'ดูอย่างเดียว (อ่าน/พิมพ์ออกจอ)')
), rights(code, menu, r, a, e, c, d, p, ap) AS (VALUES
  ('SALE', 'SA', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('SALE', 'FI.AR', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('SALE', 'IC.STOCK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('SALE', 'IC.ITEM', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text),
  ('SALE', 'IC.SRV', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text),
  ('SALE', 'IC.KIT', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text),
  ('SALE', 'IC.PRICE', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text),
  ('SALE', 'RP.SA', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('SALE', 'RP.IC', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('SALE', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('PURCH', 'PU', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('PURCH', 'FI.AP', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('PURCH', 'IC', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('PURCH', 'RP.PU', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('PURCH', 'RP.IC', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('PURCH', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'GL', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', 'Y'),
  ('ACC', 'TX', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('ACC', 'FI', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('ACC', 'FI.BK', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('ACC', 'RP', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SA', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'PU', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'IC', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'OT.LOCK', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('ACC', 'OT.YE', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('ACC', 'OT.CHECK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.CO', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.DEF', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.DOCNO', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.PRD', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.LINK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.PAYM', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.TBL', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.IAG', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.FAG', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.DEPT', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('ACC', 'SET.BRANCH', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'FI', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('FIN', 'FI.BK', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('FIN', 'TX.WHT', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('FIN', 'FI.VAT', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'SA', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'PU', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'RP.DASH', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text),
  ('FIN', 'RP.SA', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'RP.PU', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'RP.CHQ', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'GL.JNL', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'IC.STOCK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('FIN', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'SA', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'PU', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'SA.CUS', 'Y', 'Y', 'Y', NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'PU.SUP', 'Y', 'Y', 'Y', NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'SA.SLM', 'Y', 'Y', 'Y', NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'IC.ITEM', 'Y', 'Y', 'Y', NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'IC.SRV', 'Y', 'Y', 'Y', NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'IC.KIT', 'Y', 'Y', 'Y', NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'IC.STOCK', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('GA', 'IC.PRICE', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text),
  ('GA', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('HR', 'PAY', 'Y', 'Y', 'Y', 'Y', NULL::text, 'Y', NULL::text),
  ('HR', 'RP.CENTER', 'Y', NULL::text, NULL::text, NULL::text, NULL::text, 'Y', NULL::text),
  ('VIEW', 'ALL', 'Y', 'N', 'N', 'N', 'N', 'S', 'N')
), tn AS (
  SELECT id, code FROM sys_tenant WHERE deleted_at IS NULL AND purged_at IS NULL AND moved_to IS NULL
), newg AS (
  INSERT INTO sys_user_group (tenant_id, code, name)
  SELECT tn.id, std.code, std.name FROM tn CROSS JOIN std
   WHERE NOT EXISTS (SELECT 1 FROM sys_user_group g WHERE g.tenant_id = tn.id AND g.code = std.code)
  RETURNING id, tenant_id, code
), newp AS (
  INSERT INTO sys_permission (company_id, subject_type, subject_id, menu_id, can_read, can_add, can_edit, can_cancel, can_delete, can_print, can_approve)
  SELECT c.id, 'G', ng.id, m.id, w.r, w.a, w.e, w.c, w.d, w.p, w.ap
    FROM newg ng
    JOIN rights w ON w.code = ng.code
    JOIN sys_menu m ON m.code = w.menu AND m.deleted_at IS NULL
    JOIN sys_company c ON c.tenant_id = ng.tenant_id AND c.deleted_at IS NULL
  RETURNING subject_id
)
INSERT INTO sys_activity_log (company_id, user_id, module, action, doc_no, table_name, row_id, detail)
SELECT NULL, NULL, 'SYS', 'STD_GROUPS_ADDED', left(tn.code, 30), 'sys_tenant', tn.id,
       jsonb_build_object('via', 'migration', 'migration', '0087', 'created', x.codes, 'rows', coalesce(y.n, 0),
         'companies', (SELECT count(*) FROM sys_company c WHERE c.tenant_id = tn.id AND c.deleted_at IS NULL))
  FROM tn
  JOIN (SELECT tenant_id, jsonb_agg(code ORDER BY code) AS codes FROM newg GROUP BY tenant_id) x ON x.tenant_id = tn.id
  LEFT JOIN (SELECT ng.tenant_id, count(*) AS n FROM newp JOIN newg ng ON ng.id = newp.subject_id GROUP BY ng.tenant_id) y ON y.tenant_id = tn.id;
