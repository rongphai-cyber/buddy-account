import { describe, expect, it } from 'vitest';
import { partyNeedsMaster, partyView } from './party-view.js';

const OCIO = { address_1: '30, 36-38 Kampang Din Road, Sori 1, Chang Moi', address_2: 'Muang Chaing mai Thailand', zip_code: '50300', tax_id: '0505566016991', tax_branch_no: '00000',
  branches: [{ branch_no: '00001', name: 'สาขานิมมาน', address_1: '1 นิมมานเหมินท์', zip_code: '50200' }] };

describe('party address under the code (HANDOFF 179)', () => {
  it('Express-migrated document with an empty snapshot shows the master address, tax id and branch', () => {
    const snap = { party_address: null, party_tax_id: null, party_tax_branch_no: null };
    expect(partyNeedsMaster(snap)).toBe(true);
    expect(partyView(snap, OCIO, '00000')).toEqual({ address: '30, 36-38 Kampang Din Road, Sori 1, Chang Moi Muang Chaing mai Thailand 50300', taxId: '0505566016991', branch: '00000', branchName: '' });
  });
  it('saved values are never replaced by the master', () => {
    const snap = { party_address: 'ที่อยู่ตอนออกเอกสาร', party_tax_id: '0105551111111', party_tax_branch_no: '00002' };
    expect(partyNeedsMaster(snap)).toBe(false);
    expect(partyView(snap, OCIO, '00000')).toEqual({ address: 'ที่อยู่ตอนออกเอกสาร', taxId: '0105551111111', branch: '00002', branchName: '' });
  });
  it('only the empty field is filled (address saved, tax id empty)', () => {
    const snap = { party_address: 'ที่อยู่เดิม', party_tax_id: '', party_tax_branch_no: '00000' };
    expect(partyNeedsMaster(snap)).toBe(true);
    expect(partyView(snap, OCIO, '00000')).toMatchObject({ address: 'ที่อยู่เดิม', taxId: '0505566016991', branch: '00000' });
  });
  it('new selection (no snapshot) and a Bill-to branch use the master / branch address', () => {
    expect(partyNeedsMaster(null)).toBe(true);
    expect(partyView(null, OCIO, '00001')).toEqual({ address: '1 นิมมานเหมินท์ 50200', taxId: '0505566016991', branch: '00001', branchName: 'สาขานิมมาน' });
    expect(partyView(null, null, null)).toEqual({ address: '', taxId: '', branch: '', branchName: '' });
  });
});
