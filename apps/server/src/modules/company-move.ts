import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { AI_PAYER_TH, TENANT_MODULES, tenantModuleStatus, type AiPayer } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, forbidden, notFound, parse, requireAuth } from '../http.js';
import { logActivity } from '../audit.js';
import { noticeCustomer, publicBase } from './provider.js';
import { tenantActive } from './auth.js';
import { confirmSecondFactor } from './security.js';
import { tenantLimits } from './usage.js';
import { ensureStandardGroups, STANDARD_GROUPS } from '../standard-groups.js';

/**
 * ย้ายบริษัทจากลูกค้า (tenant) หนึ่งไปอีกรายหนึ่ง — เฉพาะเจ้าหน้าที่ผู้ให้บริการ (HANDOFF 192)
 * เจ้าของ 26/11/2569: ย้าย RIA / OCIO จากลูกค้าเริ่มต้นไปอยู่กับ WTS-Leela (สำนักงานบัญชีที่ดูแลลูกค้าจริง) โดยไม่สร้างลูกค้าใหม่
 *
 * ข้อมูลบัญชีทั้งหมดผูกกับบริษัท (company_id) — ย้ายตามบริษัทไปเอง ไม่ลบ ไม่คัดลอก (เปลี่ยนแค่ sys_company.tenant_id)
 * สิ่งที่ผูกกับลูกค้า (tenant) จัดการดังนี้:
 * - ผู้ใช้ของลูกค้าเดิมที่เข้าได้เฉพาะบริษัทที่ย้าย → ย้ายไปลูกค้าใหม่ด้วย (กลุ่ม ADMIN ไม่ย้าย · กลุ่มตั้งต้นจับคู่รหัสเดียวกันของลูกค้าใหม่ · กลุ่มอื่นล้าง)
 * - ผู้ใช้ที่ยังมีบริษัทอื่นที่ไม่ย้าย → คงอยู่ลูกค้าเดิม เลิกเข้าบริษัทที่ย้าย
 * - สิทธิ์รายเมนูในบริษัทที่ย้ายของกลุ่ม/ผู้ใช้ที่ไม่ได้ย้าย → ลบ (เลิกใช้) แล้วเติมสิทธิ์ของกลุ่มตั้งต้นของลูกค้าใหม่
 * - กุญแจ API ของบริษัทที่ย้ายที่ผูกผู้ใช้ที่ไม่ได้ย้าย → ปิด · ลิงก์เชิญของผู้ใช้ที่ย้าย → เป็นของลูกค้าใหม่
 * - การเข้าระบบที่เปิดอยู่ของผู้ใช้ที่ย้าย/เลิกเข้า → ออกจากระบบ (เข้าใหม่แล้วเห็นตามลูกค้าใหม่)
 */
const uuid = z.string().uuid();
const MOVE_BODY = z.object({
  target_tenant_id: uuid,
  company_ids: z.array(uuid).min(1, 'เลือกบริษัทที่จะย้ายอย่างน้อย 1 บริษัท').max(50),
});
const STANDARD_CODES = new Set(STANDARD_GROUPS.map((g) => g.code));

type TenantInfo = { id: string; code: string; name: string; status: string; expires_on: string | null; purged_at: string | null; moved_to: string | null; ai_payer: string; ai_limit_usd: string | null; single_session: boolean; require_mfa: boolean };

async function tenantInfo(db: Db, id: string) {
  return db.selectFrom('sys_tenant').select(['id', 'code', 'name', 'status', 'expires_on', 'purged_at', 'moved_to', 'ai_payer', 'ai_limit_usd', 'single_session', 'require_mfa'])
    .where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst() as Promise<TenantInfo | undefined>;
}
const usable = (t: TenantInfo) => !t.purged_at && !t.moved_to && tenantActive(t.status, t.expires_on);
const notUsable = (t: TenantInfo, role: string) => `${role} ${t.code} ${t.purged_at ? 'ถูกลบข้อมูลแล้ว' : t.moved_to ? 'ย้ายไปเซิร์ฟเวอร์อื่นแล้ว' : t.status === 'S' ? 'ถูกระงับอยู่' : t.status === 'I' ? 'เลิกใช้บริการแล้ว' : 'หมดอายุแล้ว'} — ย้ายบริษัทได้เฉพาะลูกค้าที่ใช้งานอยู่ทั้งสองฝ่าย (เปลี่ยนสถานะเป็น "ใช้งาน" ก่อน)`;

/** แผนการย้าย — คำนวณครั้งเดียว ใช้ทั้งตัวอย่างก่อนยืนยันและตอนย้ายจริง (ในทรานแซกชันเดียวกัน) */
async function movePlan(db: Db, sourceId: string, b: z.infer<typeof MOVE_BODY>) {
  const src = await tenantInfo(db, sourceId);
  if (!src) throw notFound('ลูกค้าผู้ใช้บริการ');
  const dst = await tenantInfo(db, b.target_tenant_id);
  if (!dst) throw notFound('ลูกค้าปลายทาง');
  if (src.id === dst.id) throw badRequest('ลูกค้าปลายทางต้องเป็นคนละรายกับลูกค้าเดิม');
  if (!usable(src)) throw badRequest(notUsable(src, 'ลูกค้าเดิม'));
  if (!usable(dst)) throw badRequest(notUsable(dst, 'ลูกค้าปลายทาง'));
  const ids = [...new Set(b.company_ids)];
  const companies = await db.selectFrom('sys_company').select(['id', 'code', 'name_th', 'tenant_id', 'status']).where('id', 'in', ids).where('deleted_at', 'is', null).orderBy('code').execute();
  const foreign = companies.filter((c) => c.tenant_id !== src.id);
  if (companies.length !== ids.length || foreign.length) throw badRequest(`บริษัทที่เลือกต้องเป็นของลูกค้า ${src.code} และยังไม่ถูกลบ${foreign.length ? ` (${foreign.map((c) => c.code).join(', ')} ไม่ใช่)` : ''}`);
  // รหัสบริษัทต้องไม่ซ้ำกับบริษัทของลูกค้าปลายทาง (ฐานข้อมูลบังคับไม่ซ้ำทั้งระบบอยู่แล้ว — ตรวจซ้ำให้ข้อความชัด)
  const dstCos = await db.selectFrom('sys_company').select(['id', 'code']).where('tenant_id', '=', dst.id).where('deleted_at', 'is', null).execute();
  const clash = companies.filter((c) => dstCos.some((x) => x.code.toUpperCase() === c.code.toUpperCase()));
  if (clash.length) throw badRequest(`ลูกค้า ${dst.code} มีบริษัทรหัส ${clash.map((c) => c.code).join(', ')} อยู่แล้ว — เปลี่ยนรหัสบริษัทก่อนย้าย`);

  // ผู้ใช้ของลูกค้าเดิมที่ผูกกับบริษัทที่ย้าย
  const links = await db.selectFrom('sys_user_company as uc').innerJoin('sys_user as u', 'u.id', 'uc.user_id').leftJoin('sys_user_group as g', 'g.id', 'u.user_group_id')
    .select(['uc.id as link_id', 'uc.company_id', 'u.id', 'u.username', 'u.display_name', 'u.tenant_id', 'g.code as group_code'])
    .where('uc.company_id', 'in', ids).where('uc.deleted_at', 'is', null).where('u.deleted_at', 'is', null).execute();
  const userIds = [...new Set(links.map((l) => l.id))];
  const others = userIds.length ? await db.selectFrom('sys_user_company as uc').innerJoin('sys_company as c', 'c.id', 'uc.company_id')
    .select(['uc.user_id', 'c.code']).where('uc.user_id', 'in', userIds).where('uc.company_id', 'not in', ids).where('uc.deleted_at', 'is', null).where('c.deleted_at', 'is', null).execute() : [];
  const dstGroups = await db.selectFrom('sys_user_group').select(['id', 'code', 'name']).where('tenant_id', '=', dst.id).where('deleted_at', 'is', null).execute();
  const users = userIds.map((id) => {
    const l = links.find((x) => x.id === id)!;
    const rest = others.filter((o) => o.user_id === id).map((o) => o.code);
    const fromSource = l.tenant_id === src.id;
    const admin = l.group_code === 'ADMIN';
    // ย้ายตาม: ผู้ใช้ของลูกค้าเดิม ไม่ใช่กลุ่ม ADMIN และไม่มีบริษัทอื่นที่ไม่ย้าย
    const move = fromSource && !admin && !rest.length;
    const newGroup = move && l.group_code && STANDARD_CODES.has(l.group_code) ? dstGroups.find((g) => g.code === l.group_code) ?? null : null;
    return { id, username: l.username, display_name: l.display_name, group_code: l.group_code, companies: links.filter((x) => x.id === id).map((x) => companies.find((c) => c.id === x.company_id)!.code),
      action: move ? 'move' as const : 'unlink' as const, keeps: rest, new_group: newGroup ? newGroup.code : null, reason: move ? null : admin ? 'กลุ่ม ADMIN ของลูกค้าเดิม' : !fromSource ? 'ไม่ใช่ผู้ใช้ของลูกค้าเดิม' : `ยังเข้าบริษัทอื่น ${rest.join(', ')}` };
  });
  const moving = users.filter((u) => u.action === 'move').map((u) => u.id);

  // สิทธิ์รายเมนูในบริษัทที่ย้าย: ของกลุ่ม/ผู้ใช้ที่ไม่ได้ย้ายไปลูกค้าใหม่ → ลบ
  const perms = await sql<{ id: string; subject_type: string; subject_id: string; tenant_id: string | null }>`
    SELECT p.id, p.subject_type, p.subject_id, COALESCE(u.tenant_id, g.tenant_id) AS tenant_id FROM sys_permission p
      LEFT JOIN sys_user u ON p.subject_type = 'U' AND u.id = p.subject_id LEFT JOIN sys_user_group g ON p.subject_type = 'G' AND g.id = p.subject_id
     WHERE p.company_id = ANY(${ids}::uuid[]) AND p.deleted_at IS NULL`.execute(db);
  const dropPerm = perms.rows.filter((p) => !(p.subject_type === 'U' && moving.includes(p.subject_id)) && p.tenant_id !== dst.id);
  // กุญแจ API ของบริษัทที่ย้าย ที่ผูกผู้ใช้ซึ่งไม่ได้ย้ายไปลูกค้าใหม่ → ปิด
  const keys = await db.selectFrom('sys_api_key as k').innerJoin('sys_user as u', 'u.id', 'k.user_id').innerJoin('sys_company as c', 'c.id', 'k.company_id')
    .select(['k.id', 'k.name', 'k.key_prefix', 'c.code as company', 'u.username', 'u.tenant_id', 'u.id as user_id']).where('k.company_id', 'in', ids).where('k.status', '=', 'A').where('k.deleted_at', 'is', null).execute();
  const dropKeys = keys.filter((k) => !moving.includes(k.user_id) && k.tenant_id !== dst.id);
  // อื่น ๆ ที่ผูกกับลูกค้า — แสดงให้รู้ว่าเปลี่ยนอะไร
  const lim = await tenantLimits(db, dst.id);
  const dstUsers = Number((await db.selectFrom('sys_user').select(sql<number>`count(*)::int`.as('n')).where('tenant_id', '=', dst.id).where('deleted_at', 'is', null).executeTakeFirstOrThrow()).n);
  const today = new Date().toISOString().slice(0, 10);
  const mods = async (t: string) => tenantModuleStatus((await sql<{ module_key: string; enabled: boolean; valid_to: string | null; seats: number | null; remark: string | null; app_url: string | null }>`
    SELECT module_key, enabled, valid_to::text AS valid_to, seats, remark, app_url FROM sys_tenant_module WHERE tenant_id = ${t} AND deleted_at IS NULL`.execute(db)).rows as never, today)
    .filter((m) => m.active).map((m) => m.key);
  const [srcMods, dstMods] = [await mods(src.id), await mods(dst.id)];
  const counts = await sql<{ company_id: string; docs: number; journals: number; devices: number; ai_month: string }>`
    SELECT c.id AS company_id,
      (SELECT count(*)::int FROM doc_header d WHERE d.company_id = c.id AND d.deleted_at IS NULL) AS docs,
      (SELECT count(*)::int FROM gl_journal j WHERE j.company_id = c.id AND j.deleted_at IS NULL) AS journals,
      (SELECT count(*)::int FROM sys_device v WHERE v.company_id = c.id AND v.deleted_at IS NULL) AS devices,
      (SELECT coalesce(sum(g.cost_usd), 0)::text FROM sys_ai_usage g WHERE g.company_id = c.id AND g.deleted_at IS NULL AND g.created_at >= date_trunc('month', now())) AS ai_month
      FROM sys_company c WHERE c.id = ANY(${ids}::uuid[])`.execute(db);
  const maxCo = lim?.limits.companies ?? null, maxU = lim?.limits.users ?? null;
  const warnings: string[] = [];
  if (maxCo != null && dstCos.length + companies.length > maxCo) warnings.push(`ลูกค้า ${dst.code} จะมีบริษัท ${dstCos.length + companies.length} บริษัท เกินแพ็กเกจ (${maxCo}) — ปรับแพ็กเกจของลูกค้าปลายทางหลังย้าย`);
  if (maxU != null && dstUsers + moving.length > maxU) warnings.push(`ลูกค้า ${dst.code} จะมีผู้ใช้ ${dstUsers + moving.length} คน เกินแพ็กเกจ (${maxU})`);
  const lostMods = srcMods.filter((k) => !dstMods.includes(k));
  if (lostMods.length) warnings.push(`ลูกค้าปลายทางไม่ได้เปิดโปรแกรม ${lostMods.map((k) => TENANT_MODULES.find((m) => m.key === k)?.label ?? k).join(', ')} ที่ลูกค้าเดิมเปิดอยู่ — ผู้ใช้ที่ย้ายจะเปิดจาก Hub ไม่ได้จนกว่าจะเปิดให้ลูกค้าปลายทาง`);
  if (src.ai_payer !== dst.ai_payer) warnings.push(`ผู้จ่ายค่า AI เปลี่ยนจาก "${AI_PAYER_TH[src.ai_payer as AiPayer]}" เป็น "${AI_PAYER_TH[dst.ai_payer as AiPayer]}"${dst.ai_payer === 'P' ? ` — ใช้กุญแจของ WTS และนับรวมเพดาน ${dst.ai_limit_usd ?? 'ไม่จำกัด'} ดอลลาร์ของลูกค้าปลายทาง` : ' — บริษัทใช้กุญแจ API ของตัวเอง (ถ้าเคยใส่ไว้ยังอยู่)'}`);
  return {
    source: { id: src.id, code: src.code, name: src.name }, target: { id: dst.id, code: dst.code, name: dst.name },
    companies: companies.map((c) => { const n = counts.rows.find((x) => x.company_id === c.id)!; return { id: c.id, code: c.code, name_th: c.name_th, docs: n.docs, journals: n.journals, devices: n.devices, ai_month_usd: n.ai_month }; }),
    quota: { companies_after: dstCos.length + companies.length, max_companies: maxCo, users_after: dstUsers + moving.length, max_users: maxU },
    users, moving,
    permissions: { drop: dropPerm.length, drop_ids: dropPerm.map((p) => p.id) },
    api_keys: dropKeys.map((k) => ({ id: k.id, name: k.name, key_prefix: k.key_prefix, company: k.company, username: k.username })),
    tenant_settings: {
      modules: { source: srcMods, target: dstMods },
      ai_payer: { source: src.ai_payer, target: dst.ai_payer, target_limit_usd: dst.ai_payer === 'P' ? dst.ai_limit_usd : null },
      single_session: { source: src.single_session, target: dst.single_session },
      require_mfa: { source: src.require_mfa, target: dst.require_mfa },
    },
    target_groups: dstGroups.map((g) => g.code).sort(),
    warnings,
    confirm_text: companies.map((c) => c.code).join(' '),
  };
}

/** ข้อความยืนยัน: พิมพ์รหัสบริษัททุกบริษัทที่ย้าย (คั่นด้วยช่องว่างหรือจุลภาค ลำดับใดก็ได้) */
const sameCodes = (typed: string, codes: string[]) => {
  const a = typed.split(/[\s,]+/).filter(Boolean).map((x) => x.toUpperCase()).sort();
  const b = codes.map((x) => x.toUpperCase()).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

export function companyMoveRoutes(app: FastifyInstance, db: Db) {
  const requirePlatform = (req: Parameters<typeof requireAuth>[0]) => { const a = requireAuth(req); if (!a.isPlatform || a.apiKeyId) throw forbidden('เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม'); return a; };
  const strip = <T extends { moving: string[]; permissions: { drop: number; drop_ids: string[] } }>(p: T) => { const { moving: _m, permissions, ...rest } = p; return { ...rest, permissions: { drop: permissions.drop } }; };

  app.post('/api/v1/tenants/:id/move-companies/preview', async (req) => {
    requirePlatform(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return strip(await movePlan(db, id, parse(MOVE_BODY, req.body)));
  });

  app.post('/api/v1/tenants/:id/move-companies', async (req) => {
    const a = requirePlatform(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const b = parse(MOVE_BODY.extend({ confirm: z.string().trim().min(1, 'พิมพ์รหัสบริษัทที่จะย้ายเพื่อยืนยัน'), totp_code: z.string().trim().max(20).nullable().optional() }), req.body);
    const pre = await movePlan(db, id, b);
    if (!sameCodes(b.confirm, pre.companies.map((c) => c.code))) throw badRequest(`พิมพ์รหัสบริษัทที่จะย้ายให้ครบและตรง: ${pre.confirm_text}`, [{ field: 'confirm', message: 'ไม่ตรง' }]);
    await confirmSecondFactor(db, a.userId, b.totp_code);
    const res = await db.transaction().execute(async (tx) => {
      // คำนวณใหม่ในทรานแซกชัน (กันข้อมูลเปลี่ยนระหว่างดูตัวอย่างกับกดยืนยัน) · ล็อกแถวบริษัท
      await sql`SELECT id FROM sys_company WHERE id = ANY(${pre.companies.map((c) => c.id)}::uuid[]) FOR UPDATE`.execute(tx);
      const p = await movePlan(tx, id, b);
      const ids = p.companies.map((c) => c.id);
      const now = sql`now()` as never;
      await tx.updateTable('sys_company').set({ tenant_id: p.target.id, updated_by: a.userId }).where('id', 'in', ids).execute();
      // ผู้ใช้ที่ย้ายตาม: เปลี่ยนลูกค้า + กลุ่ม (ตั้งต้นจับคู่รหัส / อื่นล้าง) · ลิงก์เชิญที่ยังไม่ใช้ตามไปด้วย
      const dstGroups = await tx.selectFrom('sys_user_group').select(['id', 'code']).where('tenant_id', '=', p.target.id).where('deleted_at', 'is', null).execute();
      for (const u of p.users.filter((x) => x.action === 'move')) {
        const g = u.new_group ? dstGroups.find((x) => x.code === u.new_group)?.id ?? null : null;
        await tx.updateTable('sys_user').set({ tenant_id: p.target.id, user_group_id: g, updated_by: a.userId }).where('id', '=', u.id).execute();
      }
      if (p.moving.length) await tx.updateTable('sys_user_invite').set({ tenant_id: p.target.id }).where('user_id', 'in', p.moving).where('deleted_at', 'is', null).execute();
      // ผู้ใช้ที่ไม่ย้าย: เลิกเข้าบริษัทที่ย้าย
      const unlink = p.users.filter((x) => x.action === 'unlink').map((x) => x.id);
      const unlinked = unlink.length ? Number((await tx.updateTable('sys_user_company').set({ deleted_at: now, updated_by: a.userId }).where('user_id', 'in', unlink).where('company_id', 'in', ids).where('deleted_at', 'is', null).executeTakeFirst()).numUpdatedRows) : 0;
      // สิทธิ์รายเมนูของลูกค้าเดิมในบริษัทที่ย้าย → เลิกใช้ · เติมสิทธิ์ของกลุ่มตั้งต้นของลูกค้าใหม่
      if (p.permissions.drop_ids.length) await tx.updateTable('sys_permission').set({ deleted_at: now, updated_by: a.userId }).where('id', 'in', p.permissions.drop_ids).execute();
      const std = await ensureStandardGroups(tx, p.target.id, a.userId, { createGroups: false, companyIds: ids });
      // กุญแจ API ที่ผูกผู้ใช้ซึ่งไม่ได้ย้าย → ปิด
      if (p.api_keys.length) await tx.updateTable('sys_api_key').set({ status: 'I', updated_by: a.userId }).where('id', 'in', p.api_keys.map((k) => k.id)).execute();
      // ออกจากระบบ: ผู้ใช้ที่ย้าย/เลิกเข้า (เข้าใหม่แล้วเห็นตามลูกค้าใหม่)
      const affected = [...p.moving, ...unlink];
      const ended = affected.length ? Number((await tx.updateTable('sys_session').set({ ended_at: now, end_reason: 'company_moved' }).where('user_id', 'in', affected).where('ended_at', 'is', null).executeTakeFirst()).numUpdatedRows) : 0;
      const counts = { users_moved: p.moving.length, links_removed: unlinked, permissions_removed: p.permissions.drop_ids.length, standard_rights_added: std.rows, api_keys_disabled: p.api_keys.length, sessions_ended: ended };
      for (const c of p.companies) {
        await logActivity(tx, { companyId: c.id, userId: a.userId }, { module: 'SYS', action: 'MOVE_COMPANY', docNo: c.code, table: 'sys_company', rowId: c.id,
          detail: { from: p.source, to: p.target, companies: p.companies.map((x) => x.code), ...counts, users: p.users.map((u) => ({ username: u.username, action: u.action, group: u.new_group })), api_keys: p.api_keys.map((k) => k.key_prefix) } });
      }
      return { ...counts, source: p.source, target: p.target, companies: p.companies.map((c) => ({ id: c.id, code: c.code, name_th: c.name_th })) };
    });
    // HANDOFF 204 ข้อ d5: แจ้งลูกค้าทั้งสองราย (อีเมลผู้ติดต่อ)
    const list = res.companies.map((c) => `${c.code} ${c.name_th}`).join(', ');
    const when = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    noticeCustomer(db, publicBase(req), res.source.id, `แจ้งเตือน: ย้ายบริษัทออกจากบัญชีของท่าน`, [`ผู้ให้บริการ Buddy Account ย้ายบริษัท ${list} ไปอยู่ในบัญชีลูกค้า ${res.target.code} เมื่อ ${when}`, 'ถ้าท่านไม่ได้ขอ โปรดแจ้งผู้ให้บริการทันที']);
    noticeCustomer(db, publicBase(req), res.target.id, `แจ้งเตือน: ย้ายบริษัทเข้าบัญชีของท่าน`, [`ผู้ให้บริการ Buddy Account ย้ายบริษัท ${list} จากบัญชีลูกค้า ${res.source.code} เข้ามาในบัญชีของท่าน เมื่อ ${when}`, 'ถ้าท่านไม่ได้ขอ โปรดแจ้งผู้ให้บริการทันที']);
    return res;
  });
}
