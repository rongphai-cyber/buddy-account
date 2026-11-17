import { useQuery } from '@tanstack/react-query';
import { api, type Department } from '../api';
import { AccountCell, useAccounts } from './AccountCell';

/** เงื่อนไขรายงานที่ใช้ร่วมกัน (บัญชีแยกประเภท งบทดลอง — เจ้าของ 17/11/2569) */
type BranchRow = { id: string; code: string; name: string; status: string };
export function useBranches() { return useQuery({ queryKey: ['branches'], queryFn: () => api.get<BranchRow[]>('/api/v1/branches'), staleTime: 60_000 }); }
export function useDepartments() { return useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments'), staleTime: 60_000 }); }

export function BranchSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const b = useBranches();
  return <label className="inline">สาขา <select value={value} onChange={(e) => onChange(e.target.value)}><option value="">ทุกสาขา</option>{b.data?.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></label>;
}
export function DeptSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const d = useDepartments();
  return <label className="inline">แผนก <select value={value} onChange={(e) => onChange(e.target.value)}><option value="">ทุกแผนก</option>{d.data?.filter((x) => x.status === 'A' || x.id === value).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th}</option>)}</select></label>;
}

/** เลือกบัญชี: ทุกบัญชี / ช่วงเลขที่บัญชี (จาก–ถึง ค้นหา F4/🔍) / บัญชีเดียว */
export type AccountScopeValue = { mode: 'all' | 'range' | 'one'; from: string; to: string; one: string | null };
export function AccountScope({ value, onChange, allowOne = true }: { value: AccountScopeValue; onChange: (v: AccountScopeValue) => void; allowOne?: boolean }) {
  const accts = useAccounts();
  const idOf = (no: string) => accts.data?.find((a) => a.account_no === no)?.id ?? null;
  const set = (p: Partial<AccountScopeValue>) => onChange({ ...value, ...p });
  return (
    <span className="inline acc-scope">
      บัญชี <select value={value.mode} onChange={(e) => set({ mode: e.target.value as AccountScopeValue['mode'] })} aria-label="เลือกบัญชี">
        <option value="all">ทุกบัญชี</option><option value="range">ช่วงเลขที่บัญชี</option>{allowOne && <option value="one">บัญชีเดียว</option>}
      </select>
      {value.mode === 'range' && <>
        <span className="acc-pick"><AccountCell value={idOf(value.from)} postableOnly={false} aria-label="จากเลขที่บัญชี" onChange={(a) => set({ from: a?.account_no ?? '' })} /></span>
        ถึง <span className="acc-pick"><AccountCell value={idOf(value.to)} postableOnly={false} aria-label="ถึงเลขที่บัญชี" onChange={(a) => set({ to: a?.account_no ?? '' })} /></span>
      </>}
      {value.mode === 'one' && <span className="acc-pick"><AccountCell value={value.one} postableOnly={false} aria-label="เลขที่บัญชี" onChange={(a) => set({ one: a?.id ?? null })} /></span>}
    </span>
  );
}
/** ข้อความเงื่อนไขสำหรับหัวรายงาน (พิมพ์/Excel) */
export function scopeText(v: AccountScopeValue, accName: (id: string | null) => string) {
  return v.mode === 'all' ? 'ทุกบัญชี' : v.mode === 'one' ? `บัญชี ${accName(v.one)}` : `บัญชี ${v.from || 'แรก'} ถึง ${v.to || 'สุดท้าย'}`;
}
