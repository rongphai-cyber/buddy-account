import type { FastifyInstance } from 'fastify';
import type { ZodTypeAny } from 'zod';
import type { MasterKind } from '@buddy/core';
import type { AuthContext } from '../http.js';

/**
 * ฟังก์ชันบันทึกข้อมูลหลักของหน้าจอ (ลูกค้า ผู้จำหน่าย สินค้า บริการ ทรัพย์สิน) ให้การนำเข้า Excel ใช้ตัวเดียวกัน (HANDOFF 173)
 * — ตรวจข้อมูล ห้ามซ้ำ และบันทึก sys_activity_log เหมือนกดบันทึกที่หน้าจอ · ผูกกับ app แต่ละตัว (ชุดทดสอบสร้างหลาย app ได้)
 */
type Ctx = AuthContext & { companyId: string };
export interface MasterSaver { body: ZodTypeAny; save: (a: Ctx, id: string | null, b: never) => Promise<{ id?: string | null; warnings?: string[] }> }
const REG = new WeakMap<FastifyInstance, Partial<Record<MasterKind, MasterSaver>>>();
export function registerMasterSaver(app: FastifyInstance, kind: MasterKind, s: MasterSaver) {
  const r = REG.get(app) ?? {};
  r[kind] = s;
  REG.set(app, r);
}
export const masterSaverOf = (app: FastifyInstance, kind: MasterKind) => REG.get(app)?.[kind];
