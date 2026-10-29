import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { SETTING_BY_KEY, SETTING_DEFS, normalizeSetting, settingDataType, validateSetting } from '@buddy/core';
import type { Db } from '../db.js';
import { badRequest, parse, requireCompany } from '../http.js';
import { logActivity } from '../audit.js';
import { companySettings, setSetting } from '../company-template.js';

/** นิยามค่าเริ่มต้น (sys_setting_def) ให้ตรงกับแคตตาล็อกใน packages/core — เรียกตอนเปิด server */
export async function syncSettingDefs(db: Db) {
  const have = new Map((await db.selectFrom('sys_setting_def').select(['id', 'key', 'module', 'data_type', 'label_th', 'express_field', sql<string>`default_value::text`.as('dv')]).where('deleted_at', 'is', null).execute()).map((r) => [r.key, r]));
  for (const d of SETTING_DEFS) {
    const row = { module: d.module, data_type: settingDataType(d), label_th: `${d.no ? d.no + ' ' : ''}${d.label}`.slice(0, 200), express_field: d.from ? d.from.split(':')[0]!.slice(0, 60) : null };
    const dv = JSON.stringify(d.default ?? null);
    const h = have.get(d.key);
    if (!h) await db.insertInto('sys_setting_def').values({ key: d.key, ...row, default_value: sql`${dv}::jsonb` }).execute();
    else if (h.module !== row.module || h.data_type !== row.data_type || h.label_th !== row.label_th || h.express_field !== row.express_field || JSON.stringify(JSON.parse(h.dv ?? 'null')) !== dv)
      await db.updateTable('sys_setting_def').set({ ...row, default_value: sql`${dv}::jsonb` }).where('id', '=', h.id).execute();
  }
}

/** ค่าเริ่มต้นแต่ละระบบ — คู่มือบทที่ 5 S-SET-02/03/05/07/09/10/11 (แบบระเบียนเดียวของบริษัท) */
export function settingsRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/settings', async (req) => {
    const a = requireCompany(req);
    const all = await companySettings(db, a.companyId);
    const own = await db.selectFrom('sys_setting').select('key').where('company_id', '=', a.companyId).where('branch_id', 'is', null).where('deleted_at', 'is', null).execute();
    return { values: Object.fromEntries(SETTING_DEFS.map((d) => [d.key, normalizeSetting(d, all[d.key])])), customized: own.map((r) => r.key).filter((k) => SETTING_BY_KEY.has(k)) };
  });

  app.put('/api/v1/settings', async (req) => {
    const a = requireCompany(req);
    const { values } = parse(z.object({ values: z.record(z.unknown()) }), req.body);
    const issues: Array<{ field: string; message: string }> = [];
    for (const [k, v] of Object.entries(values)) {
      const d = SETTING_BY_KEY.get(k);
      if (!d) { issues.push({ field: k, message: `ไม่รู้จักค่าเริ่มต้น ${k}` }); continue; }
      const err = validateSetting(d, v);
      if (err) issues.push({ field: k, message: err });
    }
    if (issues.length) throw badRequest(issues[0]!.message, issues);
    const cur = await companySettings(db, a.companyId);
    const changed: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(values)) {
      const before = normalizeSetting(SETTING_BY_KEY.get(k)!, cur[k]);
      if (JSON.stringify(before) === JSON.stringify(v)) continue;
      changed[k] = [before, v];
      await setSetting(db, a.companyId, k, v, a.userId);
    }
    // ระบบปีใช้แสดง/รับวันที่ทั้งโปรแกรม (เก็บที่บริษัทด้วย)
    if (changed['gen.year_system']) await db.updateTable('sys_company').set({ year_system: values['gen.year_system'] as string, updated_by: a.userId }).where('id', '=', a.companyId).execute();
    if (Object.keys(changed).length) await logActivity(db, a, { module: 'SET', action: 'SETTINGS', table: 'sys_setting', detail: { changed } });
    return { changed: Object.keys(changed) };
  });
}
