import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Database, Db } from '../db.js';
import { AppError, badRequest, forbidden, notFound, parse, requireAuth, type AuthContext } from '../http.js';
import { logActivity } from '../audit.js';
import { applyPostingTemplate } from '../company-template.js';
import { importExpress, validateExpress, folderSource, type ImportReport } from '../import/express/migrate.js';
import { defaultTenant } from './company.js';

/**
 * T0.12 นำข้อมูลจากโปรแกรม Express ผ่านหน้าจอ: อัปโหลดแฟ้ม .DBF ของบริษัท → ย้ายข้อมูลเป็นบริษัทใหม่ (ทรานแซกชันเดียว)
 * → ใส่กฎการลงบัญชี → ตรวจกระทบยอดกับ Express · ใช้ได้ทั้ง PostgreSQL และ PGlite (โหมดติดตั้งในเครื่อง)
 * งานเก็บในหน่วยความจำของเครื่องแม่ข่าย (แฟ้มที่อัปโหลดอยู่โฟลเดอร์ชั่วคราว ลบเมื่อเสร็จ/ยกเลิก)
 */
/** แฟ้มที่ผู้นำเข้าอ่าน — 4 แฟ้มแรกต้องมี (ข้อมูลบริษัท รอบบัญชี ผังบัญชี ประเภทเอกสาร) */
export const EXPRESS_REQUIRED = ['ISINFO', 'ISPRD', 'GLACC', 'ISRUN'];
export const EXPRESS_FILES = [...EXPRESS_REQUIRED, 'APBIL', 'APMAS', 'APRCPCQ', 'APRCPIT', 'APTRN', 'ARBIL', 'ARMAS', 'ARRCPCQ', 'ARRCPIT', 'ARSHIP', 'ARTRN', 'ARTRNRM',
  'BKMAS', 'BKTRN', 'FAMAS', 'GLBAL', 'GLBUD', 'GLJNL', 'GLJNLIT', 'GLPTT', 'GLPTTIT', 'GLREP', 'GLREPIT', 'GLTPL', 'GLTPLIT', 'ISACC', 'ISTAB', 'ISTAX', 'ISVAT',
  'OESLM', 'OESO', 'OESOIT', 'POPR', 'POPRIT', 'STBOM', 'STCRD', 'STLOC', 'STMAS', 'STTAK', 'STTRN'];
const MAX_FILE = 600 * 1024 * 1024;

type Job = {
  id: string; tenantId: string; userId: string; code: string; dir: string; files: Record<string, number>;
  status: 'upload' | 'running' | 'done' | 'error'; step: string; pct: number; startedAt?: number; finishedAt?: number;
  report?: ImportReport & { validation?: unknown }; error?: string;
};
const jobs = new Map<string, Job>();
const view = (j: Job) => ({ id: j.id, code: j.code, files: j.files, status: j.status, step: j.step, pct: j.pct, report: j.report ?? null, error: j.error ?? null,
  seconds: j.startedAt ? Math.round(((j.finishedAt ?? Date.now()) - j.startedAt) / 1000) : null, missing: EXPRESS_REQUIRED.filter((f) => !(f in j.files)) });

/** ผู้นำเข้าต้องเป็นผู้ดูแลระบบ เห็นได้เฉพาะงานของลูกค้าตัวเอง (ผู้ให้บริการเห็นทุกงาน) */
function jobOf(a: AuthContext, id: string) {
  const j = jobs.get(id);
  if (!j || (!a.isPlatform && j.tenantId !== a.tenantId)) throw notFound('งานนำเข้า');
  return j;
}
function admin(a: AuthContext) {
  if (!a.isAdmin) throw forbidden('เฉพาะผู้ดูแลระบบนำข้อมูลจาก Express ได้');
  if (a.apiKeyId) throw forbidden('กุญแจ API นำเข้าข้อมูลไม่ได้');
}
const codeSchema = z.string().trim().min(1, 'ป้อนรหัสบริษัท').max(20).regex(/^[A-Za-z0-9_-]+$/, 'รหัสบริษัทใช้ตัวอักษรอังกฤษ ตัวเลข _ -');

async function checkCompany(db: Db, tenantId: string, code: string) {
  const t = await db.selectFrom('sys_tenant').select(['id', 'max_companies', 'status']).where('id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!t) throw badRequest('ไม่พบลูกค้าผู้ใช้บริการ');
  if (t.max_companies !== null) {
    const n = await db.selectFrom('sys_company').select(sql<number>`count(*)`.as('n')).where('tenant_id', '=', tenantId).where('deleted_at', 'is', null).executeTakeFirstOrThrow();
    if (Number(n.n) >= t.max_companies) throw badRequest(`แพ็กเกจนี้สร้างบริษัทได้สูงสุด ${t.max_companies} บริษัท`);
  }
  if (await db.selectFrom('sys_company').select('id').where('code', '=', code).where('deleted_at', 'is', null).executeTakeFirst())
    throw badRequest(`รหัสบริษัท ${code} มีอยู่แล้ว — ใช้รหัสอื่น`);
}

async function run(database: Database, j: Job) {
  const { db } = database;
  j.status = 'running'; j.startedAt = Date.now(); j.step = 'เริ่มย้ายข้อมูล'; j.pct = 1;
  try {
    const src = folderSource(j.dir);
    const report = await importExpress(db, src, { code: j.code, tenantId: j.tenantId, idNamespace: `express-import/${j.id}`, userId: j.userId,
      onProgress: (step, pct) => { j.step = step; j.pct = Math.min(90, Math.max(j.pct, Math.round(pct * 0.9))); } });
    j.step = 'ใส่กฎการลงบัญชี'; j.pct = 92;
    await applyPostingTemplate(database.execScript, report.company_id);
    j.step = 'ตรวจกระทบยอดกับ Express'; j.pct = 95;
    const validation = await validateExpress(db, src, report.company_id).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    await logActivity(db, { companyId: report.company_id, userId: j.userId }, { module: 'SYS', action: 'IMPORT_EXPRESS', docNo: j.code, detail: { files: Object.keys(j.files).length, counts: report.counts } });
    j.report = { ...report, validation }; j.status = 'done'; j.step = 'เสร็จ'; j.pct = 100;
  } catch (e) {
    j.status = 'error'; j.error = e instanceof Error ? e.message : String(e); j.step = 'ไม่สำเร็จ — ไม่มีข้อมูลใดถูกบันทึก';
  } finally {
    j.finishedAt = Date.now();
    rmSync(j.dir, { recursive: true, force: true });
  }
}

export function expressImportRoutes(app: FastifyInstance, database: Database) {
  const { db } = database;
  /** เริ่มงาน: ตรวจรหัสบริษัทและโควตาก่อนอัปโหลด */
  app.post('/api/v1/express-import/jobs', async (req) => {
    const a = requireAuth(req); admin(a);
    const b = parse(z.object({ code: codeSchema, tenant_id: z.string().uuid().optional() }), req.body);
    const tenantId = a.isPlatform ? (b.tenant_id ?? (await defaultTenant(db))) : a.tenantId!;
    await checkCompany(db, tenantId, b.code);
    if ([...jobs.values()].some((x) => x.status === 'running')) throw new AppError(409, 'IMPORT_BUSY', 'มีงานนำเข้ากำลังทำอยู่ — รอให้เสร็จก่อน');
    const id = randomUUID();
    const dir = join(tmpdir(), 'buddy-express-import', id);
    mkdirSync(dir, { recursive: true });
    const j: Job = { id, tenantId, userId: a.userId, code: b.code, dir, files: {}, status: 'upload', step: 'รออัปโหลดแฟ้ม', pct: 0 };
    jobs.set(id, j);
    return view(j);
  });
  /** อัปโหลดทีละแฟ้ม (เนื้อแฟ้มดิบ) — รับเฉพาะชื่อแฟ้มที่ผู้นำเข้าใช้ */
  app.put('/api/v1/express-import/jobs/:id/files/:name', { bodyLimit: MAX_FILE }, async (req) => {
    const a = requireAuth(req); admin(a);
    const p = parse(z.object({ id: z.string().uuid(), name: z.string().regex(/^[A-Za-z0-9_]{1,12}$/, 'ชื่อแฟ้มไม่ถูกต้อง') }), req.params);
    const j = jobOf(a, p.id);
    if (j.status !== 'upload') throw badRequest('งานนี้เริ่มนำเข้าแล้ว — เริ่มงานใหม่ถ้าต้องการอัปโหลดอีกครั้ง');
    const name = p.name.toUpperCase();
    if (!EXPRESS_FILES.includes(name)) throw badRequest(`${name}.DBF ไม่ใช่แฟ้มที่ใช้นำเข้า`);
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length < 32) throw badRequest(`${name}.DBF ว่างหรือไม่ใช่แฟ้ม .DBF`);
    writeFileSync(join(j.dir, `${name}.DBF`), body);
    j.files[name] = body.length;
    return view(j);
  });
  app.post('/api/v1/express-import/jobs/:id/run', async (req) => {
    const a = requireAuth(req); admin(a);
    const j = jobOf(a, parse(z.object({ id: z.string().uuid() }), req.params).id);
    if (j.status !== 'upload') throw badRequest('งานนี้เริ่มไปแล้ว');
    const missing = EXPRESS_REQUIRED.filter((f) => !(f in j.files));
    if (missing.length) throw badRequest(`ยังไม่ได้อัปโหลด ${missing.map((m) => m + '.DBF').join(', ')} — เลือกโฟลเดอร์ข้อมูลบริษัทของ Express ให้ครบ`);
    if (!existsSync(j.dir)) throw badRequest('แฟ้มที่อัปโหลดหายไป (เครื่องแม่ข่ายเริ่มใหม่) — เริ่มงานใหม่');
    if ([...jobs.values()].some((x) => x.status === 'running')) throw new AppError(409, 'IMPORT_BUSY', 'มีงานนำเข้ากำลังทำอยู่ — รอให้เสร็จก่อน');
    await checkCompany(db, j.tenantId, j.code);
    void run(database, j);
    return view(j);
  });
  app.get('/api/v1/express-import/jobs/:id', async (req) => {
    const a = requireAuth(req); admin(a);
    return view(jobOf(a, parse(z.object({ id: z.string().uuid() }), req.params).id));
  });
  /** ยกเลิกก่อนเริ่ม: ลบแฟ้มที่อัปโหลด */
  app.delete('/api/v1/express-import/jobs/:id', async (req) => {
    const a = requireAuth(req); admin(a);
    const j = jobOf(a, parse(z.object({ id: z.string().uuid() }), req.params).id);
    if (j.status === 'running') throw badRequest('กำลังนำเข้า — ยกเลิกระหว่างทางไม่ได้ (ถ้าไม่สำเร็จ ระบบจะไม่บันทึกข้อมูลใดเลย)');
    rmSync(j.dir, { recursive: true, force: true });
    jobs.delete(j.id);
    return { ok: true };
  });
  app.get('/api/v1/express-import/files', async (req) => { const a = requireAuth(req); admin(a); return { required: EXPRESS_REQUIRED, files: EXPRESS_FILES }; });
}
