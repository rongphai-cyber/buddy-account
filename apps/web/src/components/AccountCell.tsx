import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Account } from '../api';
import { Lookup } from '../ui';
import { AccountForm } from '../pages/gl/Accounts';

export function useAccounts() {
  return useQuery({ queryKey: ['accounts', 'plain'], queryFn: () => api.get<Account[]>('/api/v1/gl/accounts'), staleTime: 60_000 });
}

/**
 * ช่องเลขที่บัญชี: พิมพ์เลขที่แล้ว Enter/Tab, หรือกด F4 / 🔍 เพื่อเปิดหน้าต่างค้นหา (คู่มือบทที่ 3 S-UI-04)
 * ในหน้าต่างค้นหา กด Insert เพื่อเพิ่มบัญชีใหม่ได้ทันทีโดยไม่ต้องออกจากใบสำคัญ
 */
export function AccountCell({ value, onChange, postableOnly = true, autoFocus, invalid, required, ...rest }: { value: string | null; onChange: (a: Account | null) => void; postableOnly?: boolean; autoFocus?: boolean; invalid?: boolean; required?: boolean; [k: string]: unknown }) {
  const accts = useAccounts();
  const qc = useQueryClient();
  const cur = accts.data?.find((a) => a.id === value);
  const [txt, setTxt] = useState(cur?.account_no ?? '');
  const [lookup, setLookup] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [emptyHit, setEmptyHit] = useState(false);
  useEffect(() => setTxt(cur?.account_no ?? ''), [cur?.account_no]);
  // พิมพ์เลขที่แล้ว Enter ก่อนผังบัญชีโหลดเสร็จ: จำไว้แล้วค่อยหาเมื่อโหลดเสร็จ (ไม่เปิดหน้าต่างค้นหาผิด ๆ)
  const [pending, setPending] = useState(false);
  useEffect(() => { if (pending && accts.data) { setPending(false); resolve(); } }, [pending, accts.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const resolve = () => {
    const t = txt.trim();
    if (!t) { if (value) onChange(null); return true; }
    if (cur && cur.account_no === t) return true;
    if (!accts.data) { setPending(true); return true; }
    const exact = accts.data?.find((a) => a.account_no === t || a.account_no.replace(/-/g, '') === t.replace(/-/g, ''));
    if (exact && (!postableOnly || !exact.is_control)) { onChange(exact); setTxt(exact.account_no); return true; }
    setLookup(t);
    return false;
  };
  return (
    <span className="lk-in">
      <input {...rest} value={txt} autoFocus={autoFocus} aria-invalid={invalid || undefined} className="mono" placeholder="เลขที่บัญชี"
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'F4' || (e.key === 'ArrowDown' && e.altKey)) { e.preventDefault(); setLookup(txt); }
          // ช่องที่ต้องมี (required): Enter ตอนว่าง = เปิดหน้าต่างเลือกบัญชี ไม่ข้ามไปช่องถัดไป (ข้อกำหนดเจ้าของ: รายการที่ต้องมีให้แจ้งเตือนและให้เลือก)
          if (e.key === 'Enter' && required && !txt.trim()) { e.preventDefault(); e.stopPropagation(); setEmptyHit(true); setLookup(''); return; }
          if (e.key === 'Enter' && !resolve()) { e.preventDefault(); e.stopPropagation(); }
        }}
        onBlur={() => { if (!lookup) resolve(); }} />
      <button type="button" className="icon-btn" tabIndex={-1} onClick={() => setLookup(txt)} title="ค้นหาบัญชี (F4)">🔍</button>
      {lookup !== null && (
        <Lookup<Account> title={emptyHit ? 'ต้องป้อนเลขที่บัญชี — เลือกบัญชี (Insert เพิ่มบัญชีใหม่)' : 'เลือกบัญชี'} rows={accts.data ?? []} initial={lookup} filter={(a) => a.status === 'A' && (!postableOnly || !a.is_control)}
          cols={[{ key: 'account_no', label: 'เลขที่บัญชี', w: 120 }, { key: 'name_th', label: 'ชื่อบัญชี' }, { key: 'parent_no', label: 'บัญชีคุม', w: 100 }]}
          onPick={(a) => { onChange(a); setTxt(a.account_no); setLookup(null); setEmptyHit(false); }}
          onClose={() => { setLookup(null); setEmptyHit(false); setTxt(cur?.account_no ?? ''); }}
          onAdd={(t) => { setAdding(t); setLookup(null); }} />
      )}
      {adding !== null && (
        <AccountForm acct={null} all={accts.data ?? []} initialNo={adding} onClose={() => setAdding(null)}
          onSaved={async (id) => {
            setAdding(null);
            const fresh = await qc.fetchQuery({ queryKey: ['accounts', 'plain'], queryFn: () => api.get<Account[]>('/api/v1/gl/accounts'), staleTime: 0 });
            qc.invalidateQueries({ queryKey: ['accounts', 'bal'] });
            const a = fresh.find((x) => x.id === id);
            if (a) { onChange(a); setTxt(a.account_no); }
          }} />
      )}
    </span>
  );
}
