/**
 * HANDOFF 207c: ทุกรหัสเหตุการณ์ที่ server บันทึกลง sys_activity_log ได้ ต้องมีชื่อไทย (packages/core/src/activity-actions.ts)
 * หน้า สิ่งที่เจ้าหน้าที่ทำกับบัญชีลูกค้า / สิ่งที่ผู้ให้บริการทำกับบัญชีของท่าน ไม่แสดงรหัสดิบ (เช่น MOVE_COMPANY BACKUP STARTER_DATA)
 * เพิ่ม logActivity ด้วยรหัสใหม่ = ชุดนี้ล้มจนกว่าจะเพิ่มชื่อไทย
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_LABEL, actionLabel, storedAction } from '@buddy/core';
import { ACCOUNT_ACTIONS, PERSONAL_ACTIONS } from '../src/modules/provider-actions.js';
import type { AlertKind } from '../src/alerts.js';

const SRC = join(__dirname, '../src');
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : []; });
/** รหัสในรูป action: '…' / action = … ? '…' : '…' ทุกไฟล์ใน apps/server/src */
function loggedCodes() {
  const out = new Set<string>();
  for (const f of files(SRC)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\baction\s*[:=]\s*([^,;}\n]*)/g)) for (const c of m[1]!.matchAll(/'([A-Z][A-Z0-9_]+)'/g)) out.add(storedAction(c[1]!));
  }
  // รหัสที่สร้างจากตัวแปร (alerts.ts: ALERT_${kind})
  for (const k of ['LOCKED', 'LOGIN_FAIL', 'BURST'] satisfies AlertKind[]) out.add(`ALERT_${k}`);
  return out;
}

describe('HANDOFF 207c: Thai label for every logged action code', () => {
  it('every code the server can log (incl. historical MOVE_COMPANY, BACKUP, STARTER_DATA, RESTORE) has a Thai label — no raw code shown', () => {
    const codes = loggedCodes();
    expect(codes.size).toBeGreaterThan(120);
    for (const c of ['MOVE_COMPANY', 'BACKUP', 'STARTER_DATA', 'RESTORE', 'TENANT_STANDARD_GROU', 'AI_PLATFORM_KEY_REMO']) expect(codes.has(c), c).toBe(true);
    const missing = [...codes].filter((c) => !ACTION_LABEL[c]);
    expect(missing).toEqual([]);
    for (const c of codes) expect([c, /[฀-๿]/.test(actionLabel(c))]).toEqual([c, true]);
  });
  it('provider/customer action sets are labelled and use the stored (20-char) code; unknown codes fall back to a Thai label', () => {
    for (const c of [...ACCOUNT_ACTIONS, ...PERSONAL_ACTIONS]) expect([c, c.length <= 20, !!ACTION_LABEL[c]]).toEqual([c, true, true]);
    expect(ACCOUNT_ACTIONS).toContain('TENANT_STANDARD_GROU');
    expect(actionLabel('SOMETHING_NEW')).toBe('รายการอื่นของระบบ');
    expect(actionLabel('USE_PRINT')).toMatch(/ใช้งานเมนู/);
    expect(actionLabel('TENANT_STANDARD_GROUPS')).toBe(ACTION_LABEL.TENANT_STANDARD_GROU);
  });
});
