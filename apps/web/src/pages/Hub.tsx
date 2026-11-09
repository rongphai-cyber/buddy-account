import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fmt } from '@buddy/core';
import { api } from '../api';
import { useSession } from '../session';
import { ErrorBox, toast, toastError, useHotkeys } from '../ui';

/**
 * หน้าเปิดโปรแกรม (Landing Page) ของ WTS Solutions — docs/17 B6.2 · เจ้าของ 09/11/2569 "Landing Page เหมือนโปรแกรมอื่นของเรา"
 * - หน้าตาแบบหน้ารวมระบบของสำนักงานบัญชี WTS (WTS-App): โลโก้ WTS · การ์ดขาว ขอบส้มตอนชี้ · กล่องคำอธิบาย · "เข้าระบบในนาม …"
 * - ล็อกอิน Buddy ครั้งเดียว: กดการ์ด POS/Living → ขอบัตรผ่าน (อายุ 2 นาที ใช้ครั้งเดียว) แล้วเปิดโปรแกรมในแท็บใหม่ไม่ต้องใส่รหัสซ้ำ
 * - การ์ดเฉพาะโปรแกรมที่ผู้ดูแลให้ผู้ใช้คนนี้เปิดได้ (sys_user.app_access — เซิร์ฟเวอร์กรองให้) · ที่ลูกค้ายังไม่เปิดใช้ = ผู้ดูแลเห็นเป็นการ์ดจาง · "เร็ว ๆ นี้" = บรรทัดท้าย
 * - เต็มจอเสมอ ไม่มีเมนู/แถบบนของ Buddy (เจ้าของ 10/11/2569: "ยังไม่ได้เข้าไปใน Buddy Account") — App.tsx แสดงนอก Shell
 *   มีเปลี่ยนบริษัท · รหัสผ่าน · ออกจากระบบ ในหน้านี้เอง · การ์ด Buddy Account = เข้าโปรแกรมบัญชี
 */
type Sync = { state: 'online' | 'syncing' | 'error' | 'offline'; pending: number; failed: number; text: string; reported_at?: string; message?: string | null };
type App = {
  key: string; name: string; description: string; mark: string; tone: string; launch: 'self' | 'sso' | 'link' | 'soon';
  status: 'active' | 'locked' | 'soon'; reason: string | null; valid_to: string | null; url: string | null;
  metric: { label: string; value: string; at: string } | null; sync: Sync | null;
};
type Hub = { tenant: { code: string; name: string } | null; company: { id: string; code: string; name_th: string }; user?: { name: string; username: string; restricted: boolean }; apps: App[]; sync: (Sync & { text: string }) | null };

const SYNC_ICON: Record<Sync['state'], string> = { online: '✓', syncing: '⟳', offline: '⚠', error: '✕' };
const ICON: Record<string, string> = { buddy: '📒', pos: '🛒', living: '🏢', hr: '👥', hotel: '🏨', spa: '💆' };
const timeTh = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '');
const BAHT = '฿';
const showMetric = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? BAHT + fmt(v) : v);

/** การ์ดที่เปิดได้จริง (ไม่นับ "เร็ว ๆ นี้"/ยังไม่เปิดใช้) — ใช้ตัดสินว่าหลังเข้าระบบควรมาหน้านี้ก่อนไหม */
export const openable = (apps: App[]) => apps.filter((x) => x.status === 'active' && x.launch !== 'soon');

/** หลังเข้าระบบ: ผู้ใช้ที่เปิดได้ตั้งแต่ 2 โปรแกรมขึ้นไป มาที่หน้าเปิดโปรแกรมก่อน (ครั้งเดียวต่อการเข้าระบบ) */
const LANDING_KEY = 'buddy.landing';
export function markLanding() { try { sessionStorage.setItem(LANDING_KEY, '1'); } catch { /* หน้าต่างส่วนตัว */ } }
export function useLandingRedirect(path: string) {
  const nav = useNavigate();
  useEffect(() => {
    let want = false;
    try { want = sessionStorage.getItem(LANDING_KEY) === '1'; sessionStorage.removeItem(LANDING_KEY); } catch { /* */ }
    if (!want || path !== '/') return;
    api.get<Hub>('/api/v1/hub').then((h) => { if (openable(h.apps).length >= 2) nav('/hub', { replace: true }); }).catch(() => undefined);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
}

export function SyncPill({ s, title }: { s: Sync; title?: string }) {
  return <span className={`hub-sync hub-sync-${s.state}`} role="status" title={title ?? s.message ?? undefined}><b aria-hidden="true">{SYNC_ICON[s.state]}</b> {s.text}</span>;
}

export function HubPage() {
  const nav = useNavigate();
  const { me, select, logout } = useSession();
  const q = useQuery({ queryKey: ['hub', me?.company?.id], enabled: !!me?.company, queryFn: () => api.get<Hub>('/api/v1/hub'), refetchInterval: 60_000 });
  // ผู้ใช้เฉพาะ Hub ที่ยังไม่ได้เลือกบริษัท: เลือกบริษัทแรกที่เข้าได้ให้
  useEffect(() => { if (me && !me.company && me.companies[0]) void select({ company_id: me.companies[0].id }).catch(toastError); }, [me?.company?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (x: App) => {
    if (x.status !== 'active') { toast(x.reason ?? `เปิด ${x.name} ไม่ได้`, 'warn'); return; }
    if (x.launch === 'self') { nav('/'); return; }
    if (x.reason) { toast(x.reason, 'warn'); return; }
    if (x.launch === 'link') { if (x.url) window.open(x.url, '_blank', 'noopener'); return; }
    // เปิดแท็บก่อน (กันเบราว์เซอร์บล็อกหน้าต่างที่เปิดหลังรอคำตอบ) แล้วค่อยใส่ที่อยู่พร้อมบัตรผ่าน
    const w = window.open('', '_blank');
    try {
      const r = await api.post<{ url: string }>('/api/v1/hub/launch', { module: x.key });
      if (w) { w.opener = null; w.location.href = r.url; } else window.location.href = r.url;
    } catch (e) { w?.close(); toastError(e); }
  };
  useHotkeys({ F5: () => { void q.refetch(); } }, []);
  const d = q.data;
  const admin = !!me?.user.is_admin;
  // ที่ลูกค้ายังไม่เปิดใช้ แสดงให้ผู้ดูแลเห็น (รู้ว่ามีโปรแกรมอะไรให้ซื้อเพิ่ม) · ผู้ใช้ทั่วไปเห็นเฉพาะที่ใช้ได้
  const cards = d ? d.apps.filter((x) => x.status !== 'soon' && (x.status === 'active' || admin)) : [];
  const soon = d ? d.apps.filter((x) => x.status === 'soon') : [];
  const company = d ? `${d.company.code} ${d.company.name_th}` : me?.company ? `${me.company.code} ${me.company.name_th}` : '';
  return (
    <div className="landing landing-full">
      <div className="landing-wrap">
        <div className="landing-head">
          <img className="landing-logo" src="/wts-logo.png" alt="WTS" width={210} height={70} />
          <h1>WTS Solutions<small>เลือกโปรแกรมที่ต้องการใช้งาน{company && <> — <span data-no-i18n>{company}</span></>}</small></h1>
          <div className="landing-tools">
            {d?.sync && <SyncPill s={d.sync} />}
            <button type="button" onClick={() => void q.refetch()} title="ดึงสถานะใหม่ (F5)">↻ <kbd>F5</kbd></button>
          </div>
        </div>
        {me && me.companies.length > 1 && (
          <label className="landing-co">บริษัท{' '}
            <select value={me.company?.id ?? ''} onChange={(e) => select({ company_id: e.target.value }).catch(toastError)} aria-label="บริษัท">
              {me.companies.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name_th}</option>)}
            </select>
          </label>
        )}
        <ErrorBox error={q.error} />
        {!me?.company && !me?.companies.length && <div className="landing-note">ยังไม่ได้รับสิทธิ์เข้าบริษัทใด — ให้ผู้ดูแลระบบกำหนด "บริษัทที่เข้าได้" ที่ อื่น ๆ › ผู้ใช้งานและสิทธิ์</div>}
        {d && <div className="landing-grid">
          {cards.map((x) => {
            const off = x.status !== 'active';
            const badge = off ? (x.reason?.includes('หมดอายุ') ? 'หมดอายุ' : 'ยังไม่เปิดใช้')
              : x.reason ? 'ยังไม่ตั้งที่อยู่' : x.launch === 'link' ? 'เปิดหน้าเว็บ ↗' : null;   // ใช้ได้ปกติ = ไม่มีป้าย (แบบ WTS-App)
            return (
              <button key={x.key} type="button" className={`landing-card${off ? ' off' : ''}`} aria-disabled={off || undefined}
                data-app={x.key} onClick={() => void open(x)} title={x.reason ?? `เปิด ${x.name}`}>
                <span className="landing-card-top"><span className="ic" aria-hidden="true">{ICON[x.key] ?? '▦'}</span>{badge && <span className={`pill${!off && !x.reason ? ' st-n' : x.reason && !off ? ' st-d' : ''}`}>{badge}</span>}</span>
                <span className="t">{x.name}</span>
                <span className="d">{x.description}</span>
                {x.reason && <span className="d small">{x.reason}</span>}
                {!off && x.launch === 'link' && !x.reason && <span className="d small">เข้าระบบที่ {x.name} (ยังไม่รับบัตรผ่าน)</span>}
                {(x.sync || (x.metric && !off)) && <span className="landing-card-foot">
                  {x.sync && <SyncPill s={x.sync} title={[x.sync.message, x.sync.reported_at ? `รายงานล่าสุด ${timeTh(x.sync.reported_at)} น.` : ''].filter(Boolean).join(' · ')} />}
                  {x.metric && !off && <span className="hub-metric"><span>{x.metric.label}</span><b className="num">{showMetric(x.metric.value)}</b></span>}
                </span>}
              </button>
            );
          })}
          {!cards.length && <div className="landing-note" style={{ gridColumn: '1 / -1' }}><b>ยังไม่ได้รับสิทธิ์เปิดโปรแกรมใด</b> — ให้ผู้ดูแลระบบของบริษัทติ๊ก "โปรแกรมที่เปิดได้" ให้คุณที่ อื่น ๆ › ผู้ใช้งานและสิทธิ์</div>}
        </div>}
        <div className="landing-note">
          <b>เข้าระบบครั้งเดียวใช้ได้ทุกโปรแกรม</b> — กดการ์ดแล้วโปรแกรมเปิดในแท็บใหม่ ไม่ต้องใส่รหัสผ่านซ้ำ<br />
          {d?.user?.restricted ? <>โปรแกรมที่เห็นกำหนดโดยผู้ดูแลระบบของบริษัท — ต้องการเพิ่ม ติดต่อผู้ดูแลระบบ</>
            : <>ผู้ดูแลระบบกำหนดว่าแต่ละคนเปิดโปรแกรมไหนได้ที่ <b>อื่น ๆ › ผู้ใช้งานและสิทธิ์ › โปรแกรมที่เปิดได้</b></>}
          {soon.length > 0 && <><br />เร็ว ๆ นี้: {soon.map((x) => x.name).join(' · ')}</>}
        </div>
        <div className="landing-foot">
          {me && <>เข้าระบบในนาม <b data-no-i18n>{me.user.display_name}</b> ({me.user.username})</>}
          {me && <> · <button type="button" className="linklike" onClick={() => nav('/account/password')}>รหัสผ่านและยืนยันตัวตน</button> · <button type="button" className="linklike" onClick={() => void logout()}>ออกจากระบบ</button></>}
        </div>
      </div>
    </div>
  );
}
