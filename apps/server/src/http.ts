import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';

/** ข้อผิดพลาดที่แสดงให้ผู้ใช้ได้ (ข้อความภาษาไทย) */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: Array<{ field?: string; line?: number; message: string }>) {
    super(message);
  }
}
export const badRequest = (msg: string, issues?: AppError['issues']) => new AppError(400, 'BAD_REQUEST', msg, issues);
export const notFound = (what = 'ข้อมูล') => new AppError(404, 'NOT_FOUND', `ไม่พบ${what}`);
export const forbidden = (msg = 'ไม่มีสิทธิ์ใช้งานเมนูนี้') => new AppError(403, 'FORBIDDEN', msg);
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ');
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw zodToAppError(r.error);
  return r.data;
}

export function zodToAppError(e: ZodError): AppError {
  const issues = e.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  return badRequest(issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง', issues);
}

/** แปลงข้อผิดพลาดของ PostgreSQL ที่พบบ่อยเป็นข้อความไทย */
export function pgToAppError(e: unknown): AppError | null {
  const err = e as { code?: string; message?: string; constraint?: string; detail?: string };
  if (!err || typeof err.code !== 'string') return null;
  if (err.code === '23505') return conflict(`ข้อมูลซ้ำกับที่มีอยู่แล้ว${err.constraint ? ` (${err.constraint})` : ''}`);
  if (err.code === '23503') return conflict('ข้อมูลนี้ถูกอ้างถึงอยู่ หรืออ้างถึงข้อมูลที่ไม่มี');
  if (err.code === '23514') return badRequest(`ข้อมูลไม่ผ่านเงื่อนไข${err.constraint ? ` (${err.constraint})` : ''}`);
  if (err.code === 'P0001') {
    const m = err.message ?? '';
    if (/Period is locked/i.test(m)) return badRequest('วันที่อยู่ในงวดที่ปิดแล้ว (Message# 1021) — ต้องเปิดงวดก่อนจึงจะบันทึกหรือแก้ไขได้');
    if (/not balanced/i.test(m)) return badRequest('ใบสำคัญไม่ดุล: ยอดเดบิตไม่เท่ากับเครดิต');
    return badRequest(m);
  }
  return null;
}

export function sendError(reply: FastifyReply, e: AppError) {
  return reply.status(e.status).send({ error: { code: e.code, message: e.message, issues: e.issues } });
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  companyId: string | null;
  branchId: string | null;
  workDate: string | null;
}

declare module 'fastify' {
  interface FastifyRequest { auth?: AuthContext }
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireCompany(req: FastifyRequest): AuthContext & { companyId: string } {
  const a = requireAuth(req);
  if (!a.companyId) throw new AppError(400, 'NO_COMPANY', 'กรุณาเลือกบริษัทก่อน');
  return a as AuthContext & { companyId: string };
}
