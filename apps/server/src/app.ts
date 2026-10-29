import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { MENU } from '@buddy/core';
import { rlsAvailable, type Database } from './db.js';
import type { Config } from './config.js';
import { AppError, pgToAppError, sendError, zodToAppError } from './http.js';
import { ZodError } from 'zod';
import { attachAuth, authRoutes } from './modules/auth.js';
import { companyRoutes } from './modules/company.js';
import { glRoutes } from './modules/gl/routes.js';
import { reportRoutes } from './modules/gl/reports.js';
import { templateRoutes } from './modules/gl/templates.js';
import { priorYearRoutes } from './modules/gl/prior-year.js';
import { budgetRoutes } from './modules/gl/budget.js';
import { attachPermissions, permissionRoutes, syncMenus } from './modules/permissions.js';
import { settingsRoutes, syncSettingDefs } from './modules/settings.js';
import { lookupRoutes, partyRoutes } from './modules/parties.js';
import { itemAccountGroupRoutes, itemRoutes } from './modules/items.js';
import { chartTemplateRoutes } from './modules/gl/chart-templates.js';
import { bankingRoutes } from './modules/banking.js';
import { docTypeRoutes } from './modules/doc-types.js';
import { dataTableRoutes } from './modules/data-tables.js';
import { docRoutes } from './modules/docs/routes.js';
import { tradeRoutes } from './modules/docs/trade.js';
import { settleRoutes } from './modules/docs/settle.js';
import { cashDocRoutes } from './modules/docs/cashdocs.js';
import { billRoutes } from './modules/docs/bills.js';
import { whtRoutes } from './modules/wht.js';

export async function buildApp(database: Database, cfg: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' }, bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  const { db } = database;

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return sendError(reply, err);
    if (err instanceof ZodError) return sendError(reply, zodToAppError(err));
    const pgErr = pgToAppError(err);
    if (pgErr) return sendError(reply, pgErr);
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return sendError(reply, new AppError(e.statusCode, 'BAD_REQUEST', e.message ?? 'คำขอไม่ถูกต้อง'));
    req.log.error(err);
    return sendError(reply, new AppError(500, 'INTERNAL', 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่หรือติดต่อผู้ดูแล'));
  });

  attachAuth(app, db);
  await syncMenus(db);
  await syncSettingDefs(db);
  const rls = await rlsAvailable(database);
  if (!rls) app.log.warn('ไม่พบ role buddy_app — ปิด Row-Level Security (ใช้การกรองในโค้ดอย่างเดียว)');
  attachPermissions(app, database, rls);
  app.get('/api/v1/health', async () => ({ ok: true, mode: database.mode, version: '0.1.0' }));
  app.get('/api/v1/menu', async () => MENU);
  authRoutes(app, db, cfg);
  companyRoutes(app, database);
  glRoutes(app, db);
  templateRoutes(app, db);
  priorYearRoutes(app, db);
  budgetRoutes(app, db);
  permissionRoutes(app, db);
  settingsRoutes(app, db);
  lookupRoutes(app, db);
  partyRoutes(app, db);
  itemAccountGroupRoutes(app, db);
  itemRoutes(app, db);
  chartTemplateRoutes(app, db);
  bankingRoutes(app, db);
  docTypeRoutes(app, db);
  dataTableRoutes(app, db);
  docRoutes(app, db);
  tradeRoutes(app, db);
  settleRoutes(app, db);
  cashDocRoutes(app, db);
  billRoutes(app, db);
  whtRoutes(app, db);
  reportRoutes(app, db);

  if (existsSync(cfg.webDist)) {
    await app.register(fastifyStatic, { root: cfg.webDist }); // wildcard: ไฟล์ที่ build ใหม่ใช้ได้ทันทีไม่ต้องเปิด server ใหม่
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return sendError(reply, new AppError(404, 'NOT_FOUND', 'ไม่พบ API นี้'));
      return reply.sendFile('index.html');
    });
  }
  return app;
}
