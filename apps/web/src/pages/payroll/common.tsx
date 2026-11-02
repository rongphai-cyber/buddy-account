import { useQuery } from '@tanstack/react-query';
import type { PayCalc, PayItemKind, PayTaxBucket } from '@buddy/core';
import { api } from '../../api';

export interface PayItem { id: string; code: string; name_th: string; name_en: string | null; kind: PayItemKind; tax_bucket: PayTaxBucket; sso_base: boolean; pvd_base: boolean; calc: PayCalc;
  multiplier: string | null; multiplier_daily: string | null; sign: 1 | -1; gl_role: string; account_id: string | null; account_no: string | null; account_name: string | null; system_code: string | null; sort_order: number; status: string; used: boolean }
export const usePayItems = () => useQuery({ queryKey: ['pay-items'], queryFn: () => api.get<PayItem[]>('/api/v1/pay/items'), staleTime: 30_000 });

/** ปุ่ม ⏮◀▶⏭ ไปรายการแรก/ก่อน/ถัดไป/สุดท้าย ตามลำดับในรายการ */
export function RecNav({ ids, cur, go }: { ids: string[]; cur?: string; go: (id: string) => void }) {
  const i = cur ? ids.indexOf(cur) : -1;
  const b = (to: number, icon: string, label: string) => {
    const t = ids[to];
    return <button key={label} className="icon-btn nav-btn" disabled={i < 0 || !t || to === i} onClick={() => t && go(t)} title={label} aria-label={label}>{icon}</button>;
  };
  return <span className="doc-nav">{b(0, '⏮', 'รายการแรก')}{b(i - 1, '◀', 'ก่อนหน้า')}{b(i + 1, '▶', 'ถัดไป')}{b(ids.length - 1, '⏭', 'รายการสุดท้าย')}</span>;
}

/** ดาวน์โหลดแฟ้มจาก API (แฟ้มยื่น/แบบฟอร์ม) — ผิดพลาดแสดงข้อความจาก server */
export async function downloadFile(url: string, fallbackName: string) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) {
    const j = await r.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(j?.error?.message ?? `ดาวน์โหลดไม่ได้ (${r.status})`);
  }
  const cd = r.headers.get('content-disposition') ?? '';
  const name = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob()); a.download = name ? decodeURIComponent(name) : fallbackName; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const fileToBase64 = (f: File) => new Promise<string>((ok, bad) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result).split(',')[1] ?? ''); rd.onerror = () => bad(rd.error); rd.readAsDataURL(f); });
