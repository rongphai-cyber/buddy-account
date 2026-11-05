import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fmt } from '@buddy/core';
import { api } from '../api';
import { ErrorBox, PageHead, toast, toastError, useHotkeys } from '../ui';

/**
 * WTS Solutions Hub (docs/17 B6.2) — ทางเข้าทุกโปรแกรมของลูกค้า ล็อกอิน Buddy ครั้งเดียว
 * ไทล์ตามสิทธิ์โมดูลของลูกค้า (B0.6) · ตัวเลขสำคัญต่อไทล์ · สถานะคิวส่งเอกสารรวม (SyncStatus) ที่โปรแกรมรายงานเข้ามา
 * กดไทล์ POS → ขอบัตรผ่าน (อายุ 2 นาที ใช้ครั้งเดียว) แล้วเปิดโปรแกรมในแท็บใหม่ — หน้าร้านไม่ต้องรอ Buddy (D11)
 */
type Sync = { state: 'online' | 'syncing' | 'error' | 'offline'; pending: number; failed: number; text: string; reported_at?: string; message?: string | null };
type App = {
  key: string; name: string; description: string; mark: string; tone: string; launch: 'self' | 'sso' | 'link' | 'soon';
  status: 'active' | 'locked' | 'soon'; reason: string | null; valid_to: string | null; url: string | null;
  metric: { label: string; value: string; at: string } | null; sync: Sync | null;
};
type Hub = { tenant: { code: string; name: string } | null; company: { id: string; code: string; name_th: string }; apps: App[]; sync: (Sync & { text: string }) | null };

const SYNC_ICON: Record<Sync['state'], string> = { online: '✓', syncing: '⟳', offline: '⚠', error: '✕' };
const BADGE: Record<string, string> = { locked: 'ยังไม่เปิดใช้', soon: 'เร็ว ๆ นี้' };
const timeTh = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '');
const BAHT = '฿';
const showMetric = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? BAHT + fmt(v) : v);

export function SyncPill({ s, title }: { s: Sync; title?: string }) {
  return <span className={`hub-sync hub-sync-${s.state}`} role="status" title={title ?? s.message ?? undefined}><b aria-hidden="true">{SYNC_ICON[s.state]}</b> {s.text}</span>;
}

export function HubPage() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['hub'], queryFn: () => api.get<Hub>('/api/v1/hub'), refetchInterval: 60_000 });
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
  const who = d ? `${d.tenant ? `${d.tenant.name} · ` : ''}${d.company.code} ${d.company.name_th}` : '';
  const lead = d ? <><span data-no-i18n>{who}</span> — ล็อกอิน Buddy ครั้งเดียว กดไทล์เพื่อเปิดโปรแกรม</> : <>กำลังโหลด…</>;
  return (
    <div className="page hub-page">
      <PageHead eyebrow="WTS Solutions" title="เปิดโปรแกรม"
        lead={lead}
        actions={<>
          {d?.sync && <SyncPill s={d.sync} />}
          <button type="button" onClick={() => void q.refetch()} title="ดึงสถานะใหม่ (F5)">↻ ดึงสถานะใหม่ <kbd>F5</kbd></button>
        </>} />
      <ErrorBox error={q.error} />
      {d && <div className="hub-grid">
        {d.apps.map((x) => {
          const off = x.status !== 'active';
          return (
            <button key={x.key} type="button" className={`hub-tile${x.key === 'buddy' ? ' hub-tile-lg' : ''}${off ? ' off' : ''}`} aria-disabled={off || undefined}
              data-app={x.key} onClick={() => void open(x)} title={x.reason ?? `เปิด ${x.name}`}>
              <span className="hub-head">
                <span className={`hub-mark hub-tone-${x.tone}`} aria-hidden="true">{x.mark}</span>
                {off ? <span className="pill">{x.reason?.includes('หมดอายุ') ? 'หมดอายุ' : BADGE[x.status]}</span>
                  : x.reason ? <span className="pill st-d">ยังไม่ตั้งที่อยู่</span>
                  : x.launch === 'sso' ? <span className="pill st-n">เข้าได้ทันที</span>
                  : x.launch === 'link' ? <span className="pill">เปิดหน้าเว็บ ↗</span> : null}
              </span>
              <span className="hub-name">{x.name}</span>
              <span className="hub-desc">{x.description}</span>
              {off && x.reason && <span className="hub-desc small">{x.reason}</span>}
              {!off && x.reason && <span className="hub-desc small">{x.reason}</span>}
              {!off && x.launch === 'link' && !x.reason && <span className="hub-desc small">เข้าระบบที่ {x.name} (ยังไม่รับบัตรผ่าน)</span>}
              <span className="hub-foot">
                {x.sync && <SyncPill s={x.sync} title={[x.sync.message, x.sync.reported_at ? `รายงานล่าสุด ${timeTh(x.sync.reported_at)} น.` : ''].filter(Boolean).join(' · ')} />}
                {x.metric && !off && <span className="hub-metric"><span>{x.metric.label}</span><b className="num">{showMetric(x.metric.value)}</b></span>}
              </span>
            </button>
          );
        })}
      </div>}
      <p className="hint">ไทล์ที่ "ยังไม่เปิดใช้" ติดต่อผู้ให้บริการเพื่อเปิด · สถานะคิวมาจากโปรแกรมนั้นรายงานเข้ามาทุก 1–5 นาที — หน้าร้านยังขายได้แม้เน็ตหลุดหรือ Buddy ปิดอยู่ แล้วส่งเข้าบัญชีย้อนหลังเอง</p>
    </div>
  );
}
