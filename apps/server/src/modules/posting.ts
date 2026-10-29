import { sql } from 'kysely';
import { buildPosting, d, DOC_SLOT_ROLES, netByAccount, POSTING_CLASSES, type ItemGroup, type PostingResolver } from '@buddy/core';
import type { Db } from '../db.js';
import { companySettings } from '../company-template.js';

const toMap = <T>(rows: Array<{ k: string; v: T }>) => new Map(rows.map((r) => [r.k, r.v]));

/**
 * ตัวหาบัญชี 3 ชั้นของบริษัท (คู่มือบทที่ 10) — scope = จำกัดเฉพาะรหัสที่เอกสารใช้ (บันทึกเอกสารทีละใบ) · ไม่ระบุ = โหลดทั้งบริษัท (เทียบกับ Express)
 */
export async function loadResolver(db: Db, companyId: string, scope?: { customers?: string[]; suppliers?: string[]; items?: string[]; cheques?: string[] }): Promise<PostingResolver> {
  const ids = (xs?: string[]) => (xs ? [...new Set(xs.filter(Boolean))] : null);
  const inIds = (col: string, xs: string[] | null) => (xs === null ? sql`true` : xs.length ? sql`${sql.ref(col)} = ANY(${xs}::uuid[])` : sql`false`);
  const def = toMap((await db.selectFrom('gl_default_account').select(['role as k', 'account_id as v']).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute()));
  const dta = new Map<string, Map<number, string>>();
  for (const x of await db.selectFrom('md_doc_type_account').select(['doc_type_id', 'slot', 'account_id']).where('company_id', '=', companyId).where('deleted_at', 'is', null).execute()) {
    if (!dta.has(x.doc_type_id)) dta.set(x.doc_type_id, new Map());
    dta.get(x.doc_type_id)!.set(x.slot, x.account_id);
  }
  const cus = toMap((await sql<{ k: string; v: string | null }>`SELECT id AS k, ar_account_id AS v FROM md_customer WHERE company_id = ${companyId} AND ${inIds('id', ids(scope?.customers))}`.execute(db)).rows);
  const sup = toMap((await sql<{ k: string; v: string | null }>`SELECT id AS k, ap_account_id AS v FROM md_supplier WHERE company_id = ${companyId} AND ${inIds('id', ids(scope?.suppliers))}`.execute(db)).rows);
  const items = new Map((await sql<{ id: string; t: string; g: string | null }>`SELECT id, item_type AS t, account_group_id AS g FROM md_item WHERE company_id = ${companyId} AND ${inIds('id', ids(scope?.items))}`.execute(db)).rows.map((r) => [r.id, r]));
  const groups = new Map<string, Partial<ItemGroup>>();
  for (const g of await db.selectFrom('md_item_account_group').select(['id', 'inventory_account_id', 'cogs_account_id', 'sales_account_id', 'sales_return_account_id', 'purchase_account_id', 'purchase_return_account_id']).where('company_id', '=', companyId).execute())
    groups.set(g.id, { inv: g.inventory_account_id, cogs: g.cogs_account_id, sales: g.sales_account_id, sret: g.sales_return_account_id, pur: g.purchase_account_id, pret: g.purchase_return_account_id });
  // วิธีชำระ: บัญชีที่กำหนด หรือบัญชีของบัญชีเงินฝากที่ผูก (เงินโอน)
  const pm = new Map<string, string | null>();
  for (const p of (await sql<{ id: string; gl: string | null; bank: string | null }>`SELECT p.id, p.gl_account_id AS gl, b.gl_account_id AS bank FROM md_payment_method p LEFT JOIN md_bank_account b ON b.id = p.bank_account_id WHERE p.company_id = ${companyId}`.execute(db)).rows)
    pm.set(p.id, p.gl ?? p.bank);
  const chq = toMap((await sql<{ k: string; v: string | null }>`SELECT c.id AS k, b.gl_account_id AS v FROM fin_cheque c JOIN md_bank_account b ON b.id = c.bank_account_id WHERE c.company_id = ${companyId} AND ${inIds('c.id', ids(scope?.cheques))}`.execute(db)).rows);
  const perpetual = (await companySettings(db, companyId))['ic.posting_method'] === 'PERPETUAL';
  return {
    slot: (dt, cls, role) => {
      if (!dt) return null;
      const slots = dta.get(dt);
      if (!slots) return null;
      for (const [k, rl] of Object.entries(DOC_SLOT_ROLES[cls] ?? {})) if (rl === role && slots.get(Number(k))) return slots.get(Number(k))!;
      return null;
    },
    customer: (id) => (id ? cus.get(id) ?? null : null),
    supplier: (id) => (id ? sup.get(id) ?? null : null),
    item: (id) => { const it = items.get(id); return { type: it?.t ?? null, group: (it?.g && groups.get(it.g)) || {} }; },
    paymentMethod: (id) => (id ? pm.get(id) ?? null : null),
    cheque: (id) => (id ? chq.get(id) ?? null : null),
    def: (role) => def.get(role) ?? null,
    perpetual,
  };
}

/** ข้อมูลเอกสารสำหรับเครื่องลงบัญชี (หัว บรรทัดสินค้า วิธีชำระ รายการตัดหนี้) */
export async function loadPostingInput(db: Db, companyId: string, headerIds: string[] | null) {
  const where = headerIds === null ? sql`true` : sql`h.id = ANY(${headerIds}::uuid[])`;
  const H = (await sql<{ id: string; doc_class: string; doc_type_id: string | null; customer_id: string | null; supplier_id: string | null; net_amount: string; vat_amount: string; deposit_amount: string; vat_basis: string | null; doc_no: string }>`
    SELECT h.id, h.doc_class, h.doc_type_id, h.customer_id, h.supplier_id, h.net_amount, h.vat_amount, h.deposit_amount, h.vat_basis, h.doc_no
    FROM doc_header h WHERE h.company_id = ${companyId} AND h.deleted_at IS NULL AND h.doc_status <> 'C' AND h.doc_class = ANY(${[...POSTING_CLASSES]}::text[]) AND ${where}`.execute(db)).rows;
  const hid = H.map((h) => h.id);
  const group = <T extends { header_id: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) { if (!m.has(r.header_id)) m.set(r.header_id, []); m.get(r.header_id)!.push(r); } return m; };
  const lines = group((await sql<{ header_id: string; item_id: string; net_amount: string }>`SELECT header_id, item_id, net_amount FROM doc_line
    WHERE company_id = ${companyId} AND deleted_at IS NULL AND line_kind = 'I' AND item_id IS NOT NULL AND net_amount <> 0 AND header_id = ANY(${hid}::uuid[]) ORDER BY header_id, line_no`.execute(db)).rows);
  const pays = group((await sql<{ header_id: string; method_id: string | null; amount: string; cheque_id: string | null }>`SELECT header_id, payment_method_id AS method_id, amount, cheque_id FROM doc_payment
    WHERE company_id = ${companyId} AND deleted_at IS NULL AND header_id = ANY(${hid}::uuid[]) ORDER BY header_id, line_no`.execute(db)).rows);
  const setts = group((await sql<{ header_id: string; amount: string; vat: string; party_id: string | null; rectype: string | null }>`SELECT s.payment_header_id AS header_id, s.amount, s.vat_amount AS vat, coalesce(i.customer_id, i.supplier_id) AS party_id, s.express_rectype AS rectype
    FROM doc_settlement s JOIN doc_header i ON i.id = s.invoice_header_id WHERE s.company_id = ${companyId} AND s.deleted_at IS NULL AND s.payment_header_id = ANY(${hid}::uuid[])`.execute(db)).rows);
  return { H, lines, pays, setts };
}

/** เทียบผลของเครื่องลงบัญชีกับใบสำคัญที่ Express ลงไว้ (เกณฑ์ P3 ≥ 97%) */
export async function comparePosting(db: Db, companyId: string) {
  const { H, lines, pays, setts } = await loadPostingInput(db, companyId, null);
  const r = await loadResolver(db, companyId);
  const exp = new Map<string, Map<string, ReturnType<typeof d>>>();
  for (const x of (await sql<{ hid: string; acc: string; net: string }>`SELECT j.source_header_id AS hid, l.account_id AS acc, sum(l.debit - l.credit) AS net FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id
      WHERE j.company_id = ${companyId} AND j.doc_status = 'N' AND j.source_header_id IS NOT NULL AND j.deleted_at IS NULL AND l.deleted_at IS NULL GROUP BY 1, 2`.execute(db)).rows) {
    if (!exp.has(x.hid)) exp.set(x.hid, new Map());
    exp.get(x.hid)!.set(x.acc, d(x.net));
  }
  const res = new Map<string, { n: number; exact: number; sameTotal: number; examples: string[] }>();
  const layers: Record<string, number> = {};
  for (const h of H) {
    const e = exp.get(h.id);
    if (!e) continue;
    const p = buildPosting(h, lines.get(h.id) ?? [], (pays.get(h.id) ?? []), (setts.get(h.id) ?? []), r);
    for (const l of p) layers[l.layer] = (layers[l.layer] ?? 0) + 1;
    const mine = netByAccount(p);
    const keys = new Set([...e.keys(), ...[...mine.keys()].filter((k): k is string => !!k)]);
    const rr = res.get(h.doc_class) ?? { n: 0, exact: 0, sameTotal: 0, examples: [] };
    rr.n++;
    const exact = [...keys].every((k) => (e.get(k) ?? d(0)).minus(mine.get(k) ?? d(0)).abs().lt('0.02'));
    const abs = (m: Iterable<ReturnType<typeof d>>) => [...m].reduce((s, v) => s.plus(v.abs()), d(0));
    if (exact) rr.exact++;
    else if (abs(e.values()).minus(abs(mine.values())).abs().lt('0.05')) rr.sameTotal++;
    else if (rr.examples.length < 3) rr.examples.push(h.doc_no);
    res.set(h.doc_class, rr);
  }
  return { byClass: [...res.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ doc_class: k, ...v })), layers };
}
