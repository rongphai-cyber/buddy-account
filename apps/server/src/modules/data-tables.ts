import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { d, DATA_TABLES } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, notFound, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';

type Def = (typeof DATA_TABLES)[number];
const defOf = (code: string) => { const t = DATA_TABLES.find((x) => x.code === code); if (!t) throw notFound('ตารางข้อมูล'); return t; };
interface Row { id: string; code: string; short_th: string | null; short_en: string | null; name_th: string; name_en: string | null; rate: string | null; status: string }

/** แถวของตาราง (หน่วยนับ/คลัง/ธนาคาร อยู่ในตารางของตัวเอง ที่เหลืออยู่ใน md_lookup) */
async function rowsOf(db: Db, companyId: string, t: Def): Promise<Row[]> {
  if (t.table === 'md_lookup') {
    return db.selectFrom('md_lookup').select(['id', 'code', 'short_th', 'short_en', 'name_th', 'name_en', 'rate', 'status'])
      .where('company_id', '=', companyId).where('type_code', '=', t.code).where('deleted_at', 'is', null).orderBy('code').execute();
  }
  const q = sql<Row>`SELECT id, code, short_th, short_en, name_th, name_en, ${t.table === 'md_unit' ? sql`rate` : sql`NULL::numeric AS rate`}, ${t.table === 'md_warehouse' ? sql`status` : sql`status`}
    FROM ${sql.table(t.table)} WHERE company_id = ${companyId} AND deleted_at IS NULL ORDER BY code`;
  return (await q.execute(db)).rows;
}

/** จำนวนการอ้างอิงของแต่ละแถว — ตารางของตัวเองหาจาก foreign key ทุกตัวที่ชี้มา, md_lookup หาจากช่องรหัสที่กำหนดใน DATA_TABLES.refs */
async function usage(db: Db, companyId: string, t: Def, rows: Row[]): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  const add = (k: string, n: number) => used.set(k, (used.get(k) ?? 0) + n);
  if (t.table !== 'md_lookup' && rows.length) {
    const fks = (await sql<{ tbl: string; col: string; soft: boolean }>`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col,
      EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'deleted_at' AND NOT x.attisdropped) AS soft FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) WHERE c.contype = 'f' AND c.confrelid = ${t.table}::regclass`.execute(db)).rows;
    const ids = rows.map((r) => r.id);
    for (const fk of fks) {
      if (!/^[a-z_]+$/.test(fk.tbl) || !/^[a-z_]+$/.test(fk.col)) continue;
      const r = await sql<{ k: string; n: number }>`SELECT ${sql.ref(fk.col)}::text AS k, count(*) AS n FROM ${sql.table(fk.tbl)} WHERE ${sql.ref(fk.col)} = ANY(${ids}::uuid[]) ${fk.soft ? sql`AND deleted_at IS NULL` : sql``} GROUP BY 1`.execute(db);
      for (const x of r.rows) add(x.k, Number(x.n));
    }
  }
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  for (const [tbl, col] of t.refs ?? []) {
    const r = await sql<{ k: string; n: number }>`SELECT ${sql.ref(col)} AS k, count(*) AS n FROM ${sql.table(tbl)} WHERE company_id = ${companyId} AND deleted_at IS NULL AND ${sql.ref(col)} IS NOT NULL GROUP BY 1`.execute(db);
    for (const x of r.rows) { const id = byCode.get(x.k); if (id) add(id, Number(x.n)); }
  }
  return used;
}

const rowBody = z.object({
  id: z.string().uuid().optional(), code: z.string().trim().min(1, 'ป้อนรหัส').max(10, 'รหัสไม่เกิน 10 ตัว'),
  short_th: z.string().trim().max(30).nullable().optional().transform((v) => v || null), short_en: z.string().trim().max(30).nullable().optional().transform((v) => v || null),
  name_th: z.string().trim().min(1, 'ป้อนชื่อเต็มไทย').max(120), name_en: z.string().trim().max(120).nullable().optional().transform((v) => v || null),
  rate: z.union([z.number(), z.string()]).nullable().optional().transform((v) => (v === '' || v === null || v === undefined ? null : String(v))),
  status: z.enum(['A', 'I']).default('A'),
});

/** ตารางข้อมูล S-TBL-00 / S-TBL-01 — ตารางแก้ไขในหน้าเดียว ใช้รูปแบบเดียวกันทุกตาราง */
export function dataTableRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/data-tables', async (req) => {
    const a = requireCompany(req);
    const counts = new Map((await db.selectFrom('md_lookup').select(['type_code', sql<number>`count(*)`.as('n')]).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).groupBy('type_code').execute()).map((r) => [r.type_code, Number(r.n)]));
    const own = async (t: 'md_bank' | 'md_unit' | 'md_warehouse') => Number((await sql<{ n: number }>`SELECT count(*) AS n FROM ${sql.table(t)} WHERE company_id = ${a.companyId} AND deleted_at IS NULL`.execute(db)).rows[0]?.n ?? 0);
    const out = [];
    for (const t of DATA_TABLES) out.push({ code: t.code, label: t.label, rate: !!t.rate, hint: t.hint ?? null, count: t.table === 'md_lookup' ? counts.get(t.code) ?? 0 : await own(t.table) });
    return out;
  });

  app.get('/api/v1/data-tables/:code', async (req) => {
    const a = requireCompany(req);
    const t = defOf(parse(z.object({ code: z.string() }), req.params).code);
    const rows = await rowsOf(db, a.companyId, t);
    const used = await usage(db, a.companyId, t, rows);
    return rows.map((r) => ({ ...r, used: used.get(r.id) ?? 0 }));
  });

  app.put('/api/v1/data-tables/:code', async (req) => {
    const a = requireCompany(req);
    const t = defOf(parse(z.object({ code: z.string() }), req.params).code);
    const { rows } = parse(z.object({ rows: z.array(rowBody).max(2000) }), req.body);
    const cur = await rowsOf(db, a.companyId, t);
    const used = await usage(db, a.companyId, t, cur);
    const byId = new Map(cur.map((r) => [r.id, r]));
    const seen = new Set<string>();
    for (const [i, r] of rows.entries()) {
      if (seen.has(r.code)) throw badRequest(`รหัส ${r.code} ซ้ำ (บรรทัดที่ ${i + 1})`);
      seen.add(r.code);
      if (r.id && !byId.has(r.id)) throw notFound('รายการในตารางข้อมูล');
      const old = r.id ? byId.get(r.id)! : null;
      // คู่มือหน้า 90: รหัสที่ถูกนำไปอ้างอิงในการเดินรายการแล้ว ห้ามแก้รหัส/ห้ามลบ
      if (old && old.code !== r.code && used.get(old.id)) throw badRequest(`รหัส ${old.code} ถูกนำไปใช้แล้ว ${used.get(old.id)} รายการ แก้รหัสไม่ได้ — แก้ได้เฉพาะชื่อ`);
      if (r.rate !== null && (Number.isNaN(Number(r.rate)) || d(r.rate).isNeg())) throw badRequest(`บรรทัดที่ ${i + 1}: อัตราต้องเป็นตัวเลขไม่ติดลบ`);
    }
    const keep = new Set(rows.map((r) => r.id).filter(Boolean));
    const removed = cur.filter((r) => !keep.has(r.id));
    const busy = removed.find((r) => used.get(r.id));
    if (busy) throw badRequest(`รหัส ${busy.code} ถูกนำไปใช้แล้ว ${used.get(busy.id)} รายการ ลบไม่ได้ — เปลี่ยนสถานะเป็นเลิกใช้แทน`);
    await db.transaction().execute(async (tx) => {
      const tbl = sql.table(t.table);
      const now = sql`now()`;
      for (const r of removed) await sql`UPDATE ${tbl} SET deleted_at = ${now}, updated_by = ${a.userId} WHERE id = ${r.id}`.execute(tx);
      // เปลี่ยนรหัสสลับกันได้: ตั้งรหัสชั่วคราวก่อน
      for (const r of rows.filter((x) => x.id && byId.get(x.id)!.code !== x.code)) await sql`UPDATE ${tbl} SET code = ${'~' + r.id!.slice(0, 8)} WHERE id = ${r.id}`.execute(tx);
      for (const { id, ...r } of rows) {
        const cols = t.table === 'md_lookup' ? { ...r } : t.table === 'md_unit' ? { ...r, name_th: r.name_th.slice(0, 60), name_en: r.name_en?.slice(0, 60) ?? null } : (({ rate: _r, ...x }) => x)(r);
        if (id) {
          const set = sql.join(Object.entries(cols).map(([k, v]) => sql`${sql.ref(k)} = ${v}`));
          await sql`UPDATE ${tbl} SET ${set}, updated_by = ${a.userId}, updated_at = now() WHERE id = ${id}`.execute(tx);
        } else {
          const ins = { ...cols, company_id: a.companyId, created_by: a.userId, ...(t.table === 'md_lookup' ? { type_code: t.code } : {}) };
          await sql`INSERT INTO ${tbl} (${sql.join(Object.keys(ins).map((k) => sql.ref(k)))}) VALUES (${sql.join(Object.values(ins))})`.execute(tx);
        }
      }
      await logActivity(tx, a, { module: 'SET', action: 'EDIT', docNo: `ตาราง ${t.code}`, table: t.table, detail: { rows: rows.length, removed: removed.map((r) => r.code) } });
    });
    return { ok: true };
  });
}
