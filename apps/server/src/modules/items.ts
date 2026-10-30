import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { applyMaskCase, d, fitsMask, ITEM_KINDS, type ItemKindDef } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, conflict, notFound, parse, requireCompany, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings } from '../company-template.js';
import { checkAccount } from './parties.js';
import { mainImageId } from './item-images.js';

type Ctx = AuthContext & { companyId: string };
const uuid = z.string().uuid();
const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const dec = z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === '' || v === null || v === undefined ? null : String(v)));
const optId = uuid.nullable().optional().transform((v) => v ?? null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform((v) => v ?? null);
const nonNeg = (v: string | null, field: string, label: string) => { if (v !== null && (Number.isNaN(Number(v)) || d(v).isNeg())) throw badRequest(`${label}ต้องเป็นตัวเลขไม่ติดลบ`, [{ field, message: 'ไม่ติดลบ' }]); };

/* ------------------------------------------------------------------ กลุ่มบัญชีสินค้า S-SET-04 */
const groupBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัสกลุ่มบัญชี').max(4, 'รหัสกลุ่มบัญชีไม่เกิน 4 ตัว'), name_th: z.string().trim().min(1, 'ป้อนคำอธิบาย').max(120), name_en: str(120),
  cost_method: z.enum(['F', 'A'], { message: 'เลือกวิธีคิดต้นทุน' }),
  inventory_account_id: optId, cogs_account_id: optId, sales_account_id: optId, sales_return_account_id: optId, purchase_account_id: optId, purchase_return_account_id: optId,
});
const GROUP_ACCOUNTS = ['inventory_account_id', 'cogs_account_id', 'sales_account_id', 'sales_return_account_id', 'purchase_account_id', 'purchase_return_account_id'] as const;

export function itemAccountGroupRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/item-account-groups', async (req) => {
    const a = requireCompany(req);
    return db.selectFrom('md_item_account_group as g')
      .select(['g.id', 'g.code', 'g.name_th', 'g.name_en', 'g.cost_method', ...GROUP_ACCOUNTS.map((c) => `g.${c}` as const),
        sql<number>`(SELECT count(*) FROM md_item i WHERE i.account_group_id = g.id AND i.deleted_at IS NULL)`.as('item_count')])
      .where('g.company_id', '=', a.companyId).where('g.deleted_at', 'is', null).where('g.item_specific', '=', false).orderBy('g.code').execute();
  });
  async function save(a: Ctx, id: string | null, b: z.infer<typeof groupBody>) {
    const code = b.code.toUpperCase();
    const dup = await db.selectFrom('md_item_account_group').select('id').where('company_id', '=', a.companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัสกลุ่มบัญชี ${code} มีอยู่แล้ว`);
    for (const c of GROUP_ACCOUNTS) await checkAccount(db, a.companyId, b[c], c);
    if (!b.inventory_account_id || !b.cogs_account_id) throw badRequest('ป้อนบัญชีสินค้าและบัญชีต้นทุนขาย', [{ field: b.inventory_account_id ? 'cogs_account_id' : 'inventory_account_id', message: 'ต้องป้อน' }]);
    const row = { ...b, code };
    if (id) {
      const r = await db.updateTable('md_item_account_group').set({ ...row, updated_by: a.userId }).where('id', '=', id).where('company_id', '=', a.companyId).where('item_specific', '=', false).where('deleted_at', 'is', null).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw notFound('กลุ่มบัญชีสินค้า');
    } else id = (await db.insertInto('md_item_account_group').values({ ...row, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
    await logActivity(db, a, { module: 'IC', action: dup ? 'EDIT' : 'ADD', docNo: code, table: 'md_item_account_group', rowId: id });
    return { id };
  }
  app.post('/api/v1/item-account-groups', async (req) => save(requireCompany(req), null, parse(groupBody, req.body)));
  app.put('/api/v1/item-account-groups/:id', async (req) => save(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(groupBody, req.body)));
  app.delete('/api/v1/item-account-groups/:id', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const g = await db.selectFrom('md_item_account_group').select('code').where('id', '=', id).where('company_id', '=', a.companyId).where('item_specific', '=', false).where('deleted_at', 'is', null).executeTakeFirst();
    if (!g) throw notFound('กลุ่มบัญชีสินค้า');
    const used = await db.selectFrom('md_item').select(sql<number>`count(*)`.as('n')).where('company_id', '=', a.companyId).where('account_group_id', '=', id).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(used.n)) throw badRequest(`กลุ่มบัญชี ${g.code} ใช้อยู่กับสินค้า ${Number(used.n).toLocaleString()} รายการ ลบไม่ได้ — ย้ายสินค้าไปกลุ่มอื่นก่อน`);
    await db.updateTable('md_item_account_group').set({ deleted_at: sql`now()` as never, updated_by: a.userId }).where('id', '=', id).execute();
    await logActivity(db, a, { module: 'IC', action: 'DELETE', docNo: g.code, table: 'md_item_account_group', rowId: id });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ แฟ้มสินค้า (สินค้า ชุด บริการ รายได้อื่น ค่าใช้จ่ายอื่น) */
const itemBody = z.object({
  code: z.string().trim().min(1, 'ป้อนรหัส').max(30), barcode: str(30), name_th: z.string().trim().min(1, 'ป้อนชื่อไทย').max(120), name_en: str(120),
  item_type: z.enum(['0', '1', '2', '3', '4', '5']).optional(), status: z.enum(['A', 'I']).default('A'),
  category_code: str(10), item_level: str(4), remark: str(2000), packing: str(30),
  account_group_id: optId, base_unit_id: optId, count_unit_id: optId, count_factor: dec, purchase_unit_id: optId, purchase_factor: dec, sales_unit_id: optId, sales_factor: dec,
  std_cost: dec, price_1: dec, price_2: dec, price_3: dec, price_4: dec, price_5: dec,
  vat_code: z.enum(['', '0', '1', '2']).nullable().optional().transform((v) => v || null), allow_negative: z.enum(['', 'Y', 'N', 'A']).nullable().optional().transform((v) => v || null),
  default_supplier_id: optId, substitute_item_id: optId,
  udf_1: str(4), udf_2: str(4), udf_3: str(15), udf_4: str(30), udf_date_1: isoDate, udf_date_2: isoDate, udf_num_1: dec,
  /** บัญชีของ บริการ/รายได้อื่น/ค่าใช้จ่ายอื่น (เก็บในกลุ่มบัญชีเฉพาะสินค้า) */
  accounts: z.object({ revenue: optId, revenue_return: optId, expense: optId, cost_dr: optId, cost_cr: optId }).partial().optional(),
  bom: z.array(z.object({ component_item_id: uuid, qty: z.union([z.number(), z.string()]).transform(String), std_cost: dec, sell_price: dec, warehouse_id: optId })).max(999).optional(),
});
type ItemBody = z.infer<typeof itemBody>;
const PRICE_COLS = ['price_1', 'price_2', 'price_3', 'price_4', 'price_5'] as const;

async function unitOk(db: Db, companyId: string, id: string | null, field: string) {
  if (id && !(await db.selectFrom('md_unit').select('id').where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบหน่วยนับนี้', [{ field, message: 'ไม่พบหน่วยนับ' }]);
}
async function warehouseOk(db: Db, companyId: string, id: string | null) {
  if (id && !(await db.selectFrom('md_warehouse').select('id').where('id', '=', id).where('company_id', '=', companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบคลังสินค้านี้');
}
/** รหัสกลุ่มบัญชีเฉพาะสินค้าที่ยังไม่ซ้ำ (Express ใช้รหัสอัตโนมัติแบบ 000>) */
async function newSpecificCode(db: Db, companyId: string) {
  for (let i = 0; i < 20; i++) {
    const code = '#' + Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!(await db.selectFrom('md_item_account_group').select('id').where('company_id', '=', companyId).where('code', '=', code).executeTakeFirst())) return code;
  }
  throw new Error('สร้างรหัสกลุ่มบัญชีไม่ได้');
}

export function itemRoutes(app: FastifyInstance, db: Db) {
  for (const K of Object.values(ITEM_KINDS)) kindRoutes(app, db, K);

  /** ค้นหารหัสสำหรับป้อนในเอกสาร: ขาย = สินค้า ชุด บริการ รายได้อื่น · ซื้อ = สินค้า ชุด บริการ ค่าใช้จ่ายอื่น */
  app.get('/api/v1/item-search', async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), module: z.enum(['AR', 'AP']), types: z.string().regex(/^[0-5](,[0-5])*$/).optional(), limit: z.coerce.number().int().min(1).max(50).default(15) }), req.query);
    // types: จำกัดชนิดรหัส เช่น 4 = รหัสรายได้อื่น (OI) · 5,2 = รหัสค่าใช้จ่าย (OE; '2' ตามข้อมูลที่ย้ายจาก Express)
    const types = (q.module === 'AR' ? ['0', '1', '2', '3', '4'] : ['0', '1', '2', '3', '5']).filter((t) => !q.types || q.types.split(',').includes(t));
    let s = db.selectFrom('md_item as i').leftJoin('md_unit as bu', 'bu.id', 'i.base_unit_id').leftJoin('md_unit as su', 'su.id', 'i.sales_unit_id').leftJoin('md_unit as pu', 'pu.id', 'i.purchase_unit_id')
      .select(['i.id', 'i.code', 'i.name_th', 'i.item_type', 'i.vat_code', 'i.base_unit_id', 'bu.code as base_unit_code', 'i.sales_unit_id', 'su.code as sales_unit_code', 'i.sales_factor', 'i.purchase_unit_id', 'pu.code as purchase_unit_code', 'i.purchase_factor',
        'i.price_1', 'i.price_2', 'i.price_3', 'i.price_4', 'i.price_5', 'i.std_cost', mainImageId.as('image_id')])
      .where('i.company_id', '=', a.companyId).where('i.deleted_at', 'is', null).where('i.status', '=', 'A').where('i.item_type', 'in', types);
    if (q.q?.trim()) { const like = `%${q.q.trim()}%`; s = s.where((eb) => eb.or([eb('i.code', 'ilike', like), eb('i.name_th', 'ilike', like), eb('i.barcode', '=', q.q!.trim())])); }
    return { rows: await s.orderBy('i.code').limit(q.limit).execute() };
  });

  /* ---- ตารางราคาขาย S-IC-06 */
  const priceBody = z.object({
    sales_unit_id: optId, sales_factor: dec, price_1: dec, price_2: dec, price_3: dec, price_4: dec, price_5: dec,
    breaks: z.array(z.object({ unit_id: optId, factor: dec, min_qty: z.union([z.number(), z.string()]).transform(String), is_percent: z.boolean().default(false),
      price_1: dec, price_2: dec, price_3: dec, price_4: dec, price_5: dec, start_date: isoDate, end_date: isoDate })).max(200).default([]),
  });
  const priceItem = async (a: Ctx, id: string) => {
    const it = await db.selectFrom('md_item as i').leftJoin('md_unit as u', 'u.id', 'i.base_unit_id')
      .select(['i.id', 'i.code', 'i.name_th', 'i.name_en', 'i.item_type', 'i.sales_unit_id', 'i.sales_factor', 'i.price_1', 'i.price_2', 'i.price_3', 'i.price_4', 'i.price_5', 'u.code as base_unit_code', 'u.name_th as base_unit_name'])
      .where('i.id', '=', id).where('i.company_id', '=', a.companyId).where('i.deleted_at', 'is', null).executeTakeFirst();
    if (!it || !['0', '1', '2', '3'].includes(it.item_type)) throw notFound('สินค้า');
    return it;
  };
  app.get('/api/v1/items/:id/prices', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const it = await priceItem(a, id);
    const breaks = await db.selectFrom('md_item_price_break').select(['unit_id', 'factor', 'min_qty', 'is_percent', ...PRICE_COLS, 'start_date', 'end_date'])
      .where('company_id', '=', a.companyId).where('item_id', '=', id).where('deleted_at', 'is', null).orderBy('start_date').orderBy('min_qty').execute();
    return { ...it, breaks };
  });
  app.put('/api/v1/items/:id/prices', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(priceBody, req.body);
    const it = await priceItem(a, id);
    await unitOk(db, a.companyId, b.sales_unit_id, 'sales_unit_id');
    for (const c of PRICE_COLS) nonNeg(b[c], c, 'ราคาขาย');
    b.breaks.forEach((x, i) => {
      if (!(Number(x.min_qty) > 0)) throw badRequest(`ราคาเสริมบรรทัดที่ ${i + 1}: ป้อนปริมาณขั้นต่ำมากกว่า 0`);
      if (x.start_date && x.end_date && x.end_date < x.start_date) throw badRequest(`ราคาเสริมบรรทัดที่ ${i + 1}: วันสิ้นสุดก่อนวันเริ่ม`);
      if (x.is_percent && PRICE_COLS.some((c) => x[c] !== null && Number(x[c]) > 100)) throw badRequest(`ราคาเสริมบรรทัดที่ ${i + 1}: ส่วนลดเป็น % ต้องไม่เกิน 100`);
    });
    for (const x of b.breaks) await unitOk(db, a.companyId, x.unit_id, 'unit_id');
    if (b.sales_factor !== null && !(Number(b.sales_factor) > 0)) throw badRequest('ตัวคูณต้องมากกว่า 0');
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('md_item').set({ sales_unit_id: b.sales_unit_id, sales_factor: b.sales_factor ?? '1', price_1: b.price_1, price_2: b.price_2, price_3: b.price_3, price_4: b.price_4, price_5: b.price_5, updated_by: a.userId }).where('id', '=', id).execute();
      await tx.updateTable('md_item_price_break').set({ deleted_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('item_id', '=', id).where('deleted_at', 'is', null).execute();
      if (b.breaks.length) await tx.insertInto('md_item_price_break').values(b.breaks.map((x) => ({ ...x, factor: x.factor ?? '1', company_id: a.companyId, item_id: id, created_by: a.userId }))).execute();
      await logActivity(tx, a, { module: 'IC', action: 'EDIT_PRICE', docNo: it.code, table: 'md_item', rowId: id });
    });
    return { ok: true };
  });

  /* ---- จุดสั่งซื้อ S-IC-07 */
  const reorderBody = z.object({ rows: z.array(z.object({ warehouse_id: uuid, start_mmdd: z.string().regex(/^(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/, 'เดือน/วัน เป็น MMDD เช่น 0101 หรือ 1201'),
    min_qty: dec, max_qty: dec, order_qty: dec, projected_sales: dec })).max(500) });
  app.get('/api/v1/items/:id/reorder', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const it = await db.selectFrom('md_item as i').leftJoin('md_unit as u', 'u.id', 'i.base_unit_id').select(['i.id', 'i.code', 'i.name_th', 'i.item_type', 'u.code as base_unit_code'])
      .where('i.id', '=', id).where('i.company_id', '=', a.companyId).where('i.deleted_at', 'is', null).executeTakeFirst();
    if (!it || it.item_type !== '0') throw notFound('สินค้า');
    const rows = await db.selectFrom('md_item_reorder as r').innerJoin('md_warehouse as w', 'w.id', 'r.warehouse_id')
      .select(['r.warehouse_id', 'w.code as warehouse_code', 'r.start_mmdd', 'r.min_qty', 'r.max_qty', 'r.order_qty', 'r.projected_sales'])
      .where('r.company_id', '=', a.companyId).where('r.item_id', '=', id).where('r.deleted_at', 'is', null).orderBy('w.code').orderBy('r.start_mmdd').execute();
    const stock = await db.selectFrom('inv_stock_balance as b').innerJoin('md_warehouse as w', 'w.id', 'b.warehouse_id')
      .select(['b.warehouse_id', 'w.code as warehouse_code', 'w.name_th as warehouse_name', 'b.qty_on_hand', 'b.shelf'])
      .where('b.company_id', '=', a.companyId).where('b.item_id', '=', id).where('b.deleted_at', 'is', null).orderBy('w.code').execute();
    return { ...it, rows, stock };
  });
  app.put('/api/v1/items/:id/reorder', async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(reorderBody, req.body);
    const it = await db.selectFrom('md_item').select(['code', 'item_type']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
    if (!it || it.item_type !== '0') throw notFound('สินค้า');
    const seen = new Set<string>();
    for (const r of b.rows) {
      const k = `${r.warehouse_id}|${r.start_mmdd}`;
      if (seen.has(k)) throw badRequest(`คลังเดียวกันมีวันที่เริ่ม ${r.start_mmdd.slice(0, 2)}/${r.start_mmdd.slice(2)} ซ้ำ`);
      seen.add(k);
      await warehouseOk(db, a.companyId, r.warehouse_id);
      for (const c of ['min_qty', 'max_qty', 'order_qty', 'projected_sales'] as const) nonNeg(r[c], c, 'จำนวน');
      if (r.min_qty === null) throw badRequest('ป้อนจุดสั่งซื้อ');
      if (r.max_qty !== null && d(r.max_qty).lt(d(r.min_qty))) throw badRequest('จำนวนสูงสุดต้องไม่น้อยกว่าจุดสั่งซื้อ');
    }
    await db.transaction().execute(async (tx) => {
      await tx.updateTable('md_item_reorder').set({ deleted_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('item_id', '=', id).where('deleted_at', 'is', null).execute();
      if (b.rows.length) await tx.insertInto('md_item_reorder').values(b.rows.map((r) => ({ ...r, company_id: a.companyId, item_id: id, created_by: a.userId }))).execute();
      await logActivity(tx, a, { module: 'IC', action: 'EDIT_REORDER', docNo: it.code, table: 'md_item', rowId: id });
    });
    return { ok: true };
  });
}

function kindRoutes(app: FastifyInstance, db: Db, K: ItemKindDef) {
  const base = `/api/v1/${K.path}`;
  const nonStock = K.kind === 'service' || K.kind === 'income' || K.kind === 'expense';

  app.get(base, async (req) => {
    const a = requireCompany(req);
    const q = parse(z.object({ q: z.string().optional(), status: z.enum(['A', 'I', 'all']).default('A'), category: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0) }), req.query);
    let s = db.selectFrom('md_item as i').leftJoin('md_unit as u', 'u.id', 'i.base_unit_id').leftJoin('md_item_account_group as g', 'g.id', 'i.account_group_id')
      .select(['i.id', 'i.code', 'i.item_type', 'i.name_th', 'i.name_en', 'i.barcode', 'i.category_code', 'i.std_cost', 'i.price_1', 'i.status', 'u.code as unit_code', 'u.name_th as unit_name',
        sql<string | null>`CASE WHEN g.item_specific THEN NULL ELSE g.code END`.as('group_code'), mainImageId.as('image_id'),
        sql<string>`(SELECT coalesce(sum(b.qty_on_hand), 0) FROM inv_stock_balance b WHERE b.item_id = i.id AND b.deleted_at IS NULL)`.as('qty'),
        sql<string>`(SELECT coalesce(sum(b.value_on_hand), 0) FROM inv_stock_balance b WHERE b.item_id = i.id AND b.deleted_at IS NULL)`.as('value')])
      .where('i.company_id', '=', a.companyId).where('i.deleted_at', 'is', null).where('i.item_type', 'in', K.types);
    if (q.status !== 'all') s = s.where('i.status', '=', q.status);
    if (q.category) s = s.where('i.category_code', '=', q.category);
    if (q.q?.trim()) { const like = `%${q.q.trim()}%`; s = s.where((eb) => eb.or([eb('i.code', 'ilike', like), eb('i.name_th', 'ilike', like), eb('i.name_en', 'ilike', like), eb('i.barcode', '=', q.q!.trim())])); }
    const total = await s.clearSelect().select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
    return { total: Number(total.n), rows: await s.orderBy('i.code').limit(q.limit).offset(q.offset).execute() };
  });

  app.get(`${base}/:id`, async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const it = await db.selectFrom('md_item').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('item_type', 'in', K.types).executeTakeFirst();
    if (!it) throw notFound(K.label);
    const g = it.account_group_id ? await db.selectFrom('md_item_account_group').selectAll().where('id', '=', it.account_group_id).executeTakeFirst() : undefined;
    const accounts = g?.item_specific ? { revenue: g.sales_account_id, revenue_return: g.sales_return_account_id, expense: g.inventory_account_id, cost_dr: g.cogs_account_id, cost_cr: g.inventory_account_id } : {};
    if (K.kind === 'expense') Object.assign(accounts, { cost_cr: null });
    else if (g?.item_specific) Object.assign(accounts, { expense: null });
    const warehouses = await db.selectFrom('inv_stock_balance as b').innerJoin('md_warehouse as w', 'w.id', 'b.warehouse_id')
      .select(['b.warehouse_id', 'w.code as warehouse_code', 'w.name_th as warehouse_name', 'b.qty_on_hand', 'b.value_on_hand', 'b.avg_cost', 'b.qty_on_order', 'b.qty_reserved', 'b.last_purchase_date', 'b.last_sale_date', 'b.shelf'])
      .where('b.company_id', '=', a.companyId).where('b.item_id', '=', id).where('b.deleted_at', 'is', null).orderBy('w.code').execute();
    const bom = await db.selectFrom('md_item_bom as b').innerJoin('md_item as c', 'c.id', 'b.component_item_id').leftJoin('md_unit as u', 'u.id', 'c.base_unit_id')
      .select(['b.line_no', 'b.component_item_id', 'c.code as component_code', 'c.name_th as component_name', 'u.code as unit_code', 'b.qty', 'b.std_cost', 'b.sell_price', 'b.warehouse_id', 'c.std_cost as component_std_cost', 'c.price_1 as component_price_1'])
      .where('b.company_id', '=', a.companyId).where('b.parent_item_id', '=', id).where('b.deleted_at', 'is', null).orderBy('b.line_no').execute();
    const usedIn = await db.selectFrom('md_item_bom as b').innerJoin('md_item as p', 'p.id', 'b.parent_item_id').select(['p.id', 'p.code', 'p.name_th'])
      .where('b.company_id', '=', a.companyId).where('b.component_item_id', '=', id).where('b.deleted_at', 'is', null).where('p.deleted_at', 'is', null).orderBy('p.code').execute();
    const qty = warehouses.reduce((s, w) => s.plus(d(w.qty_on_hand)), d(0)), value = warehouses.reduce((s, w) => s.plus(d(w.value_on_hand)), d(0));
    const sup = it.default_supplier_id ? await db.selectFrom('md_supplier').select(['id', 'code', 'name']).where('id', '=', it.default_supplier_id).executeTakeFirst() : undefined;
    const sub = it.substitute_item_id ? await db.selectFrom('md_item').select(['id', 'code', 'name_th as name']).where('id', '=', it.substitute_item_id).executeTakeFirst() : undefined;
    return {
      ...it, default_supplier: sup ?? null, substitute_item: sub ?? null, account_group: g && !g.item_specific ? { id: g.id, code: g.code, name_th: g.name_th, cost_method: g.cost_method } : null, accounts, warehouses, bom, used_in_kits: usedIn,
      totals: { qty: qty.toString(), value: value.toFixed(2), unit_cost: qty.isZero() ? '0' : value.div(qty).toDecimalPlaces(4).toString() },
      last_purchase_date: warehouses.map((w) => w.last_purchase_date).filter(Boolean).sort().at(-1) ?? null,
      last_sale_date: warehouses.map((w) => w.last_sale_date).filter(Boolean).sort().at(-1) ?? null,
    };
  });

  async function saveItem(a: Ctx, id: string | null, b: ItemBody) {
    const type = K.kind === 'kit' ? (b.item_type === '2' ? '2' : '1') : K.types[0]!;
    const before = id ? await db.selectFrom('md_item').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('item_type', 'in', K.types).executeTakeFirst() : undefined;
    if (id && !before) throw notFound(K.label);
    // รหัสตามรูปแบบ (ตรวจเมื่อเพิ่มใหม่หรือเปลี่ยนรหัส — รหัสเดิมจาก Express คงไว้ได้)
    const mask = (await companySettings(db, a.companyId))['ic.item_code_mask'] as string | undefined;
    const code = applyMaskCase(mask, b.code);
    if (!before || before.code !== code) {
      const f = fitsMask(mask, code);
      if (!f.ok) throw badRequest(f.error!, [{ field: 'code', message: f.error! }]);
    }
    const dup = await db.selectFrom('md_item').select(['id', 'item_type']).where('company_id', '=', a.companyId).where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst();
    if (dup && dup.id !== id) throw conflict(`รหัส ${code} มีอยู่แล้วในแฟ้มสินค้า (${ITEM_KINDS[Object.values(ITEM_KINDS).find((k) => k.types.includes(dup.item_type))?.kind ?? 'stock'].label})`);
    if (b.barcode) {
      const bc = await db.selectFrom('md_item').select(['id', 'code']).where('company_id', '=', a.companyId).where('barcode', '=', b.barcode).where('deleted_at', 'is', null).executeTakeFirst();
      if (bc && bc.id !== id) throw conflict(`บาร์โค้ด ${b.barcode} ใช้กับสินค้า ${bc.code} แล้ว`);
    }
    for (const [u, f] of [[b.base_unit_id, 'base_unit_id'], [b.count_unit_id, 'count_unit_id'], [b.purchase_unit_id, 'purchase_unit_id'], [b.sales_unit_id, 'sales_unit_id']] as const) await unitOk(db, a.companyId, u, f);
    if ((K.kind === 'stock' || K.kind === 'kit') && !b.base_unit_id) throw badRequest('เลือกหน่วยนับ (หน่วยย่อย)', [{ field: 'base_unit_id', message: 'ต้องเลือก' }]);
    for (const [v, f] of [[b.count_factor, 'count_factor'], [b.purchase_factor, 'purchase_factor'], [b.sales_factor, 'sales_factor']] as const)
      if (v !== null && !(Number(v) > 0)) throw badRequest('ตัวคูณให้เป็นหน่วยย่อยต้องมากกว่า 0', [{ field: f, message: 'มากกว่า 0' }]);
    for (const c of [...PRICE_COLS, 'std_cost'] as const) nonNeg(b[c], c, c === 'std_cost' ? 'ราคาทุน' : 'ราคาขาย');
    // กลุ่มเดิมคงไว้ได้เสมอ (สินค้าบางตัวจาก Express ใช้กลุ่มเฉพาะของตัวเอง)
    if (b.account_group_id && b.account_group_id !== before?.account_group_id) {
      const g = await db.selectFrom('md_item_account_group').select(['id', 'item_specific']).where('id', '=', b.account_group_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!g || g.item_specific) throw badRequest('ไม่พบกลุ่มบัญชีสินค้านี้', [{ field: 'account_group_id', message: 'ไม่พบ' }]);
    }
    if (b.default_supplier_id && !(await db.selectFrom('md_supplier').select('id').where('id', '=', b.default_supplier_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบผู้จำหน่ายนี้');
    if (b.substitute_item_id) {
      if (b.substitute_item_id === id) throw badRequest('สินค้าทดแทนเป็นตัวเองไม่ได้');
      if (!(await db.selectFrom('md_item').select('id').where('id', '=', b.substitute_item_id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst())) throw badRequest('ไม่พบสินค้าทดแทนนี้');
    }
    // สินค้าชุด: ส่วนประกอบต้องมีในแฟ้มสินค้าแล้ว ไม่ใช่ตัวเอง และชุดซ้อนชุดห้ามวนกลับ
    const bom = K.kind === 'kit' ? (b.bom ?? []) : [];
    if (K.kind === 'kit') {
      if (!bom.length) throw badRequest('ป้อนสินค้าประกอบอย่างน้อย 1 รายการ');
      const ids = [...new Set(bom.map((x) => x.component_item_id))];
      if (id && ids.includes(id)) throw badRequest('สินค้าประกอบเป็นตัวสินค้าชุดเองไม่ได้');
      const comps = await db.selectFrom('md_item').select(['id', 'code', 'item_type', 'item_level']).where('company_id', '=', a.companyId).where('id', 'in', ids).where('deleted_at', 'is', null).execute();
      if (comps.length !== ids.length) throw badRequest('ไม่พบสินค้าประกอบบางรายการในแฟ้มสินค้า (เมนูสินค้า › รายละเอียดสินค้า)');
      const bad = comps.find((c) => ['4', '5'].includes(c.item_type));
      if (bad) throw badRequest(`${bad.code} เป็นรหัสรายได้/ค่าใช้จ่าย ใช้เป็นสินค้าประกอบไม่ได้`);
      if (id) {
        const loop = await sql<{ id: string }>`WITH RECURSIVE t(id) AS (
            SELECT unnest(${ids}::uuid[]) UNION SELECT b.component_item_id FROM md_item_bom b JOIN t ON b.parent_item_id = t.id WHERE b.deleted_at IS NULL)
          SELECT id FROM t WHERE id = ${id} LIMIT 1`.execute(db);
        if (loop.rows.length) throw badRequest('สินค้าประกอบมีสินค้าชุดนี้อยู่ข้างใน (ชุดซ้อนชุดวนกลับ)');
      }
      const level = b.item_level;
      const sameLevel = comps.find((c) => c.item_type !== '0' && c.item_level && level && c.item_level === level && ['1', '2'].includes(c.item_type));
      if (sameLevel) throw badRequest(`ชุดซ้อนชุดต้องใช้ระดับสินค้าต่างกัน (${sameLevel.code} ระดับ ${level} เหมือนชุดนี้)`, [{ field: 'item_level', message: 'ต้องต่างจากชุดย่อย' }]);
      bom.forEach((x, i) => { if (!(Number(x.qty) > 0)) throw badRequest(`สินค้าประกอบบรรทัดที่ ${i + 1}: จำนวนต้องมากกว่า 0`); nonNeg(x.std_cost, 'std_cost', 'ราคาทุน'); nonNeg(x.sell_price, 'sell_price', 'ราคาขาย'); });
      for (const x of bom) await warehouseOk(db, a.companyId, x.warehouse_id);
    }
    // บัญชีของรหัสที่ไม่ใช่สินค้าคงคลัง (คู่มือ S-IC-05, S-SO-02, S-AP-02)
    const acc = b.accounts ?? {};
    if (nonStock) {
      for (const [k, v] of Object.entries(acc)) await checkAccount(db, a.companyId, v, `accounts.${k}`);
      if (K.kind === 'expense' && !acc.expense) throw badRequest('เลือกบัญชีค่าใช้จ่าย', [{ field: 'accounts.expense', message: 'ต้องเลือก' }]);
      if (K.kind !== 'expense' && !acc.revenue) throw badRequest('เลือกบัญชีรายได้', [{ field: 'accounts.revenue', message: 'ต้องเลือก' }]);
      if (b.std_cost && d(b.std_cost).gt(0) && (!acc.cost_dr || !acc.cost_cr)) throw badRequest('มีต้นทุนบริการต่อหน่วย ต้องเลือกบัญชีต้นทุนบริการ (Dr) และบัญชีเงินเดือน/ค่าแรง (Cr) ให้ครบ — หรือใส่ต้นทุนเป็น 0 เพื่อไม่บันทึกต้นทุน', [{ field: !acc.cost_dr ? 'accounts.cost_dr' : 'accounts.cost_cr', message: 'ต้องเลือก' }]);
    }

    const { accounts: _acc, bom: _bom, item_type: _t, code: _c, ...rest } = b;
    const row = {
      ...rest, code, item_type: type,
      account_group_id: nonStock ? (before?.account_group_id ?? null) : b.account_group_id,
      purchase_factor: b.purchase_factor ?? '1', sales_factor: b.sales_factor ?? '1',
      inactive_date: b.status === 'I' ? (before?.inactive_date ?? sql`CURRENT_DATE` as never) : null,
    };
    return db.transaction().execute(async (tx) => {
      let iid = id;
      if (id) await tx.updateTable('md_item').set({ ...row, updated_by: a.userId }).where('id', '=', id).execute();
      else iid = (await tx.insertInto('md_item').values({ ...row, company_id: a.companyId, created_by: a.userId }).returning('id').executeTakeFirstOrThrow()).id;
      if (nonStock) {
        const slots = K.kind === 'expense'
          ? { inventory_account_id: acc.expense ?? null, cogs_account_id: null, sales_account_id: null, sales_return_account_id: null }
          : { sales_account_id: acc.revenue ?? null, sales_return_account_id: acc.revenue_return ?? null, cogs_account_id: acc.cost_dr ?? null, inventory_account_id: acc.cost_cr ?? null };
        const cur = row.account_group_id ? await tx.selectFrom('md_item_account_group').select(['id', 'item_specific']).where('id', '=', row.account_group_id).executeTakeFirst() : undefined;
        if (cur?.item_specific) await tx.updateTable('md_item_account_group').set({ ...slots, name_th: b.name_th, name_en: b.name_en, updated_by: a.userId }).where('id', '=', cur.id).execute();
        else {
          const g = await tx.insertInto('md_item_account_group').values({ ...slots, company_id: a.companyId, code: await newSpecificCode(tx, a.companyId), name_th: b.name_th, name_en: b.name_en, item_specific: true, created_by: a.userId }).returning('id').executeTakeFirstOrThrow();
          await tx.updateTable('md_item').set({ account_group_id: g.id }).where('id', '=', iid!).execute();
        }
      }
      if (K.kind === 'kit') {
        await tx.updateTable('md_item_bom').set({ deleted_at: sql`now()` as never }).where('company_id', '=', a.companyId).where('parent_item_id', '=', iid!).where('deleted_at', 'is', null).execute();
        await tx.insertInto('md_item_bom').values(bom.map((x, i) => ({ ...x, line_no: i + 1, company_id: a.companyId, parent_item_id: iid!, created_by: a.userId }))).execute();
      }
      await logActivity(tx, a, { module: 'IC', action: id ? 'EDIT' : 'ADD', docNo: code, table: 'md_item', rowId: iid, detail: before ? { before } : undefined });
      return { id: iid };
    });
  }
  app.post(base, async (req) => saveItem(requireCompany(req), null, parse(itemBody, req.body)));
  app.put(`${base}/:id`, async (req) => saveItem(requireCompany(req), parse(z.object({ id: uuid }), req.params).id, parse(itemBody, req.body)));

  app.delete(`${base}/:id`, async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const it = await db.selectFrom('md_item').select(['code', 'account_group_id']).where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('item_type', 'in', K.types).executeTakeFirst();
    if (!it) throw notFound(K.label);
    const used = await sql<{ docs: number; kits: number; stock: number }>`SELECT
      (SELECT count(*) FROM doc_line WHERE item_id = ${id} AND deleted_at IS NULL) AS docs,
      (SELECT count(*) FROM md_item_bom b JOIN md_item p ON p.id = b.parent_item_id WHERE b.component_item_id = ${id} AND b.deleted_at IS NULL AND p.deleted_at IS NULL) AS kits,
      (SELECT count(*) FROM inv_stock_balance WHERE item_id = ${id} AND deleted_at IS NULL AND (qty_on_hand <> 0 OR value_on_hand <> 0)) + (SELECT count(*) FROM inv_stock_ledger WHERE item_id = ${id} AND deleted_at IS NULL) AS stock`.execute(db);
    const u = used.rows[0]!;
    if (Number(u.docs)) throw badRequest(`${it.code} มีในเอกสารแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    if (Number(u.kits)) throw badRequest(`${it.code} เป็นสินค้าประกอบของสินค้าชุดอยู่ ลบไม่ได้ — นำออกจากสินค้าชุดก่อน`);
    if (Number(u.stock)) throw badRequest(`${it.code} มียอดคงเหลือ/ความเคลื่อนไหวในคลังแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.transaction().execute(async (tx) => {
      const now = sql`now()` as never;
      await tx.updateTable('md_item').set({ deleted_at: now, updated_by: a.userId }).where('id', '=', id).execute();
      for (const t of ['md_item_price_break', 'md_item_reorder', 'inv_stock_balance'] as const) await tx.updateTable(t).set({ deleted_at: now }).where('company_id', '=', a.companyId).where('item_id', '=', id).where('deleted_at', 'is', null).execute();
      await tx.updateTable('md_item_bom').set({ deleted_at: now }).where('company_id', '=', a.companyId).where('parent_item_id', '=', id).where('deleted_at', 'is', null).execute();
      if (it.account_group_id) await tx.updateTable('md_item_account_group').set({ deleted_at: now }).where('id', '=', it.account_group_id).where('item_specific', '=', true).execute();
      await logActivity(tx, a, { module: 'IC', action: 'DELETE', docNo: it.code, table: 'md_item', rowId: id });
    });
    return { ok: true };
  });

  /* คัดลอกสินค้าชุด (S-IC-04 COPY SET): รายละเอียดทุกอย่างเหมือนเดิม ยกเว้นรหัส */
  if (K.kind === 'kit') app.post(`${base}/:id/copy`, async (req) => {
    const a = requireCompany(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const { code } = parse(z.object({ code: z.string().trim().min(1, 'ป้อนรหัสใหม่').max(30) }), req.body);
    const src = await db.selectFrom('md_item').selectAll().where('id', '=', id).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).where('item_type', 'in', K.types).executeTakeFirst();
    if (!src) throw notFound(K.label);
    const bom = await db.selectFrom('md_item_bom').select(['component_item_id', 'qty', 'std_cost', 'sell_price', 'warehouse_id']).where('parent_item_id', '=', id).where('deleted_at', 'is', null).orderBy('line_no').execute();
    const body = parse(itemBody, { ...Object.fromEntries(Object.entries(src).map(([k, v]) => [k, (v as unknown) instanceof Date ? (v as unknown as Date).toISOString().slice(0, 10) : v])), code, barcode: null, bom });
    return saveItem(a, null, body);
  });
}
