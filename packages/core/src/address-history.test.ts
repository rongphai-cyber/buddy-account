import { describe, expect, it } from 'vitest';
import { addressAt, addressDateTaken, rowInEffect } from './address-history.js';

const R = [
  { id: 'h1', branch_id: null, effective_from: '2024-01-01', address_th: '303 ถนนเดิม' },
  { id: 'h2', branch_id: null, effective_from: '2025-01-01', address_th: '340 ถนนใหม่' },
  { id: 'b1', branch_id: 'BR1', effective_from: '2024-06-01', address_th: 'สาขา 1 ที่เดิม' },
  { id: 'b2', branch_id: 'BR1', effective_from: '2025-07-01', address_th: 'สาขา 1 ที่ใหม่' },
];

describe('company address by effective date (HANDOFF 180)', () => {
  it('picks the row in effect on the document date, the move day uses the new address', () => {
    expect(addressAt(R, '2024-12-31').row?.id).toBe('h1');
    expect(addressAt(R, '2025-01-01').row?.id).toBe('h2');
    expect(addressAt(R, '2026-11-24').row?.id).toBe('h2');
  });
  it('a date before the first row uses the first row', () => {
    expect(addressAt(R, '2020-05-05').row?.id).toBe('h1');
    expect(rowInEffect([], '2025-01-01')).toBeNull();
  });
  it('branch documents use the branch history; a branch without history uses the head office', () => {
    expect(addressAt(R, '2025-06-30', 'BR1')).toMatchObject({ row: { id: 'b1' }, fromBranch: true });
    expect(addressAt(R, '2025-07-01', 'BR1')).toMatchObject({ row: { id: 'b2' }, fromBranch: true });
    expect(addressAt(R, '2024-02-01', 'BR1')).toMatchObject({ row: { id: 'b1' }, fromBranch: true });
    expect(addressAt(R, '2025-03-01', 'BR2')).toMatchObject({ row: { id: 'h2' }, fromBranch: false });
  });
  it('timestamps and unsorted rows are handled', () => {
    expect(addressAt([R[1]!, { ...R[0]!, effective_from: '2024-01-01T00:00:00.000Z' }], '2024-08-01').row?.id).toBe('h1');
  });
  it('one row per owner per effective date', () => {
    expect(addressDateTaken(R, null, '2025-01-01')).toBe(true);
    expect(addressDateTaken(R, null, '2025-01-01', 'h2')).toBe(false);
    expect(addressDateTaken(R, 'BR1', '2025-01-01')).toBe(false);
  });
});
