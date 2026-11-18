import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

type Party = { id: string; code?: string };
type Snapshot = { party_id?: string | null; party_address?: string | null; party_tax_id?: string | null; party_tax_branch_no?: string | null } | null | undefined;
type Addr = { address_1?: string | null; address_2?: string | null; address_3?: string | null; zip_code?: string | null };
export type PartyBranch = Addr & { branch_no: string; name: string; phone?: string | null; contact?: string | null };
export type PartyShipTo = Addr & { id: string; code: string; branch_no?: string | null };
export type PartyDetail = Addr & { tax_id?: string | null; tax_branch_no?: string | null; tax_branches?: string[]; branches?: PartyBranch[]; ship_tos?: PartyShipTo[] };

const branchText = (b: string | null | undefined) => (!b ? '' : b === '00000' ? 'สำนักงานใหญ่' : `สาขา ${b}`);
const addrOf = (a: Addr | undefined) => (a ? [a.address_1, a.address_2, a.address_3, a.zip_code].filter(Boolean).join(' ') : '');

/** รายละเอียดคู่ค้า (ที่อยู่ สาขา สถานที่ส่งของ) — API กรองบริษัทจาก session · หน้าเอกสารและช่องที่อยู่ใช้ข้อมูลชุดเดียวกัน (โหลดครั้งเดียว) */
export function usePartyDetail(kind: 'customer' | 'supplier', id: string | null | undefined) {
  return useQuery({ queryKey: ['party-branches', kind, id], enabled: !!id, staleTime: 60_000,
    queryFn: () => api.get<PartyDetail>(`/api/v1/${kind === 'customer' ? 'customers' : 'suppliers'}/${id}`) });
}

/**
 * ที่อยู่ของลูกค้า/ผู้จำหน่ายใต้ช่องรหัส (เจ้าของ 18/11/2569 "กรณีมีรหัสลูกค้า เจ้าหนี้ ต้องแสดงที่อยู่ด้านล่างด้วย จะได้ทราบว่ารายละเอียดถูกต้อง")
 * เอกสารที่บันทึกแล้ว (คู่ค้าและสาขาเดิม) = ที่อยู่ที่พิมพ์ในเอกสาร (snapshot) · เลือกใหม่ = แฟ้มคู่ค้า · Bill to เป็นสาขาอื่น = ที่อยู่ของสาขานั้น
 * แสดง 2 บรรทัด ยาวเกินตัดท้าย ชี้เมาส์ดูเต็ม
 */
export function PartyAddress({ kind, party, saved, branchNo }: { kind: 'customer' | 'supplier'; party: Party | null | undefined; saved?: Snapshot; branchNo?: string | null }) {
  const useSaved = !!party && !!saved && saved.party_id === party.id && (!branchNo || !saved.party_tax_branch_no || branchNo === saved.party_tax_branch_no);
  const q = usePartyDetail(kind, !useSaved ? party?.id : null);
  if (!party?.id) return null;
  const m = q.data;
  const master = m?.tax_branch_no || '00000';
  const br = !useSaved && m && branchNo && branchNo !== master ? m.branches?.find((b) => b.branch_no === branchNo) : undefined;
  const address = useSaved ? saved!.party_address ?? '' : br ? addrOf(br) : addrOf(m);
  const taxId = useSaved ? saved!.party_tax_id : m?.tax_id;
  const branch = useSaved ? saved!.party_tax_branch_no : br ? br.branch_no : branchNo || m?.tax_branch_no;
  if (!useSaved && !m) return <div className="party-addr muted">{q.isError ? 'อ่านที่อยู่ไม่ได้' : 'กำลังอ่านที่อยู่…'}</div>;
  const full = [br ? br.name : '', address || 'ไม่มีที่อยู่ในแฟ้ม', taxId ? `เลขผู้เสียภาษี ${taxId}` : '', branchText(branch)].filter(Boolean).join(' · ');
  return (
    <div className="party-addr" title={full} aria-label="ที่อยู่คู่ค้า">
      {br && <><b data-no-i18n>{br.name}</b> · </>}
      {address ? <span data-no-i18n>{address}</span> : <span className="warn-text">ไม่มีที่อยู่ในแฟ้ม — ตรวจที่แฟ้ม{kind === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}</span>}
      {taxId && <> · เลขผู้เสียภาษี <b data-no-i18n>{taxId}</b></>}{branch && <> · {branchText(branch)}</>}
    </div>
  );
}

/** ที่อยู่ที่เก็บในเอกสารที่บันทึกแล้ว (snapshot) — ใบที่ออกในนามลูกค้าอื่น (Bill to แบบเดิม) ใช้แฟ้มคู่ค้าแทน */
export function savedPartyOf(doc: unknown): Snapshot {
  const x = doc as { customer_id?: string | null; supplier_id?: string | null; bill_to_customer_id?: string | null; party_address?: string | null; party_tax_id?: string | null; party_tax_branch_no?: string | null } | null | undefined;
  if (!x || x.bill_to_customer_id || x.party_address === undefined) return null;
  return { party_id: x.customer_id ?? x.supplier_id ?? null, party_address: x.party_address, party_tax_id: x.party_tax_id ?? null, party_tax_branch_no: x.party_tax_branch_no ?? null };
}
