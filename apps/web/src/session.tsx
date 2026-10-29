import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Me, ApiError } from './api';

interface SessionValue { me: Me | null; loading: boolean; needsSetup: boolean; refresh: () => Promise<void>; select: (p: { company_id?: string; branch_id?: string | null; work_date?: string | null }) => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<SessionValue>({ me: null, loading: true, needsSetup: false, refresh: async () => {}, select: async () => {}, logout: async () => {} });
export const useSession = () => useContext(Ctx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api.get<{ needsSetup: boolean }>('/api/v1/setup/status'), staleTime: Infinity });
  const me = useQuery({
    queryKey: ['me'], retry: false, staleTime: 60_000,
    queryFn: async () => { try { return await api.get<Me>('/api/v1/auth/me'); } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; } },
  });
  useEffect(() => {
    const h = () => qc.setQueryData(['me'], null);
    window.addEventListener('buddy:unauthorized', h);
    return () => window.removeEventListener('buddy:unauthorized', h);
  }, [qc]);
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['setup'] }); await qc.refetchQueries({ queryKey: ['me'] }); };
  const value: SessionValue = {
    me: me.data ?? null, loading: me.isLoading || setup.isLoading, needsSetup: !!setup.data?.needsSetup, refresh,
    async select(p) {
      const companyChanged = p.company_id && p.company_id !== me.data?.company?.id;
      await api.post('/api/v1/auth/select', p);
      if (companyChanged || p.branch_id !== undefined) qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'setup' });
      await qc.refetchQueries({ queryKey: ['me'] });
    },
    async logout() { await api.post('/api/v1/auth/logout'); qc.clear(); qc.setQueryData(['me'], null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** สิทธิ์ของผู้ใช้ในเมนูนี้ (ใช้ซ่อน/ปิดปุ่ม — API ตรวจซ้ำเสมอ) · เมนูที่ยังไม่มีในตารางถือว่าใช้ได้ */
export function useCan(menu: string) {
  const { me } = useSession();
  const p = me?.perms?.[menu];
  return (action: import('./api').PermAction) => !p || p[action] !== false;
}
