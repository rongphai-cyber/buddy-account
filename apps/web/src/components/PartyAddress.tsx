import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

type Party = { id: string; code?: string };
type Snapshot = { party_id?: string | null; party_address?: string | null; party_tax_id?: string | null; party_tax_branch_no?: string | null } | null | undefined;
type Master = { address_1?: string | null; address_2?: string | null; address_3?: string | null; zip_code?: string | null; tax_id?: string | null; tax_branch_no?: string | null };

const branchText = (b: string | null | undefined) => (!b ? '' : b === '00000' ? 'สำนักงานใหญ่' : `สาขา ${b}`);

/**
 * ที่อยู่ของลูกค้า/ผู้จำหน่ายใต้ช่องรหัส (เจ้าของ 18/11/2569 "กรณีมีรหัสลูกค้า เจ้าหนี้ ต้องแสดงที่อยู่ด้านล่างด้วย จะได้ทราบว่ารายละเอียดถูกต้อง")
 * เอกสารที่บันทึกแล้วและยังเป็นคู่ค้าเดิม = ที่อยู่ที่พิมพ์ในเอกสาร (snapshot) · เลือกคู่ค้าใหม่ = จากแฟ้มคู่ค้า (API กรองบริษัทจาก session)
 * แสดง 2 บรรทัด ยาวเกินตัดท้าย ชี้เมาส์ดูเต็ม
 */
export function PartyAddress({ kind, party, saved }: { kind: 'customer' | 'supplier'; party: Party | null | undefined; saved?: Snapshot }) {
  const useSaved = !!party && !!saved && saved.party_id === party.id;
  const q = useQuery({ queryKey: ['party-address', kind, party?.id], enabled: !!party?.id && !useSaved, staleTime: 60_000,
    queryFn: () => api.get<Master>(`/api/v1/${kind === 'customer' ? 'customers' : 'suppliers'}/${party!.id}`) });
  if (!party?.id) return null;
  const m = q.data;
  const address = useSaved ? saved!.party_address ?? '' : m ? [m.address_1, m.address_2, m.address_3, m.zip_code].filter(Boolean).join(' ') : '';
  const taxId = useSaved ? saved!.party_tax_id : m?.tax_id;
  const branch = useSaved ? saved!.party_tax_branch_no : m?.tax_branch_no;
  if (!useSaved && !m) return <div className="party-addr muted">{q.isError ? 'อ่านที่อยู่ไม่ได้' : 'กำลังอ่านที่อยู่…'}</div>;
  const full = [address || 'ไม่มีที่อยู่ในแฟ้ม', taxId ? `เลขผู้เสียภาษี ${taxId}` : '', branchText(branch)].filter(Boolean).join(' · ');
  return (
    <div className="party-addr" title={full} aria-label="ที่อยู่คู่ค้า">
      {address ? <span data-no-i18n>{address}</span> : <span className="warn-text">ไม่มีที่อยู่ในแฟ้ม — ตรวจที่แฟ้ม{kind === 'customer' ? 'ลูกค้า' : 'ผู้จำหน่าย'}</span>}
      {taxId && <> · เลขผู้เสียภาษี <b data-no-i18n>{taxId}</b></>}{branch && <> · {branchText(branch)}</>}
    </div>
  );
}

/** ที่อยู่ที่เก็บในเอกสารที่บันทึกแล้ว (snapshot) — ใบที่ออกในนามอื่น (Bill to) ใช้แฟ้มคู่ค้าแทน */
export function savedPartyOf(doc: unknown): Snapshot {
  const x = doc as { customer_id?: string | null; supplier_id?: string | null; bill_to_customer_id?: string | null; party_address?: string | null; party_tax_id?: string | null; party_tax_branch_no?: string | null } | null | undefined;
  if (!x || x.bill_to_customer_id || x.party_address === undefined) return null;
  return { party_id: x.customer_id ?? x.supplier_id ?? null, party_address: x.party_address, party_tax_id: x.party_tax_id ?? null, party_tax_branch_no: x.party_tax_branch_no ?? null };
}
