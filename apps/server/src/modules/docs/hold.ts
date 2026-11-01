import { holdDecision, type HoldDecision } from '@buddy/core';
import type { Db } from '../../db.js';
import { badRequest, type AuthContext } from '../../http.js';
import { logActivity } from '../../audit.js';
import { companySettings } from '../../company-template.js';

type Ctx = AuthContext & { companyId: string };

/**
 * ระงับการขาย/ระงับจ่าย (ข้อกำหนดเจ้าของ 01/11/2569) — ตรวจก่อนบันทึก: บล็อก (Message ตามกฎใน core) หรือคืนผลไปเตือน/บันทึกประวัติ
 * ตรวจเฉพาะเอกสารใหม่ หรือแก้ไขแล้วเปลี่ยนคู่ค้า — แก้เอกสารเดิมของรายที่เพิ่งถูกระงับยังทำได้
 */
export async function checkHold(db: Db, a: Ctx, party: 'customer' | 'supplier', cls: string, partyId: string | null | undefined, id: string | null): Promise<HoldDecision | null> {
  if (!partyId) return null;
  const col = party === 'customer' ? 'customer_id' : 'supplier_id';
  if (id) {
    const cur = await db.selectFrom('doc_header').select(col).where('id', '=', id).where('company_id', '=', a.companyId).executeTakeFirst();
    if (cur && cur[col] === partyId) return null;
  }
  const p = await db.selectFrom(party === 'customer' ? 'md_customer' : 'md_supplier').select(['code', 'on_hold', 'on_hold_reason'])
    .where('id', '=', partyId).where('company_id', '=', a.companyId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!p?.on_hold) return null;
  const lvl = (await companySettings(db, a.companyId))[party === 'customer' ? 'ar.hold_level' : 'ap.hold_level'];
  const r = holdDecision(party, cls, { code: p.code, on_hold: p.on_hold, reason: p.on_hold_reason }, { isAdmin: a.isAdmin, level: a.approvalLevel }, lvl === undefined ? 9 : lvl === null || lvl === '' ? null : Number(lvl));
  if (r?.kind === 'block') throw badRequest(r.message, [{ field: 'party_id', message: r.message }]);
  return r;
}

/** หลังได้เลขที่เอกสาร: เตือนผู้ใช้ + บันทึกประวัติเมื่อผู้มีสิทธิ์บันทึกข้ามการระงับ */
export async function noteHold(tx: Db, a: Ctx, hold: HoldDecision | null, module: string, docNo: string, rowId: string, warnings: string[]) {
  if (!hold) return;
  warnings.push(hold.message);
  if (hold.kind === 'override') await logActivity(tx, a, { module, action: 'HOLD_OVERRIDE', docNo, table: 'doc_header', rowId, detail: { message: hold.message } });
}
