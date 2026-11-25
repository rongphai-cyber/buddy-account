import { describe, expect, it } from 'vitest';
import { aiCeilingReached, AI_PAYER_TH, effectiveLimits, limitsForPayer, monthRange, overageLines, quotaBlocked, quotaRows, thisMonthTh, usageLevel, usagePct, worstLevel, type PackageLimits } from './usage.js';

const STD: PackageLimits = { max_companies: 1, max_users: 5, docs_per_month: 2000, file_quota_mb: 5120, ai_per_month: 100 };
const RATES = { over_company_year: '900', over_user_year: '600', over_doc: '0.50', over_file_gb_month: '20', over_ai: '2.00' };
const MB = 1024 * 1024, GB = 1024 * MB;

describe('packages and usage (HANDOFF 185)', () => {
  it('effective limits: tenant override wins, blank = package, no package = unlimited', () => {
    expect(effectiveLimits(STD, {})).toEqual({ companies: 1, users: 5, docs: 2000, file_mb: 5120, ai: 100 });
    expect(effectiveLimits(STD, { max_companies: 3, docs_per_month: null })).toEqual({ companies: 3, users: 5, docs: 2000, file_mb: 5120, ai: 100 });
    expect(effectiveLimits(null, {})).toEqual({ companies: null, users: null, docs: null, file_mb: null, ai: null });
    expect(effectiveLimits(null, { max_users: 4 })).toMatchObject({ users: 4, companies: null });
  });
  it('percent and level: 80% warn, 100% over, unlimited = none', () => {
    expect([usagePct(1599, 2000), usagePct(1600, 2000), usagePct(2000, 2000), usagePct(5, null), usagePct(1, 0)]).toEqual([79, 80, 100, null, 100]);
    expect([usageLevel(79), usageLevel(80), usageLevel(100), usageLevel(null)]).toEqual(['ok', 'warn', 'over', 'none']);
    const rows = quotaRows(effectiveLimits(STD, {}), { companies: 1, users: 2, docs: 1700, file_bytes: 1 * GB, ai: 10 });
    // บริษัท/ผู้ใช้ใช้ครบพอดี = ปกติ (เพดานที่เพิ่มเกินไม่ได้) · เกินจริง = over
    expect(rows.map((r) => `${r.key}:${r.pct}:${r.level}`)).toEqual(['companies:100:ok', 'users:40:ok', 'docs:85:warn', 'files:20:ok', 'ai:10:ok']);
    expect(rows.find((r) => r.key === 'files')).toMatchObject({ used: 1024, limit: 5120 });
    expect(worstLevel(rows)).toBe('warn');
    expect(quotaRows(effectiveLimits(STD, {}), { companies: 2, users: 5, docs: 0, file_bytes: 0, ai: 0 }).slice(0, 2).map((r) => r.level)).toEqual(['over', 'ok']);
    expect(worstLevel(quotaRows(effectiveLimits(STD, {}), { companies: 1, users: 5, docs: 2000, file_bytes: 0, ai: 0 }))).toBe('over');
    expect(worstLevel(quotaRows(effectiveLimits(null, {}), { companies: 9, users: 9, docs: 9, file_bytes: 9, ai: 9 }))).toBe('none');
  });
  it('stop mode: files refused when the new file would pass the quota; AI refused at the limit', () => {
    const l = effectiveLimits({ ...STD, file_quota_mb: 1 }, {});
    expect(quotaBlocked('files', l, { companies: 1, users: 1, docs: 0, file_bytes: MB - 10, ai: 0 }, 10)).toBe(false);
    expect(quotaBlocked('files', l, { companies: 1, users: 1, docs: 0, file_bytes: MB - 10, ai: 0 }, 11)).toBe(true);
    expect(quotaBlocked('ai', l, { companies: 1, users: 1, docs: 0, file_bytes: 0, ai: 99 })).toBe(false);
    expect(quotaBlocked('ai', l, { companies: 1, users: 1, docs: 0, file_bytes: 0, ai: 100 })).toBe(true);
    expect(quotaBlocked('ai', effectiveLimits(null, {}), { companies: 1, users: 1, docs: 0, file_bytes: 0, ai: 1e6 })).toBe(false);
  });
  it('monthly overage: companies/users vs package (rate/year ÷ 12), docs/files/AI vs effective limit, exact money', () => {
    const l = effectiveLimits(STD, { max_companies: 3, max_users: 7 });
    const r = overageLines(STD, l, { companies: 3, users: 7, docs: 2345, file_bytes: 5120 * MB + Math.round(1.5 * GB), ai: 103 }, RATES);
    expect(r.lines.map((x) => [x.key, x.over, x.rate, x.amount])).toEqual([
      ['companies', '2', '900.00', '150.00'],     // 2 × 900 / 12
      ['users', '2', '600.00', '100.00'],         // 2 × 600 / 12
      ['docs', '345', '0.50', '172.50'],
      ['files', '1.5', '20.00', '30.00'],
      ['ai', '3', '2.00', '6.00'],
    ]);
    expect(r.total).toBe('458.50');
    // ไม่เกิน = ไม่มีแถว · ไม่มีแพ็กเกจ = ไม่คิด
    expect(overageLines(STD, effectiveLimits(STD, {}), { companies: 1, users: 5, docs: 2000, file_bytes: 5120 * MB, ai: 100 }, RATES)).toEqual({ lines: [], total: '0.00' });
    expect(overageLines(null, effectiveLimits(null, {}), { companies: 9, users: 9, docs: 9e6, file_bytes: 9e12, ai: 9e6 }, RATES).total).toBe('0.00');
    // ปัดเศษ: 1 ผู้ใช้เกิน × 600 / 12 = 50.00 · ไฟล์เกิน 1 ไบต์ ≈ 0.00 GB = ไม่มีแถว · 7 บริษัท × 950 / 12 = 554.17
    expect(overageLines(STD, effectiveLimits(STD, {}), { companies: 1, users: 6, docs: 0, file_bytes: 5120 * MB + 1, ai: 0 }, RATES).lines.map((x) => x.amount)).toEqual(['50.00']);
    expect(overageLines({ ...STD, max_companies: 1 }, effectiveLimits(STD, {}), { companies: 8, users: 0, docs: 0, file_bytes: 0, ai: 0 }, { ...RATES, over_company_year: '950' }).total).toBe('554.17');
  });
  it('month range in Thai time', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01T00:00:00+07:00', to: '2026-12-01T00:00:00+07:00' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01T00:00:00+07:00', to: '2027-01-01T00:00:00+07:00' });
    expect(thisMonthTh(Date.UTC(2026, 10, 30, 18, 0))).toBe('2026-12');   // 01:00 ของ 1 ธ.ค. เวลาไทย
  });
});

describe('who pays for AI (HANDOFF 190)', () => {
  const L = effectiveLimits(STD, {});
  it('customer pays: AI is not a package quota (no warning, no stop, no overage)', () => {
    const c = limitsForPayer(L, 'C');
    expect(c).toEqual({ ...L, ai: null });
    expect(limitsForPayer(L, null).ai).toBeNull();
    const u = { companies: 1, users: 1, docs: 0, file_bytes: 0, ai: 500 };
    expect(quotaRows(c, u).find((r) => r.key === 'ai')).toMatchObject({ used: 500, limit: null, level: 'none' });
    expect(quotaBlocked('ai', c, u)).toBe(false);
    expect(overageLines(STD, c, u, RATES).lines.some((x) => x.key === 'ai')).toBe(false);
  });
  it('WTS pays: package AI quota and overage apply', () => {
    const p = limitsForPayer(L, 'P');
    const u = { companies: 1, users: 1, docs: 0, file_bytes: 0, ai: 120 };
    expect(p.ai).toBe(100);
    expect(quotaRows(p, u).find((r) => r.key === 'ai')!.level).toBe('over');
    expect(quotaBlocked('ai', p, u)).toBe(true);
    expect(overageLines(STD, p, u, RATES).lines.find((x) => x.key === 'ai')).toMatchObject({ over: '20', amount: '40.00' });
  });
  it('dollar ceiling: reached at or above · blank = unlimited · decimal text', () => {
    expect(aiCeilingReached('19.9999', '20.00')).toBe(false);
    expect(aiCeilingReached('20.0000', '20.00')).toBe(true);
    expect(aiCeilingReached('0.1', '0.10')).toBe(true);
    expect(aiCeilingReached('999', null)).toBe(false);
    expect(aiCeilingReached('999', '')).toBe(false);
    expect(AI_PAYER_TH).toEqual({ C: 'ลูกค้าจ่ายเอง', P: 'WTS จ่ายให้' });
  });
});
