import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { badRequest, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { checkOwned } from '../owned.js';
import { companySettings, setSetting } from '../company-template.js';

/**
 * WTS Solutions (docs/17 · B0.5)
 *  - payroll_source: บริษัทหนึ่งคิดเงินเดือนที่เดียว — buddy (เมนูเงินเดือนของ Buddy) หรือ wts-sop (SOP ส่งใบสำคัญเข้ามา · Buddy ปิดเมนูคิดเงินเดือน)
 *  - ตั้งค่าสำหรับ WTS-POS (ข้อ 5.7): สร้างประเภทเอกสาร/รหัสรายได้/คลังระหว่างทาง/ลูกค้าแพลตฟอร์มที่ยังไม่มี (กดซ้ำได้ — ข้ามที่มีแล้ว)
 */
export const PAYROLL_SOURCES = ['buddy', 'wts-sop'] as const;
export type PayrollSource = (typeof PAYROLL_SOURCES)[number];

export async function payrollSource(db: Db, companyId: string | null): Promise<PayrollSource> {
  if (!companyId) return 'buddy';
  return (await companySettings(db, companyId))['pay.source'] === 'wts-sop' ? 'wts-sop' : 'buddy';
}

/** ชุดที่ปุ่ม "ตั้งค่าสำหรับ WTS-POS" สร้าง — รหัสคงที่ (ตรวจซ้ำด้วยรหัส) */
export const WTS_POS_SETUP = {
  doc_types: [
    { code: 'OUR', key: 'recipe', name_th: 'ใช้วัตถุดิบตามสูตร (WTS-POS)', name_en: 'Recipe usage (WTS-POS)' },
    { code: 'OUW', key: 'waste', name_th: 'ของเสีย (WTS-POS)', name_en: 'Waste (WTS-POS)' },
    { code: 'OUS', key: 'staff_meal', name_th: 'อาหารพนักงาน (WTS-POS)', name_en: 'Staff meals (WTS-POS)' },
    { code: 'OUQ', key: 'qc', name_th: 'ชิมคุณภาพ OC (WTS-POS)', name_en: 'Quality check (WTS-POS)' },
    // ครัวกลาง (B3.3): PD = เบิกวัตถุดิบ Dr งานระหว่างทำ · PI = ปรับปรุงเพิ่ม Cr งานระหว่างทำ (ทุน/หน่วย = มูลค่า PD ÷ จำนวนผลิต)
    { code: 'OUP', key: 'production_issue', cls: 'OU', name_th: 'เบิกวัตถุดิบผลิต (ครัวกลาง)', name_en: 'Production issue (central kitchen)' },
    { code: 'JUP', key: 'production_receipt', cls: 'JU', name_th: 'รับสินค้าผลิตเสร็จ (ครัวกลาง)', name_en: 'Production receipt (central kitchen)' },
  ],
  items: [
    { code: 'POS-FOOD', name_th: 'ขายอาหาร', name_en: 'Food sales' },
    { code: 'POS-BEV', name_th: 'ขายเครื่องดื่ม', name_en: 'Beverage sales' },
    { code: 'POS-SVC', name_th: 'ค่าบริการ (Service charge)', name_en: 'Service charge' },
  ],
  customers: [
    { code: 'PF-GRAB', name: 'Grab (GrabFood)' }, { code: 'PF-LINEMAN', name: 'LINE MAN' }, { code: 'PF-FOODPANDA', name: 'foodpanda' },
    { code: 'PF-SHOPEE', name: 'ShopeeFood' }, { code: 'PF-ROBINHOOD', name: 'Robinhood' },
  ],
} as const;
type AccKey = (typeof WTS_POS_SETUP.doc_types)[number]['key'];

const setupBody = z.object({
  /** บัญชีเดบิตของประเภทเอกสารเบิกใช้ (ช่อง 1) — ว่าง = ใช้บัญชีตามการเชื่อมต่อบัญชี */
  accounts: z.object({
    recipe: z.string().uuid().nullable().optional(), waste: z.string().uuid().nullable().optional(), staff_meal: z.string().uuid().nullable().optional(), qc: z.string().uuid().nullable().optional(),
    /** ครัวกลาง: บัญชีงานระหว่างทำ — OUP เดบิต (ช่อง 1) · JUP เครดิต (ช่อง 2 ปรับปรุงเพิ่ม) */
    production_issue: z.string().uuid().nullable().optional(), production_receipt: z.string().uuid().nullable().optional(),
  }).partial().default({}),
});

export function wtsRoutes(app: FastifyInstance, db: Db) {
  app.put('/api/v1/company/payroll-source', async (req) => {
    const a = requireCompany(req);
    const { source } = parse(z.object({ source: z.enum(PAYROLL_SOURCES, { errorMap: () => ({ message: 'เลือก buddy (คิดเงินเดือนใน Buddy) หรือ wts-sop (คิดที่ WTS-HR)' }) }) }), req.body);
    const before = await payrollSource(db, a.companyId);
    await setSetting(db, a.companyId, 'pay.source', source, a.userId);
    await logActivity(db, a, { module: 'SYS', action: 'SET_PAY_SOURCE', table: 'sys_company', rowId: a.companyId, detail: { before, after: source } });
    return { source };
  });

  app.post('/api/v1/company/wts-pos-setup', async (req) => {
    const a = requireCompany(req);
    const b = parse(setupBody, req.body ?? {});
    await checkOwned(db, a.companyId, Object.entries(b.accounts).map(([k, id]) => ({ table: 'gl_account' as const, id, field: `accounts.${k}` })));
    if (Object.values(b.accounts).some(Boolean)) {
      const ids = Object.values(b.accounts).filter((x): x is string => !!x);
      const ctl = await db.selectFrom('gl_account').select('account_no').where('company_id', '=', a.companyId).where('id', 'in', ids).where('is_control', '=', true).executeTakeFirst();
      if (ctl) throw badRequest(`บัญชี ${ctl.account_no} เป็นบัญชีคุม ลงรายการไม่ได้ — เลือกบัญชีย่อย`);
    }
    const created = { doc_types: [] as string[], items: [] as string[], warehouses: [] as string[], customers: [] as string[] };
    const existing = { doc_types: [] as string[], items: [] as string[], warehouses: [] as string[], customers: [] as string[] };
    const has = async (t: 'md_doc_type' | 'md_item' | 'md_warehouse' | 'md_customer', code: string) =>
      !!(await db.selectFrom(t).select('id').where('company_id', '=', a.companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst());
    for (const t of WTS_POS_SETUP.doc_types) {
      if (await has('md_doc_type', t.code)) { existing.doc_types.push(t.code); continue; }
      const cls = 'cls' in t ? t.cls : 'OU';
      const id = (await db.insertInto('md_doc_type').values({ company_id: a.companyId, code: t.code, doc_class: cls, module: 'IC', name_th: t.name_th, name_en: t.name_en, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      const acc = b.accounts[t.key as AccKey];
      // OU: ช่อง 1 Dr บัญชีเบิกใช้ · JU (รับเพิ่ม): ช่อง 2 Cr บัญชีปรับปรุง (packages/core posting.ts)
      const slot = cls === 'JU' ? { slot: 2, role: 'ADJ_CREDIT' } : { slot: 1, role: 'ISSUE_DEBIT' };
      if (acc) await db.insertInto('md_doc_type_account').values({ company_id: a.companyId, doc_type_id: id, ...slot, account_id: acc, created_by: a.userId }).execute();
      created.doc_types.push(t.code);
    }
    for (const it of WTS_POS_SETUP.items) {
      if (await has('md_item', it.code)) { existing.items.push(it.code); continue; }
      await db.insertInto('md_item').values({ company_id: a.companyId, code: it.code, name_th: it.name_th, name_en: it.name_en, item_type: '3', vat_code: '1', created_by: a.userId }).execute();
      created.items.push(it.code);
    }
    // คลังระหว่างทางของแต่ละสาขา (ครัวกลางส่งของ → ระหว่างทาง → ร้านกดรับ — ข้อ D5)
    const branches = await db.selectFrom('sys_branch').select(['id', 'code', 'name']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('status', '=', 'A').orderBy('code').execute();
    for (const br of branches) {
      const code = `TR${br.code}`.slice(0, 10);
      if (await has('md_warehouse', code)) { existing.warehouses.push(code); continue; }
      await db.insertInto('md_warehouse').values({ company_id: a.companyId, code, name_th: `ระหว่างทาง ${br.name}`.slice(0, 120), name_en: `In transit ${br.code}`, branch_id: br.id, created_by: a.userId }).execute();
      created.warehouses.push(code);
    }
    for (const c of WTS_POS_SETUP.customers) {
      if (await has('md_customer', c.code)) { existing.customers.push(c.code); continue; }
      await db.insertInto('md_customer').values({ company_id: a.companyId, code: c.code, name: c.name, created_by: a.userId }).execute();
      created.customers.push(c.code);
    }
    await logActivity(db, a, { module: 'SYS', action: 'WTS_POS_SETUP', table: 'sys_company', rowId: a.companyId, detail: { created } });
    return {
      created, existing,
      hints: [
        'ใส่เลขผู้เสียภาษี/สาขาของลูกค้าแพลตฟอร์ม (PF-…) ที่ รายละเอียดลูกค้า — ใช้ในใบกำกับภาษีขาย',
        'กำหนดบัญชีรายได้ของรหัส POS-FOOD POS-BEV POS-SVC ที่ รายละเอียดสินค้าบริการ (ว่าง = บัญชีขายตามการเชื่อมต่อบัญชี)',
        'กำหนดบัญชีของประเภทเอกสาร OUR OUW OUS OUQ ที่ เริ่มระบบ › เลขที่เอกสาร (ว่าง = บัญชีตามการเชื่อมต่อบัญชี)',
        'ครัวกลาง: กำหนดบัญชีงานระหว่างทำที่ประเภทเอกสาร OUP (ช่อง Dr. บัญชีเบิกใช้) และ JUP (ช่อง Cr. บัญชีปรับปรุง)',
      ],
    };
  });
}
