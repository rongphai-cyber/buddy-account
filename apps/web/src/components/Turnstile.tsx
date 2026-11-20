import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/**
 * ช่องตรวจว่าไม่ใช่บอท (Cloudflare Turnstile · HANDOFF 165) ที่หน้าเข้าระบบ/สมัครใช้งาน
 * ผู้ให้บริการยังไม่ตั้งกุญแจ (GET /auth/bot-check ได้ site_key ว่าง) = ไม่แสดง ไม่ต้องส่งอะไร — ทำงานเหมือนเดิม
 * ได้เครื่องหมาย (token ใช้ได้ครั้งเดียว) → ส่งไปกับคำขอเป็น turnstile · ส่งแล้วไม่ผ่าน = reset() ขอใหม่
 */
type TS = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id?: string) => void };
declare global { interface Window { turnstile?: TS } }
let loading: Promise<void> | null = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = () => resolve(); s.onerror = () => { loading = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return loading;
}

export function useTurnstile() {
  const cfg = useQuery({ queryKey: ['bot-check'], queryFn: () => api.get<{ site_key: string | null }>('/api/v1/auth/bot-check'), staleTime: Infinity, retry: 1 });
  const siteKey = cfg.data?.site_key ?? null;
  const box = useRef<HTMLDivElement>(null);
  const wid = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      wid.current = window.turnstile.render(box.current, { sitekey: siteKey, language: 'th', callback: (t: string) => setToken(t), 'expired-callback': () => setToken(null), 'error-callback': () => setToken(null) });
    }).catch(() => setFailed(true));
    return () => { gone = true; if (wid.current) window.turnstile?.remove(wid.current); wid.current = null; };
  }, [siteKey]);
  return {
    required: !!siteKey,
    token,
    /** หลังส่งแล้ว (ผ่านหรือไม่ผ่าน) — เครื่องหมายใช้ได้ครั้งเดียว */
    reset: () => { setToken(null); if (wid.current) window.turnstile?.reset(wid.current); },
    el: siteKey ? (
      <div className="bot-check">
        <div ref={box} />
        {failed && <p className="bad small" role="alert">โหลดช่องตรวจสอบของ Cloudflare ไม่ได้ — ตรวจอินเทอร์เน็ต แล้วโหลดหน้านี้ใหม่</p>}
      </div>
    ) : null,
  };
}
