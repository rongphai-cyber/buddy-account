import { describe, it, expect } from 'vitest';
import { bahtText } from './baht.js';
import { wht50Layout, wht50FormOf, wht50Date, type Wht50Data } from './forms/wht50.js';

describe('bahtText (จำนวนเงินตัวอักษร)', () => {
  it('reads like BAHTTEXT', () => {
    expect(bahtText('100000')).toBe('หนึ่งแสนบาทถ้วน');
    expect(bahtText('0')).toBe('ศูนย์บาทถ้วน');
    expect(bahtText('1')).toBe('หนึ่งบาทถ้วน');
    expect(bahtText('11')).toBe('สิบเอ็ดบาทถ้วน');
    expect(bahtText('21.01')).toBe('ยี่สิบเอ็ดบาทหนึ่งสตางค์');
    expect(bahtText('101')).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
    expect(bahtText('0.5')).toBe('ห้าสิบสตางค์');
    expect(bahtText('1000001')).toBe('หนึ่งล้านเอ็ดบาทถ้วน');
    expect(bahtText('21000000')).toBe('ยี่สิบเอ็ดล้านบาทถ้วน');
    expect(bahtText('1234567.89')).toBe('หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์');
    expect(bahtText('-3.25')).toBe('ลบสามบาทยี่สิบห้าสตางค์');
    expect(bahtText('1000000000000')).toBe('หนึ่งล้านล้านบาทถ้วน');
  });
});

describe('50 ทวิ layout', () => {
  // ตัวอย่างจากไฟล์ต้นฉบับ docs/50ทวิ.pdf
  const data: Wht50Data = {
    payer: { name: 'บริษัท ทีเอสซี เชียงใหม่ จำกัด', address: '9/1 ซอย 3 ถนนอารักษ์ ตำบลศรีภูมิ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่', tax_id: '0505566004992' },
    payee: { name: 'นายคนึง โยธาใหญ่', address: '9/1 ซอย 3 ถนนอารักษ์', tax_id: '3-5099-00750-79-9' },
    form: '3', condition: '1', issue_date: '2023-03-15',
    lines: [{ row: '5', date: '2023-03-15', amount: '1500000', tax: '75000' }, { row: '5', date: '2023-03-10', amount: '500000', tax: '25000' }],
  };
  const r = wht50Layout(data);
  const get = (k: string) => r.items.find((i) => i.key === k);
  it('totals, words and Buddhist dates', () => {
    expect(r.total_amount).toBe('2000000.00');
    expect(r.total_tax).toBe('100000.00');
    expect(r.total_words).toBe('หนึ่งแสนบาทถ้วน');
    expect(get('date.5')?.text).toBe('15/03/2566');
    expect(get('pay.5.baht')?.text).toBe('2,000,000');
    expect(get('pay.5.satang')?.text).toBe('00');
    expect(get('tax.total.baht')?.text).toBe('100,000');
    expect(get('issue_m')?.text).toBe('มีนาคม');
    expect(get('issue_y')?.text).toBe('2566');
    expect(wht50Date('2026-10-29')).toBe('29/10/2569');
  });
  it('puts tax-id digits into the 13 boxes (1-4-5-2-1) and ticks the right boxes', () => {
    const digits = r.items.filter((i) => i.key.startsWith('payee_id.')).map((i) => i.text).join('');
    expect(digits).toBe('3509900750799');
    const d0 = get('payee_id.0')!, d1 = get('payee_id.1')!;
    expect(d1.x - d0.x).toBeCloseTo(((557.6 - 375.3) / 17) * 2, 1);   // ข้ามช่องขีดคั่นกลุ่ม
    expect(get('form')).toMatchObject({ text: '✓', x: 471.3 });          // (4) ภ.ง.ด.3
    expect(get('condition')).toMatchObject({ x: 82.5 });                  // (1) หัก ณ ที่จ่าย
    expect(get('payer_name')?.text).toBe('บริษัท ทีเอสซี เชียงใหม่ จำกัด');
    expect(wht50Layout({ ...data, payer: { ...data.payer, branch_no: '00000' } }).items.find((i) => i.key === 'payer_name')?.text).toMatch(/\(สำนักงานใหญ่\)$/);
    expect(r.items.every((i) => i.x >= 0 && i.y >= 0 && i.x + i.w <= 595 && i.y + i.h <= 842)).toBe(true);
  });
  it('chooses PND form from supplier code or tax id', () => {
    expect(wht50FormOf('S53')).toBe('53');
    expect(wht50FormOf('S03')).toBe('3');
    expect(wht50FormOf(null, '3509900750799')).toBe('3');
    expect(wht50FormOf(null, '0505566004992')).toBe('53');
  });
});

import { fitsMask, applyMaskCase, allocateKit, itemKindOf, newCode } from './items.js';
describe('items (บทที่ 7)', () => {
  it('HANDOFF 170 H: new codes for imported items/services under a code mask — continue the kind\'s codes, else build one from the mask', () => {
    const M = '99-!!!!-!!!!!!';
    // services: no service code fits the mask (DEMO has codes like *** or SV001) → built from the mask, skipping taken ones
    const taken = new Set(['99-SERV-000001']);
    expect(newCode(M, ['***', 'SV001'], taken, 'SV001', 'SERV')).toBe('99-SERV-000002');
    expect(newCode(M, [], taken, 'SV001', 'SERV')).toBe('99-SERV-000003');   // taken grows with each code issued
    expect(fitsMask(M, '99-SERV-000003').ok).toBe(true);
    // services with codes that fit: continue them
    expect(newCode(M, ['30-SERV-000007', '30-SERV-000009', 'X'], new Set(['30-SERV-000009']), 'SV001', 'SERV')).toBe('30-SERV-000010');
    // stock items: continue the latest series (book lands in the paper series — known limitation, user can type a code)
    expect(newCode(M, ['11-PAPR-A480', '11-PAPR-A479'], new Set(['11-PAPR-A480']), 'P0001', 'ITEM')).toBe('11-PAPR-A481');
    // the series cannot grow inside the mask (999999 → 1000000 too long) → built from the mask
    expect(newCode(M, ['12-BOOK-999999'], new Set(['12-BOOK-999999']), 'P0001', 'ITEM')).toBe('99-ITEM-000001');
    // other masks: digits only · lower-case x · short groups
    expect(newCode('9999', [], new Set(), 'P0001')).toBe('0001');
    expect(newCode('x-99', [], new Set(), 'P0001', 'SERV')).toBe('S-01');
    // no mask = previous behaviour (continue codes, fallback when none)
    expect(newCode(null, [], new Set(), 'C001')).toBe('C001');
    expect(newCode(null, ['C001', 'C025'], new Set(['C001', 'C025']), 'C001')).toBe('C026');
    // a mask that cannot give a unique code
    expect(newCode('A-B', [], new Set(), 'P0001')).toBeNull();
    expect(newCode('9', [], new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']), 'P0001')).toBeNull();
  });
  it('checks item code mask like Express', () => {
    expect(fitsMask('99-!!!!-!!!!!!', '01-INTL-CL-600').ok).toBe(true);
    expect(fitsMask('99-!!!!-!!!!!!', '01-INTL').ok).toBe(true);          // สั้นกว่ารูปแบบได้
    expect(fitsMask('99-!!!!-!!!!!!', 'A1-INTL').error).toMatch(/ตัวที่ 1/);
    expect(fitsMask('99-!!!!-!!!!!!', '01/INTL').error).toMatch(/ต้องเป็น "-"/);
    expect(fitsMask('99-!!!!', '01-INTL-X').error).toMatch(/ยาวเกิน/);
    expect(fitsMask('!!!!!!!!!!!!!!!!!!!!', 'MELEG-XC06').ok).toBe(true);
    expect(applyMaskCase('99-!!!!', '01-intl')).toBe('01-INTL');
  });
  it('allocates a regular kit by price × qty (คู่มือหน้า 108: 100 → 12.5 / 50 / 37.5)', () => {
    const r = allocateKit(100, [{ qty: 1, price: 10 }, { qty: 2, price: 20 }, { qty: 1, price: 30 }]);
    expect(r.map((x) => x.toFixed(2))).toEqual(['12.50', '50.00', '37.50']);
    const z = allocateKit(100, [{ qty: 1, price: 0, fallback: 10 }, { qty: 1, price: 0, fallback: 20 }]);   // ราคาเป็น 0 ใช้ราคาสำรอง
    expect(z.map((x) => x.toFixed(2))).toEqual(['33.33', '66.67']);
    expect(allocateKit(10, [{ qty: 1, price: 1 }, { qty: 1, price: 1 }, { qty: 1, price: 1 }]).reduce((s, x) => s.plus(x)).toFixed(2)).toBe('10.00');
    expect(itemKindOf('2')).toBe('kit'); expect(itemKindOf('3')).toBe('service');
  });
});

import { checkDocNumbering, formatDocNo, GL_ROLES, slotLabel } from './gl-link.js';
describe('document numbering & GL link (บทที่ 9–10)', () => {
  it('formats and validates Express-style document numbers', () => {
    expect(formatDocNo('IV', 101)).toBe('IV0000101');
    expect(checkDocNumbering('IV', '0000101')).toBeNull();
    expect(checkDocNumbering('IV', 12345678)).toMatch(/7 หลัก/);
    expect(checkDocNumbering('IV/', 1)).toMatch(/คั่น/);
    expect(checkDocNumbering('IV', 0)).toMatch(/ตั้งแต่ 1/);
  });
  it('has all default posting roles (Express 34 + VAT/RL extras + FX + platform PP36/WHT) and slot labels', () => {
    expect(new Set(GL_ROLES.map((r) => r.role)).size).toBe(56);   // + เงินเดือน 15 + บัญชีพักยอดยกมา (HANDOFF ข้อ 86)
    expect(slotLabel('RR', 3)).toBe('Cr. เจ้าหนี้');
    expect(slotLabel('IV', 4)).toBe('ช่องที่ 4');
  });
});

import { renderJournalDesc } from './gl-link.js';
describe('journal description template', () => {
  it('renders party/bank fields and collapses blanks', () => {
    expect(renderJournalDesc('ขายเชื่อให้ {party.title} {party.name}', { party: { title: 'บริษัท', name: 'ลูกค้า จำกัด' } })).toBe('ขายเชื่อให้ บริษัท ลูกค้า จำกัด');
    expect(renderJournalDesc('ขายเชื่อให้ {party.title} {party.name}', { party: { title: null, name: 'นายเอ' } })).toBe('ขายเชื่อให้ นายเอ');
    expect(renderJournalDesc('ถอนเงินจากบัญชี {bank.short_name} {doc.remark}', { bank: { short_name: 'BBL-CA' } })).toBe('ถอนเงินจากบัญชี BBL-CA');
    expect(renderJournalDesc(null, {})).toBe('');
  });
});
