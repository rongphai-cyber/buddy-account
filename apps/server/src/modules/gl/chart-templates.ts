import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db.js';
import { badRequest, parse, requireCompany } from '../../http.js';
import { logActivity } from '../../audit.js';
import { CHART_TEMPLATES, companySettings, loadChartTemplate, type ChartTemplateKey } from '../../company-template.js';

const keyParam = z.object({ key: z.enum(Object.keys(CHART_TEMPLATES) as [ChartTemplateKey, ...ChartTemplateKey[]]) });
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const maskRe = (mask: string) => new RegExp('^' + mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/9/g, '\\d').replace(/!/g, '.').replace(/X/gi, '[A-Za-z0-9]') + '$');

/**
 * ผังบัญชีตัวอย่าง (อ้างอิง): เทียบกับผังของบริษัท · เพิ่มบัญชีที่ยังไม่มี · เติมชื่อภาษาอังกฤษจากชื่อไทยที่ตรงกัน
 * ผังบัญชีของบริษัทยังแก้ไข/เพิ่ม/เปลี่ยนเลขได้ตามปกติที่หน้าผังบัญชี
 */
export function chartTemplateRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/v1/gl/chart-templates', async () => Object.entries(CHART_TEMPLATES).map(([key, label]) => ({ key, label })));

  app.get('/api/v1/gl/chart-templates/:key', async (req) => {
    const a = requireCompany(req);
    const { key } = parse(keyParam, req.params);
    const t = await loadChartTemplate(key);
    const mine = await db.selectFrom('gl_account').select(['account_no', 'name_th', 'name_en']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
    const byNo = new Map(mine.map((m) => [m.account_no, m]));
    const enByTh = englishByThai(t.accounts);
    const mask = (await companySettings(db, a.companyId))['gl.account_mask'] as string | undefined;
    const re = mask ? maskRe(mask) : null;
    return {
      key, label: CHART_TEMPLATES[key], mask: mask ?? null,
      accounts: t.accounts.map((x) => ({ ...x, exists: byNo.has(x.no), same_name: norm(byNo.get(x.no)?.name_th) === norm(x.th), fits_mask: !re || re.test(x.no) })),
      english_fillable: mine.filter((m) => !norm(m.name_en) && enByTh.has(norm(m.name_th))).length,
    };
  });

  app.post('/api/v1/gl/chart-templates/:key/apply', async (req) => {
    const a = requireCompany(req);
    const { key } = parse(keyParam, req.params);
    const b = parse(z.object({ add: z.array(z.string()).max(1000).default([]), fill_english: z.boolean().default(false), overwrite_english: z.boolean().default(false) }), req.body);
    const t = await loadChartTemplate(key);
    const tpl = new Map(t.accounts.map((x) => [x.no, x]));
    const mask = (await companySettings(db, a.companyId))['gl.account_mask'] as string | undefined;
    const re = mask ? maskRe(mask) : null;
    return db.transaction().execute(async (tx) => {
      const mine = await tx.selectFrom('gl_account').select(['id', 'account_no', 'name_th', 'name_en', 'level', 'account_group', 'is_control']).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).execute();
      const byNo = new Map(mine.map((m) => [m.account_no, m]));
      const added: string[] = [];
      // เพิ่มบัญชีที่เลือก (บัญชีคุมที่ยังไม่มีเพิ่มให้ด้วย ตามลำดับจากบนลงล่าง)
      const need = new Set<string>();
      const walk = (no: string) => { const x = tpl.get(no); if (!x) throw badRequest(`ไม่มีบัญชี ${no} ในผังตัวอย่าง`); if (byNo.has(no)) return; if (x.parent) walk(x.parent); need.add(no); };
      for (const no of b.add) walk(no);
      for (const no of [...need].sort((p, q) => tpl.get(p)!.level - tpl.get(q)!.level || p.localeCompare(q))) {
        const x = tpl.get(no)!;
        if (re && !re.test(no)) throw badRequest(`เลขบัญชี ${no} ไม่ตรงรูปแบบเลขบัญชีของบริษัท (${mask}) — เปลี่ยนรูปแบบที่ รายละเอียดกิจการ หรือเพิ่มเองที่หน้าผังบัญชี`);
        const parent = x.parent ? byNo.get(x.parent) : undefined;
        if (parent && !parent.is_control) throw badRequest(`บัญชีคุม ${parent.account_no} ในผังของบริษัทเป็นบัญชีย่อย — เพิ่ม ${no} ใต้บัญชีนี้ไม่ได้`);
        if (parent && parent.account_group !== x.group) throw badRequest(`หมวดบัญชีของ ${no} ไม่ตรงกับบัญชีคุม ${parent.account_no} ในผังของบริษัท`);
        const row = await tx.insertInto('gl_account').values({
          company_id: a.companyId, account_no: no, name_th: x.th, name_en: x.en, parent_id: parent?.id ?? null, level: parent ? parent.level + 1 : 1,
          account_group: x.group, is_control: x.control, normal_side: x.side, use_department: false, created_by: a.userId,
        }).returning(['id', 'account_no', 'name_th', 'name_en', 'level', 'account_group', 'is_control']).executeTakeFirstOrThrow();
        byNo.set(no, row); added.push(no);
      }
      // เติมชื่อภาษาอังกฤษ: ชื่อไทยตรงกันกับผังตัวอย่าง (ไม่ทับชื่อที่มีอยู่ ถ้าไม่สั่ง)
      let filled = 0;
      if (b.fill_english) {
        const enByTh = englishByThai(t.accounts);
        for (const m of byNo.values()) {
          const en = enByTh.get(norm(m.name_th));
          if (!en || (norm(m.name_en) && !b.overwrite_english) || norm(m.name_en) === en) continue;
          await tx.updateTable('gl_account').set({ name_en: en, updated_by: a.userId }).where('id', '=', m.id).execute();
          filled++;
        }
      }
      await logActivity(tx, a, { module: 'GL', action: 'CHART_TEMPLATE', table: 'gl_account', detail: { template: key, added, filled } });
      return { added, filled };
    });
  });
}

/** ชื่อไทย → ชื่ออังกฤษ (ชื่อไทยที่มีหลายคำแปลไม่ใช้ เพื่อไม่เดา) */
function englishByThai(accounts: Array<{ th: string; en: string | null }>) {
  const m = new Map<string, Set<string>>();
  for (const x of accounts) if (x.en) { const k = norm(x.th); if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(norm(x.en)); }
  return new Map([...m].filter(([, v]) => v.size === 1).map(([k, v]) => [k, [...v][0]!]));
}
