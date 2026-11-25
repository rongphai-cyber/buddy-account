import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AI_PAYER_TH, d, fmt, periodLabel, QUOTA_LABEL, RETENTION_TERMS, thisMonthTh, type QuotaKey } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { cx, ErrorBox, PageHead, Pill, useYearSystem } from '../../ui';
import { gbText } from '../../components/PackageFields';

/** รายงานการใช้งานของลูกค้าหนึ่งราย (GET /api/v1/usage · /api/v1/admin/usage/:id) — HANDOFF 185 */
export interface UsageRow { key: QuotaKey; used: number; limit: number | null; pct: number | null; level: 'none' | 'ok' | 'warn' | 'over' }
export interface UsageReport {
  month: string; tenant: { id: string; code: string; name: string; status: string }; package: { id: string; code: string; name_th: string; price_year: string; status: string } | null;
  over_action: 'W' | 'S'; limits: { companies: number | null; users: number | null; docs: number | null; file_mb: number | null; ai: number | null };
  usage: { companies: number; users: number; docs: number; file_bytes: number; ai: number }; rows: UsageRow[]; level: UsageRow['level'];
  companies: Array<{ id: string; code: string; name_th: string; docs: number; vouchers: number; file_bytes: number; ai: number; db_bytes?: number }>; docs_definition: string;
  /** ผู้จ่ายค่า AI (HANDOFF 190) · เพดานดอลลาร์ (เฉพาะ WTS จ่ายให้) · ค่า AI ของเดือน (ดอลลาร์) */
  ai_payer: 'C' | 'P'; ai_limit_usd: string | null; ai_cost_usd: string;
  overage?: { lines: Array<{ key: QuotaKey; label: string; over: string; unit: string; rate: string; amount: string; note: string }>; total: string };
}
export const mbText = (bytes: number) => `${(bytes / 1048576).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`;
const UNIT: Record<QuotaKey, string> = { companies: 'บริษัท', users: 'คน', docs: 'ใบ', files: 'MB', ai: 'บิล' };
export const LEVEL: Record<UsageRow['level'], [string, 'n' | 'm' | 'd' | 'x' | 'c']> = { none: ['ไม่จำกัด', 'x'], ok: ['ปกติ', 'n'], warn: ['ใกล้ครบ', 'd'], over: ['ครบ/เกิน', 'c'] };
const limitText = (r: UsageRow) => (r.limit === null ? 'ไม่จำกัด' : r.key === 'files' ? gbText(r.limit) : r.limit.toLocaleString());
const usedText = (r: UsageRow) => (r.key === 'files' ? `${r.used.toLocaleString('en-US', { maximumFractionDigits: 1 })} MB` : r.used.toLocaleString());

/** 12 เดือนล่าสุด (เวลาไทย) */
export function useMonths() {
  const ys = useYearSystem();
  const cur = thisMonthTh();
  const [y, m] = cur.split('-').map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, i) => { const t = y * 12 + (m - 1) - i; const k = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; return { key: k, label: periodLabel(`${k}-01`, ys) }; });
}
export function MonthSelect({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const months = useMonths();
  return <label className="inline">เดือน <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="เดือน">{months.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>;
}

/** แถบเตือน 80% / 100% */
export function UsageBanner({ r }: { r: Pick<UsageReport, 'rows' | 'level' | 'over_action'> }) {
  const hot = r.rows.filter((x) => x.level === 'warn' || x.level === 'over');
  if (!hot.length) return null;
  const list = hot.map((x) => `${QUOTA_LABEL[x.key]} ${x.pct}%`).join(' · ');
  const stop = r.over_action === 'S';
  return r.level === 'over'
    ? <div className="errbox" role="alert"><b>ใช้งานครบ/เกินขีดจำกัดแล้ว:</b> {list} — เอกสารยังออกได้ตามปกติ (คิดส่วนเกิน){stop ? ' · อัปโหลดไฟล์/อ่านบิลด้วย AI ที่ครบแล้วจะใช้ไม่ได้จนกว่าจะเพิ่มแพ็กเกจ' : ' · ไฟล์/AI ใช้ต่อได้ คิดส่วนเกิน'} · ติดต่อผู้ให้บริการเพื่อเปลี่ยนแพ็กเกจ</div>
    : <div className="notebox warn" role="status"><b>ใกล้ครบขีดจำกัด (80% ขึ้นไป):</b> {list} — วางแผนเปลี่ยนแพ็กเกจ หรือลบไฟล์ที่ไม่ใช้</div>;
}

/** ภาพรวมการใช้งาน: แพ็กเกจ แถบการใช้งาน แยกตามบริษัท (provider = เพิ่มขนาดข้อมูลโดยประมาณ) */
export function UsageView({ r, provider }: { r: UsageReport; provider?: boolean }) {
  return (
    <>
      <UsageBanner r={r} />
      <div className="usage-head">
        <div><span className="muted small">แพ็กเกจ</span><b>{r.package ? `${r.package.name_th} (${r.package.code})` : 'ไม่มีแพ็กเกจ — ไม่จำกัด'}</b>{r.package && <span className="small">{fmt(r.package.price_year)} บาท/ปี (ไม่รวม VAT)</span>}</div>
        <div><span className="muted small">เมื่อไฟล์/AI ครบ 100%</span><b>{r.over_action === 'S' ? 'หยุด' : 'เตือนและคิดเงินส่วนเกิน'}</b><span className="small">เอกสารไม่หยุดเด็ดขาด</span></div>
        <div className="usage-ai"><span className="muted small">ค่า AI อ่านบิล</span><b>{AI_PAYER_TH[r.ai_payer ?? 'C']}</b>
          <span className="small">{r.ai_payer === 'P'
            ? `ใช้ไป $${d(r.ai_cost_usd ?? '0').toFixed(2)} ${r.ai_limit_usd !== null ? `จากเพดาน $${d(r.ai_limit_usd).toFixed(2)}` : '(ไม่จำกัด)'} ต่อเดือน รวมทุกบริษัท · นับโควตา AI ตามแพ็กเกจ`
            : 'ใช้กุญแจ API ของกิจการเอง (เรียกเก็บกับบัญชี Anthropic ของกิจการ) · ไม่นับโควตา ไม่คิดส่วนเกิน AI'}</span></div>
      </div>
      <div className="usage-bars">
        {r.rows.map((x) => {
          // ลูกค้าจ่ายค่า AI เอง (HANDOFF 190): แสดงจำนวนที่อ่าน ไม่มีขีดจำกัด/ระดับเตือน
          const own = x.key === 'ai' && r.ai_payer !== 'P';
          return (
          <div key={x.key} className={cx('usage-bar', `lv-${x.level}`)}>
            <div className="usage-bar-top"><b>{QUOTA_LABEL[x.key]}</b><span className="num">{own ? `${usedText(x)} ${UNIT.ai}` : <>{usedText(x)} / {limitText(x)}{x.limit !== null && x.key !== 'files' ? ` ${UNIT[x.key]}` : ''}</>}</span>{own ? <Pill tone="x">{AI_PAYER_TH.C}</Pill> : <Pill tone={LEVEL[x.level][1]}>{x.pct !== null ? `${x.pct}% · ` : ''}{LEVEL[x.level][0]}</Pill>}</div>
            <div className="usage-track" role="progressbar" aria-label={QUOTA_LABEL[x.key]} aria-valuenow={x.pct ?? 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, x.pct ?? 0)}%` }} /></div>
          </div>
          );
        })}
      </div>
      <p className="small muted">นับเอกสาร: {r.docs_definition} · เอกสารและ AI = ของเดือนที่เลือก · ไฟล์ บริษัท ผู้ใช้ = ณ ตอนนี้</p>
      <h3>แยกตามบริษัท</h3>
      <div className="table-wrap"><table className="grid">
        <thead><tr><th>รหัส</th><th>บริษัท</th><th className="r">เอกสาร</th><th className="r">(ใบสำคัญที่บันทึกเอง)</th><th className="r">ไฟล์</th><th className="r">อ่านบิลด้วย AI</th>{provider && <th className="r" title="ประมาณจากตารางที่ใหญ่ที่สุด — ใช้ดูต้นทุน ไม่ใช้คิดเงิน">ขนาดข้อมูล (ประมาณ)</th>}</tr></thead>
        <tbody>
          {r.companies.map((c) => <tr key={c.id}><td className="mono">{c.code}</td><td>{c.name_th}</td><td className="r num">{c.docs.toLocaleString()}</td><td className="r num muted">{c.vouchers.toLocaleString()}</td><td className="r num">{mbText(c.file_bytes)}</td><td className="r num">{c.ai.toLocaleString()}</td>{provider && <td className="r num">{mbText(c.db_bytes ?? 0)}</td>}</tr>)}
          {!r.companies.length && <tr><td colSpan={provider ? 7 : 6} className="empty">ยังไม่มีบริษัท</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={2}>รวม</td><td className="r num">{r.usage.docs.toLocaleString()}</td><td className="r num muted">{r.companies.reduce((s, c) => s + c.vouchers, 0).toLocaleString()}</td><td className="r num">{mbText(r.usage.file_bytes)}</td><td className="r num">{r.usage.ai.toLocaleString()}</td>{provider && <td className="r num">{mbText(r.companies.reduce((s, c) => s + (c.db_bytes ?? 0), 0))}</td>}</tr></tfoot>
      </table></div>
    </>
  );
}

/** เริ่มระบบ › การใช้งานและแพ็กเกจ (ผู้ดูแลระบบของกิจการ · อ่านอย่างเดียว) */
export function UsagePage() {
  const { me } = useSession();
  const [month, setMonth] = useState(thisMonthTh());
  const ok = !!me?.user.is_admin && !!me.user.tenant_id;
  const q = useQuery({ enabled: ok, queryKey: ['usage', month], queryFn: () => api.get<UsageReport>(`/api/v1/usage?month=${month}`) });
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ" title="การใช้งานและแพ็กเกจ" lead="แพ็กเกจบริการและการใช้งานของกิจการ (ทุกบริษัทรวมกัน) — ราคาต่อปีไม่รวม VAT · ต้องการเปลี่ยนแพ็กเกจ ติดต่อผู้ให้บริการ"
        actions={<MonthSelect value={month} onChange={setMonth} />} />
      {!ok && <div className="notebox">{me?.user.is_platform ? 'เจ้าหน้าที่ผู้ให้บริการ: ดูการใช้งานของลูกค้าที่ แพ็กเกจและการใช้งานลูกค้า (ผู้ให้บริการ)' : 'เฉพาะผู้ดูแลระบบของกิจการ'}</div>}
      <ErrorBox error={q.error} />
      {q.data && <UsageView r={q.data} />}
      {ok && <fieldset className="box retention-terms"><legend>การเก็บข้อมูลเมื่อค้างชำระหรือเลิกใช้บริการ</legend>
        <ul>{RETENTION_TERMS.map((x) => <li key={x}>{x}</li>)}</ul>
      </fieldset>}
    </div>
  );
}

/** แถบเตือนในโปรแกรม (ทุกหน้า) สำหรับผู้ดูแลของลูกค้า เมื่อใช้งาน 80% ขึ้นไป */
export function UsageAlert({ onOpen }: { onOpen: () => void }) {
  const { me } = useSession();
  const on = !!me?.user.is_admin && !!me.user.tenant_id;
  const q = useQuery({ enabled: on, queryKey: ['usage-alert'], queryFn: () => api.get<{ level: UsageRow['level']; rows: UsageRow[]; over_action?: 'W' | 'S' }>('/api/v1/usage/alert'), staleTime: 10 * 60_000, retry: false });
  const [hide, setHide] = useState(false);
  if (!on || hide || !q.data || (q.data.level !== 'warn' && q.data.level !== 'over')) return null;
  const list = q.data.rows.map((x) => `${QUOTA_LABEL[x.key]} ${x.pct}%`).join(' · ');
  return (
    <div className={cx('usage-alert no-print', q.data.level === 'over' ? 'bad' : 'warn')} role="status">
      <span>{q.data.level === 'over' ? 'ใช้งานครบขีดจำกัดของแพ็กเกจแล้ว' : 'ใช้งานใกล้ครบขีดจำกัดของแพ็กเกจ'}: {list}</span>
      <button type="button" className="linklike" onClick={onOpen}>ดูการใช้งาน</button>
      <button type="button" className="linklike" aria-label="ซ่อน" onClick={() => setHide(true)}>✕</button>
    </div>
  );
}
