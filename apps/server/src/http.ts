import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { TenantModuleKey } from '@buddy/core';

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

/** ข้อมูลซ้ำ (23505) ตามดัชนีไม่ซ้ำ — บอกวิธีแก้ ไม่แสดงชื่อดัชนี (HANDOFF 158) */
const DUPLICATE: Record<string, string> = {
  uq_doc_header_company_doc_type_doc_no: 'เลขที่เอกสารนี้มีผู้บันทึกไปก่อนแล้ว (อาจบันทึกพร้อมกันจากอีกเครื่อง) — เว้นช่องเลขที่ว่างเพื่อใช้เลขอัตโนมัติ หรือเปลี่ยนเลขที่ แล้วบันทึกอีกครั้ง',
  uq_gl_journal_company_journal_book_voucher_no: 'เลขที่ใบสำคัญนี้มีผู้บันทึกไปก่อนแล้ว (อาจบันทึกพร้อมกันจากอีกเครื่อง) — กดบันทึกอีกครั้งเพื่อใช้เลขถัดไป หรือเปลี่ยนเลขที่ใบสำคัญ',
  uq_md_customer_company_code: 'รหัสลูกค้านี้มีอยู่แล้ว (อาจมีผู้เพิ่มพร้อมกันจากอีกเครื่อง) — เปลี่ยนรหัสลูกค้าแล้วบันทึกอีกครั้ง',
  uq_md_supplier_company_code: 'รหัสผู้จำหน่ายนี้มีอยู่แล้ว (อาจมีผู้เพิ่มพร้อมกันจากอีกเครื่อง) — เปลี่ยนรหัสผู้จำหน่ายแล้วบันทึกอีกครั้ง',
  uq_md_item_company_code: 'รหัสสินค้านี้มีอยู่แล้ว (อาจมีผู้เพิ่มพร้อมกันจากอีกเครื่อง) — เปลี่ยนรหัสสินค้าแล้วบันทึกอีกครั้ง',
};
/** แปลงข้อผิดพลาดของ PostgreSQL ที่พบบ่อยเป็นข้อความไทย */
export function pgToAppError(e: unknown): AppError | null {
  const err = e as { code?: string; message?: string; constraint?: string; detail?: string };
  if (!err || typeof err.code !== 'string') return null;
  if (err.code === '23505') return conflict(DUPLICATE[err.constraint ?? ''] ?? 'ข้อมูลซ้ำกับที่มีอยู่แล้ว (อาจมีผู้บันทึกรายการเดียวกันพร้อมกันจากอีกเครื่อง) — ตรวจรหัส/เลขที่ที่ซ้ำ แล้วบันทึกอีกครั้ง');
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
  /** ว่าง = เข้าด้วยกุญแจ API (ไม่มี session) */
  sessionId: string;
  /** ผู้ดูแลระบบที่ยังไม่ตั้งยืนยันตัวตนสองขั้น (T0.16) — ใช้ได้เฉพาะหน้าตั้งค่า */
  mfaSetupRequired?: boolean;
  /** ลูกค้าตั้ง "บังคับยืนยันตัวตนสองขั้นทุกผู้ใช้" (sys_tenant.require_mfa · HANDOFF 146) — ไม่ใช้กับเจ้าหน้าที่ผู้ให้บริการ */
  tenantRequireMfa?: boolean;
  /** เข้าด้วยกุญแจ API (T7.5): รหัสกุญแจ · อ่านอย่างเดียว */
  apiKeyId?: string;
  apiKeyReadOnly?: boolean;
  userId: string;
  username: string;
  displayName: string;
  /** ADMIN ของ tenant ตัวเอง หรือของผู้ให้บริการ */
  isAdmin: boolean;
  /** เจ้าหน้าที่ผู้ให้บริการโปรแกรม (ADMIN ไม่สังกัด tenant) — เห็นทุก tenant */
  isPlatform: boolean;
  tenantId: string | null;
  companyId: string | null;
  branchId: string | null;
  workDate: string | null;
  /** ระดับอนุมัติ 0–9 (สิทธิ์พื้นฐาน) · ตรวจสอบสิทธิ์ตามตาราง · กลุ่มผู้ใช้ — ใช้ตรวจสิทธิ์รายเมนู (คู่มือบทที่ 23) */
  approvalLevel: number;
  checkRights: boolean;
  groupId: string | null;
  /** โปรแกรมที่ผู้ใช้เปิดได้ (sys_user.app_access) — null = ทุกโปรแกรมของลูกค้า · ไม่มี (กุญแจ API) = ไม่จำกัดตามนี้ */
  apps?: TenantModuleKey[] | null;
  /** HANDOFF 204: เจ้าหน้าที่ผู้ให้บริการที่ session ค้างบริษัทของลูกค้าจริง (ถูกตัดออก) — คำขอข้อมูลบริษัท = 403 พร้อมเหตุผล */
  providerLocked?: boolean;
}
/** ข้อความเมื่อเจ้าหน้าที่ผู้ให้บริการเรียกข้อมูลของลูกค้าที่ไม่ใช่ข้อมูลตัวอย่าง (HANDOFF 204) */
export const PROVIDER_LOCKED = 'เจ้าหน้าที่ผู้ให้บริการเปิดข้อมูลบัญชีของลูกค้าไม่ได้ — ข้อมูลของลูกค้าเป็นความลับ (เปิดได้เฉพาะลูกค้าข้อมูลตัวอย่าง) · ดูภาพรวมลูกค้าที่ ศูนย์ผู้ให้บริการ · ลูกค้าต้องการให้ช่วย: ให้ผู้ดูแลของลูกค้าสร้างผู้ใช้ให้ในกิจการของลูกค้าเอง';

declare module 'fastify' {
  interface FastifyRequest { auth?: AuthContext }
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requireCompany(req: FastifyRequest): AuthContext & { companyId: string } {
  const a = requireAuth(req);
  if (!a.companyId && a.providerLocked) throw new AppError(403, 'PROVIDER_LOCKED', PROVIDER_LOCKED);
  if (!a.companyId) throw new AppError(400, 'NO_COMPANY', 'กรุณาเลือกบริษัทก่อน');
  return a as AuthContext & { companyId: string };
}
