-- HANDOFF 190: ผู้จ่ายค่า AI ต่อลูกค้า (เจ้าของ 25/11/2569 "ให้เลือกว่าใครเป็นคนจ่าย ... ลูกค้าบางรายให้เราเป็นจ่ายให้") — ลูกค้าเดิมทุกราย = ลูกค้าจ่ายเอง (C) เหมือนเดิม
ALTER TABLE sys_tenant ADD COLUMN ai_payer char(1) DEFAULT 'C' NOT NULL CHECK (ai_payer IN ('C','P'));
ALTER TABLE sys_tenant ADD COLUMN ai_limit_usd numeric(18,2) DEFAULT 20;
COMMENT ON COLUMN sys_tenant.ai_payer IS 'ผู้จ่ายค่า AI (HANDOFF 190): C=ลูกค้าจ่ายเอง ใช้กุญแจ API ของบริษัท (ค่าเริ่มต้น — ไม่นับโควตา AI ของแพ็กเกจ ไม่คิดส่วนเกิน AI) · P=WTS จ่ายให้ ใช้กุญแจของผู้ให้บริการ เพดานต่อเดือนรวมทุกบริษัทของลูกค้า (นับโควตา/ส่วนเกิน AI ตามแพ็กเกจ) — ผู้ให้บริการตั้งเท่านั้น';
COMMENT ON COLUMN sys_tenant.ai_limit_usd IS 'เพดานค่า AI ต่อเดือน (ดอลลาร์สหรัฐ) เมื่อ WTS จ่ายให้ — รวมทุกบริษัทของลูกค้า · ค่าเริ่มต้น 20 · ว่าง = ไม่จำกัด (HANDOFF 190)';

-- ค่า AI ของเดือนนี้ รวมทุกบริษัทของลูกค้าเจ้าของบริษัท p_company (เพดานของลูกค้าที่ WTS จ่ายให้)
-- sys_ai_usage อยู่ใต้ RLS รายบริษัท → SECURITY DEFINER อ่านข้ามบริษัทของลูกค้าเดียวกันได้ · ในคำขอของบริษัท (ตั้ง app.company_id แล้ว) ถามได้เฉพาะบริษัทที่เลือกอยู่ — ข้ามลูกค้าไม่ได้
CREATE OR REPLACE FUNCTION sys_tenant_ai_month_cost(p_company uuid) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_scope text := nullif(current_setting('app.company_id', true), '');
BEGIN
  IF v_scope IS NOT NULL AND v_scope::uuid IS DISTINCT FROM p_company THEN
    RAISE EXCEPTION 'sys_tenant_ai_month_cost: company outside the current scope' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(sum(g.cost_usd), 0) FROM sys_ai_usage g JOIN sys_company c ON c.id = g.company_id
           WHERE c.tenant_id = (SELECT x.tenant_id FROM sys_company x WHERE x.id = p_company)
             AND g.deleted_at IS NULL AND g.created_at >= date_trunc('month', now()));
END $$;
