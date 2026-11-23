/**
 * ที่อยู่/เลขผู้เสียภาษี/สาขา ของคู่ค้าใต้ช่องรหัสในหน้าเอกสาร (HANDOFF 179 — ต่อจาก 177)
 * เอกสารที่บันทึกแล้วใช้ค่าที่เก็บในเอกสาร (snapshot) · ช่องที่ว่างในเอกสาร (เอกสารที่ย้ายจาก Express ไม่มีชื่อ/ที่อยู่/เลขผู้เสียภาษี)
 * ใช้ค่าจากแฟ้มคู่ค้า — เติมเฉพาะที่ว่าง ไม่แทนค่าที่เอกสารเก็บไว้ (กฎเดียวกับหน้ารายการ/แฟ้มภาษี และการพิมพ์)
 */
export interface PartyAddr { address_1?: string | null; address_2?: string | null; address_3?: string | null; zip_code?: string | null }
export interface PartyMasterView extends PartyAddr { tax_id?: string | null; tax_branch_no?: string | null; branches?: Array<PartyAddr & { branch_no: string; name: string }> }
export interface PartySnapshot { party_address?: string | null; party_tax_id?: string | null; party_tax_branch_no?: string | null }

export const joinPartyAddr = (a: PartyAddr | null | undefined) => (a ? [a.address_1, a.address_2, a.address_3, a.zip_code].map((x) => (x ?? '').trim()).filter(Boolean).join(' ') : '');
const blank = (v: string | null | undefined) => !v || !v.trim();

/** ต้องอ่านแฟ้มคู่ค้าหรือไม่: ไม่มี snapshot (เลือกคู่ค้าใหม่) หรือ snapshot ขาดที่อยู่/เลขผู้เสียภาษี */
export function partyNeedsMaster(snap: PartySnapshot | null | undefined): boolean {
  return !snap || blank(snap.party_address) || blank(snap.party_tax_id);
}

/**
 * ค่าที่แสดง: snapshot ก่อน แล้วแฟ้มคู่ค้า · Bill to เป็นสาขาอื่น (branchNo ไม่ใช่สาขาหลักของแฟ้ม) = ที่อยู่ของสาขานั้น (เมื่อ snapshot ไม่มีที่อยู่)
 * branchName = ชื่อสาขาเมื่อใช้ที่อยู่ของสาขา
 */
export function partyView(snap: PartySnapshot | null | undefined, m: PartyMasterView | null | undefined, branchNo?: string | null): { address: string; taxId: string; branch: string; branchName: string } {
  const masterBr = m?.tax_branch_no || '00000';
  const br = blank(snap?.party_address) && m && branchNo && branchNo !== masterBr ? m.branches?.find((b) => b.branch_no === branchNo) : undefined;
  const address = !blank(snap?.party_address) ? snap!.party_address!.trim() : br ? joinPartyAddr(br) : joinPartyAddr(m);
  const taxId = (!blank(snap?.party_tax_id) ? snap!.party_tax_id! : m?.tax_id ?? '').trim();
  const branch = (!blank(snap?.party_tax_branch_no) ? snap!.party_tax_branch_no! : br ? br.branch_no : branchNo || m?.tax_branch_no || '').trim();
  return { address, taxId, branch, branchName: br?.name ?? '' };
}
