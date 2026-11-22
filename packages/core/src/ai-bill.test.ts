import { describe, it, expect } from 'vitest';
import { AI_BILL_TARGETS, aiBillSide, BILL_SYSTEM_PROMPT_SALES } from './ai-bill.js';
import { CASH_KINDS, TRADE_KINDS } from './doc-calc.js';
import { AI_MODEL, AI_MODELS, aiBillEstimate, aiCost, aiModelOf, aiRequestOptions, BILL_SCHEMA, normalizeBill, SUGGEST_SCHEMA, suggestPrompt, textSim, whtRateOf, billWhtRow, type RawBill } from './ai-bill.js';

/** Anthropic structured outputs: at most 16 parameters with union types (type arrays or anyOf) per schema */
function unionParams(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  const n = node as Record<string, unknown>;
  let c = Array.isArray(n.type) || Array.isArray(n.anyOf) ? 1 : 0;
  for (const v of Object.values(n)) c += Array.isArray(v) ? v.reduce((t: number, x) => t + unionParams(x), 0) : unionParams(v);
  return c;
}

const raw: RawBill = {
  doc_kind: 'tax_invoice', supplier: { name: 'บริษัท ขายส่ง จำกัด', tax_id: '0-1055-37095-90-3', branch_no: '0', address: '1 ถนนพระราม 4 กรุงเทพฯ 10500' },
  doc_no: 'INV-001', doc_date: '2026-03-15', price_type: 'excl_vat', vat_rate: '7',
  lines: [{ description: 'กระดาษ A4', qty: '10', unit: 'รีม', unit_price: '120', amount: '1,200.00' }, { description: 'ค่าส่ง', qty: null, unit: null, unit_price: null, amount: '100' }],
  subtotal: '1300', discount: null, vat_amount: '91', total: '1391', notes: [],
};

describe('AI อ่านบิล (T7.7)', () => {
  it('cost per million tokens; fallback billed at the dearer model; unknown model priced at the maximum', () => {
    expect(aiCost({ input_tokens: 3000, output_tokens: 800 }, 'claude-opus-5-5').toString()).toBe('0.028');   // 3000×4 + 800×20 = 28,000 / 1M
    expect(aiCost({ input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }, 'claude-opus-5-5').toString()).toBe('9.2');
    expect(aiCost({ output_tokens: 1000 }, 'claude-opus-5-5', 'claude-opus-5').toString()).toBe('0.025');
    expect(aiCost({ output_tokens: 1000 }, 'claude-someday-9').toString()).toBe('0.05');
  });

  it('HANDOFF 166: both schemas stay under the 16 union-typed parameter limit (was 18 -> 400 on the cloud)', () => {
    expect(unionParams({ a: { anyOf: [{ type: 'string' }, { type: 'null' }] }, b: { type: ['string', 'null'] }, c: { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'null' }] } } })).toBe(3);
    expect(unionParams(BILL_SCHEMA)).toBeLessThanOrEqual(16);
    expect(unionParams(SUGGEST_SCHEMA)).toBeLessThanOrEqual(16);
    expect(unionParams(BILL_SCHEMA) + unionParams(SUGGEST_SCHEMA)).toBe(0);   // "" = not present / unreadable
  });
  it('HANDOFF 166: "" and null mean the same (not present) in every field', () => {
    const blank = (v: '' | null) => normalizeBill({ doc_kind: 'tax_invoice', supplier: { name: 'ร้าน ก', tax_id: v, branch_no: v, address: v, phone: v }, buyer: { name: v, tax_id: v },
      doc_no: v, doc_date: v, price_type: 'excl_vat', vat_rate: v,
      lines: [{ description: 'ของ', qty: v, unit: v, unit_price: '50', amount: '100' }], subtotal: v, discount: v, vat_amount: v, total: '107', notes: [] });
    const a = blank(''), b = blank(null);
    expect(a).toEqual(b);
    expect(a.supplier).toEqual({ name: 'ร้าน ก', tax_id: null, tax_id_read: '', phone: null, branch_no: null, address: '' });
    expect([a.doc_no, a.doc_date, a.vat_rate, a.buyer, a.lines[0]!.unit, a.lines[0]!.qty]).toEqual(['', null, '7', { name: '', tax_id_read: '' }, null, '2']);
    expect(a.warnings.some((x) => /13 หลัก|อ่านไม่ได้/.test(x))).toBe(false);   // empty is not "unreadable"
    expect(normalizeBill({ ...raw, doc_no: 'null', discount: '-' }).doc_no).toBe('');
  });
  it('HANDOFF 166: model choice — Haiku 5.5 default, no fallback for Haiku, price per model', () => {
    expect(AI_MODEL).toBe('claude-haiku-5-5');
    expect(AI_MODELS.map((m) => m.id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
    expect([aiModelOf(undefined), aiModelOf(null), aiModelOf('claude-opus-4-1'), aiModelOf('claude-sonnet-5-5')]).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5', 'claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(aiRequestOptions('claude-haiku-5-5')).toEqual({ model: 'claude-haiku-5-5' });
    for (const m of ['claude-sonnet-5-5', 'claude-opus-5-5'] as const) expect(aiRequestOptions(m)).toEqual({ model: m, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    const u = { input_tokens: 3000, output_tokens: 800 };
    expect([aiCost(u, 'claude-haiku-5-5'), aiCost(u, 'claude-sonnet-5-5'), aiCost(u, 'claude-opus-5-5')].map(String)).toEqual(['0.0007', '0.014', '0.028']);
    // Haiku: prompts over 100K tokens use the long-context rate ($0.50 / $2.50) for the whole request
    expect(aiCost({ input_tokens: 100_000, output_tokens: 1000 }, 'claude-haiku-5-5').toString()).toBe('0.0105');
    expect(aiCost({ input_tokens: 100_001, output_tokens: 1000 }, 'claude-haiku-5-5').toString()).toBe('0.0525');
    expect(aiCost({ input_tokens: 60_000, cache_read_input_tokens: 50_000 }, 'claude-haiku-5-5').toString()).toBe('0.0325');
    expect(aiCost({ cache_read_input_tokens: 1_000_000 }, 'claude-sonnet-5-5').toString()).toBe('0.1');
    expect([aiBillEstimate('claude-haiku-5-5'), aiBillEstimate('claude-sonnet-5-5'), aiBillEstimate('claude-opus-5-5')].map(String)).toEqual(['0.0016', '0.031', '0.062']);
  });
  it('normalizes Thai bill output: tax id digits, branch 00000, amounts without commas, derived qty/price, consistent totals', () => {
    const b = normalizeBill(raw);
    expect(b.supplier).toMatchObject({ tax_id: '0105537095903', branch_no: '00000' });
    expect([b.price_type, b.vat_rate, b.total]).toEqual(['2', '7', '1391.00']);
    expect(b.lines).toEqual([
      { description: 'กระดาษ A4', qty: '10', unit: 'รีม', unit_price: '120', amount: '1200.00' },
      { description: 'ค่าส่ง', qty: '1', unit: null, unit_price: '100', amount: '100.00' },
    ]);
    expect(b.warnings).toEqual([]);
  });

  it('flags what the user must check: mismatched total, wrong VAT, Buddhist-year date, abbreviated invoice, unreadable values', () => {
    const b = normalizeBill({ ...raw, doc_kind: 'abbreviated_tax_invoice', doc_date: '2569-03-15', total: '1500', vat_amount: '50', notes: ['ตัวเลขบรรทัด 2 เลือน'],
      lines: [...raw.lines, { description: 'ไม่มีราคา', qty: '1', unit: null, unit_price: null, amount: null }] });
    const all = b.warnings.join('\n');
    for (const re of [/AI: ตัวเลขบรรทัด 2 เลือน/, /อย่างย่อ/, /ปี พ\.ศ\./, /บรรทัดที่ 3: อ่านราคาไม่ได้/, /ไม่สอดคล้องกับยอดรวมทั้งสิ้น 1500\.00/, /VAT 50\.00 ไม่เท่ากับ 7%/]) expect(all).toMatch(re);
    expect(normalizeBill({ ...raw, price_type: 'incl_vat', subtotal: '1391', vat_amount: '91', total: '1300' }).price_type).toBe('1');
  });
  it('HANDOFF 167: withholding tax on the bill (RE260219025) — no false total warning, WHT base = subtotal, rate 3%', () => {
    const re = { ...raw, lines: [{ description: 'ค่าบริการขนส่งและติดตั้ง', qty: '1', unit: null, unit_price: '58244.93', amount: '58,244.93' }],
      subtotal: '58,244.93', vat_amount: '4,077.15', wht_amount: '1,747.35' };
    // grand total printed after WHT (58,244.93 + 4,077.15 − 1,747.35)
    const after = normalizeBill({ ...re, total: '60,574.73' });
    expect(after.warnings).toEqual([]);
    expect(after.wht).toEqual({ amount: '1747.35', base: '58244.93', rate: '3' });
    expect(after.total).toBe('60574.73');
    // draft row for the WHT tab: juristic supplier (0-…) = ภ.ง.ด.53 · 3% = ค่าบริการ · base = subtotal
    expect(billWhtRow(after)).toEqual({ form_type: 'S53', income_type: 'ค่าบริการ', rate: '3', paid_amount: '58244.93', tax_amount: '1747.35' });
    expect(billWhtRow({ supplier: { ...after.supplier, tax_id: '3100600445566' }, wht: { amount: '50', base: '1000', rate: '5' } })).toMatchObject({ form_type: 'S03', income_type: 'ค่าเช่า' });
    expect(billWhtRow({ ...after, wht: null })).toBeNull();
    // grand total printed before WHT is also consistent
    expect(normalizeBill({ ...re, total: '62322.08' }).warnings).toEqual([]);
    // still a warning when neither matches; no WHT on the bill → no WHT draft and the old check
    expect(normalizeBill({ ...re, total: '60000' }).warnings.join()).toMatch(/ไม่สอดคล้องกับยอดรวมทั้งสิ้น 60000\.00.*ภาษีหัก ณ ที่จ่าย/);
    const none = normalizeBill({ ...re, wht_amount: '', total: '60,574.73' });
    expect(none.wht).toBeNull();
    expect(none.warnings.join()).toMatch(/ไม่สอดคล้อง/);
    expect(normalizeBill({ ...re, wht_amount: null, total: '62322.08' }).wht).toBeNull();
    // non-standard rate: amount kept, rate left for the user + warning
    const odd = normalizeBill({ ...re, wht_amount: '2000', total: '60322.08' });
    expect(odd.wht).toEqual({ amount: '2000.00', base: '58244.93', rate: null });
    expect(odd.warnings.join()).toMatch(/3\.43% .*ไม่ตรงอัตรามาตรฐาน/);
    // no subtotal printed: base = lines − discount (− VAT when prices include VAT)
    expect(normalizeBill({ ...re, subtotal: '', wht_amount: '582.45', total: '61739.63' }).wht).toEqual({ amount: '582.45', base: '58244.93', rate: '1' });
    expect(normalizeBill({ ...re, price_type: 'incl_vat', subtotal: '', lines: [{ description: 'ค่าเช่า', qty: '1', unit: null, unit_price: '10700', amount: '10700' }], vat_amount: '700', wht_amount: '500', total: '10200' }).wht)
      .toEqual({ amount: '500.00', base: '10000.00', rate: '5' });
    expect([whtRateOf('30.04', '1000').rate, whtRateOf('30.6', '1000').rate, whtRateOf('5', '0').rate]).toEqual(['3', null, null]);
  });
  it('Thai text similarity (no word spaces) and suggestion prompt carries only this company data', () => {
    expect(textSim('ค่าน้ำมันรถ', 'ค่าน้ำมันรถ')).toBe(1);
    expect(textSim('น้ำมันดีเซล 50 ลิตร', 'น้ำมันดีเซล')).toBeGreaterThan(0.7);
    expect(textSim('กระดาษ A4 80 แกรม', 'ค่าไฟฟ้า')).toBeLessThan(0.2);
    expect(textSim('', 'x')).toBe(0);
    const p = suggestPrompt({ businessType: 'trading', guidance: 'ค่าน้ำมันรถส่งของ ลงรหัส 95-5300-01', target: 'expense', supplierName: 'ปั๊ม ก', supplierKnown: true,
      lines: [{ index: 0, description: 'ดีเซล', amount: '500.00', candidates: [{ code: '95-5300-01', name: 'ค่าน้ำมัน', kind: 'expense', history: 4, sameSupplier: 3 }] }],
      expenseCodes: [{ code: '95-5300-01', name: 'ค่าน้ำมัน', kind: 'expense', account: '5300-01 ค่าน้ำมัน' }] });
    expect(p).toContain('ซื้อมาขายไป');
    expect(p).toContain('ลงรหัส 95-5300-01');
    expect(p).toContain('ใช้ได้เฉพาะรหัสค่าใช้จ่าย');
    expect(p).toContain('"history":4');
  });

  it('HANDOFF 171: AI bill on every document entry screen — sales side reads the customer from the buyer on the paper', () => {
    // ทุกเอกสารขาย/ซื้อ/ใบสั่ง และเอกสารรับ/จ่ายเงิน (มัดจำ รายได้อื่น ค่าใช้จ่ายอื่น)
    expect(AI_BILL_TARGETS.map((t) => t.cls).sort()).toEqual([...TRADE_KINDS.map((k) => k.cls), ...CASH_KINDS.map((k) => k.cls)].sort());
    const t = (cls: string) => AI_BILL_TARGETS.find((x) => x.cls === cls)!;
    expect(['IV', 'HS', 'DR', 'CN', 'QT', 'SO', 'AI', 'OI'].map((c) => aiBillSide(t(c)))).toEqual(Array(8).fill('sale'));
    expect(['RR', 'HP', 'CP', 'DN', 'PO', 'AE', 'OE'].map((c) => aiBillSide(t(c)))).toEqual(Array(7).fill('purchase'));
    expect([t('OE').lines, t('OI').lines, t('AI').lines, t('AE').lines, t('SO').lines]).toEqual(['expense', 'income', 'text', 'text', 'item']);
    expect(AI_BILL_TARGETS.filter((x) => x.service).map((x) => x.cls)).toEqual(['OE']);
    expect(BILL_SYSTEM_PROMPT_SALES).toContain('buyer คือลูกค้า');
    expect(BILL_SCHEMA.properties.buyer.required).toContain('branch_no');
    // ใบสั่งซื้อของลูกค้า: ลูกค้า = ผู้ซื้อ (เลข 13 หลัก + สาขา) · ผู้ขาย = บริษัทเรา · ไม่เตือนเรื่องภาษีซื้อ
    const po: RawBill = { ...raw, doc_kind: 'abbreviated_tax_invoice', supplier: { name: 'บริษัทเรา', tax_id: '', branch_no: '', address: '' }, buyer: { name: 'ห้างลูกค้า', tax_id: '0-1055-37095-90-3', branch_no: '3' }, doc_no: 'PO-77' };
    const b = normalizeBill(po, 'sale');
    expect(b.buyer).toEqual({ name: 'ห้างลูกค้า', tax_id_read: '0105537095903', branch_no: '00003' });
    expect(b.warnings.some((w) => /ภาษีซื้อ|ผู้ขาย/.test(w))).toBe(false);
    expect(normalizeBill({ ...po, buyer: { name: 'x', tax_id: '12345', branch_no: '' } }, 'sale').warnings).toContain('เลขผู้เสียภาษีลูกค้า "12345" ไม่ครบ 13 หลัก');
    expect(normalizeBill(po).warnings.some((w) => /ภาษีซื้อ/.test(w))).toBe(true);   // ฝั่งซื้อยังเตือนเหมือนเดิม
    // คำขอแนะนำรหัสฝั่งขาย/รายได้อื่น: บอกชนิดรหัสที่เลือกได้ และคู่ค้าเป็นลูกค้า
    const lines = [{ index: 0, description: 'กระดาษ', amount: '100', candidates: [] }];
    const sp = suggestPrompt({ target: 'sale', supplierName: 'ห้างลูกค้า', supplierKnown: true, lines, expenseCodes: [] });
    expect(sp).toContain('เลือกได้เฉพาะรหัสสินค้า/บริการที่ขาย');
    expect(sp).toContain('ลูกค้า: ห้างลูกค้า (มีในแฟ้มลูกค้า)');
    expect(suggestPrompt({ target: 'income', supplierName: '', supplierKnown: false, lines, expenseCodes: [] })).toContain('ใช้ได้เฉพาะรหัสรายได้อื่น');
  });
});
