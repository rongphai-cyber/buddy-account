import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useSession } from '../../session';
import { flattenMenu, HUB_APPS, PASSWORD_RULE, TENANT_MODULES, type TenantModuleKey } from '@buddy/core';
import { Confirm, cx, ErrorBox, Field, Modal, PageHead, PasswordInput, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';
import { MasterBar, useRowSelect } from '../../components/MasterBar';
import { QrCode } from './TwoFactor';

interface User { id: string; username: string; display_name: string; status: string; approval_level: number; check_rights: boolean; last_login_at: string | null; user_group_id: string | null; group_code: string | null; group_name: string | null; companies: string[]; mfa_enabled?: boolean; locked_until?: string | null; app_access?: TenantModuleKey[] | null; single_session?: boolean; rights_in?: string[]; has_password?: boolean; invite_expires_at?: string | null; tenant_id?: string | null }
type GroupRight = { menu: string; can_read: string; can_add: string; can_edit: string; can_cancel: string; can_delete: string; can_print: string; can_approve: string };
interface Group { id: string; code: string; name: string; rights_in?: string[]; tenant_id?: string | null; tenant_code?: string | null; rights?: GroupRight[] }
/**
 * ป้ายระดับอนุมัติ (HANDOFF 191 · 197 · 198) — ระดับ = อำนาจอนุมัติ ยิ่งสูงยิ่งอนุมัติได้มาก
 * ทุกตัวเลือกต่างกัน (เจ้าของ 26/11/2569 "ระดับอนุมัติ ที่ซ้ำๆ กันชื่อเหมือนกันคืออะไร")
 */
function levelLabel(i: number) {
  if (i >= 9) return '9 · ผู้มีอำนาจสูงสุด';
  if (i >= 5) return `${i} · หัวหน้า ระดับ ${i}`;
  return `${i} · พนักงาน ระดับ ${i}`;
}
/** ระดับอนุมัติในคำของเจ้าของ (HANDOFF 197 ข้อ 4 "ระดับการอนุมัติเรื่องของการอนุมัติการออกเอกสาร … อนุมัติการยกเลิก ลบ ปร้ินต์ เอกสาร อนุมัติวงเงิน ของผุ้มีอำนาจที่สูงกว่า") */
const LEVEL_HELP = (
  <ul className="small level-help">
    <li>ระดับอนุมัติ = <b>อำนาจอนุมัติ</b> ของผู้ใช้ — สิทธิ์รายเมนู (กลุ่ม) บอกว่า<b>ทำอะไรได้</b> · ระดับบอกว่า<b>อนุมัติได้แค่ไหน</b> เรื่องที่ต้องให้ผู้มีอำนาจสูงกว่าอนุมัติ</li>
    <li><b>0–4</b> อ่าน เพิ่ม แก้ไข พิมพ์ — ตัวเลขใช้กับเงื่อนไขอนุมัติที่ตั้งไว้ เช่น รับรองเอกสารก่อนพิมพ์ พิมพ์ซ้ำ ขายเกินวงเงิน ขายให้ลูกค้าที่ระงับ</li>
    <li><b>5–8</b> + ยกเลิก ลบ รับรองเอกสาร กำหนดค่าโปรแกรม ปิดงวด ระบบเงินเดือน</li>
    <li><b>9</b> ทุกอย่าง รวมระบบความปลอดภัย (ผู้ใช้/สิทธิ์ AI อ่านบิล PDPA บันทึกการใช้งาน แบบฟอร์ม)</li>
    <li className="muted">ตั้งเงื่อนไขอนุมัติได้ที่ ประเภทเอกสาร (รับรองก่อนพิมพ์ · พิมพ์ซ้ำ) และค่าเริ่มต้นระบบขาย/ซื้อ (ขายเกินวงเงิน · ลูกค้า/ผู้จำหน่ายถูกระงับ)</li>
  </ul>
);
interface LevelUses { docs: Array<{ code: string; name: string; approve_level: number | null; reprint_level: number | null }>; books: Array<{ code: string; prefix: string; name: string; approve_level: number | null; reprint_level: number | null }>; over_credit_level: number | null; ar_hold_level: number | null; ap_hold_level: number | null }
type LevelUse = { text: string; lv: number };
/** รหัสเอกสารที่ใช้ระดับเดียวกัน รวมเป็นข้อเดียว เช่น "รับรอง IV RE ต้องระดับ 6" */
function byLevel(rows: Array<{ code: string; lv: number | null }>, word: string): LevelUse[] {
  const m = new Map<number, string[]>();
  for (const r of rows) if (r.lv && r.lv > 0) m.set(r.lv, [...(m.get(r.lv) ?? []), r.code]);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([lv, codes]) => ({ lv, text: `${word} ${codes.length > 4 ? `${codes.slice(0, 4).join(' ')} …` : codes.join(' ')} ต้องระดับ ${lv}` }));
}
/** เรื่องที่บริษัทนี้กำหนดระดับอนุมัติไว้ (HANDOFF 198 · อ่านอย่างเดียว จากบริษัทที่เลือกอยู่) */
function levelUses(d: LevelUses): LevelUse[] {
  const out = [
    ...byLevel(d.docs.map((x) => ({ code: x.code, lv: x.approve_level })), 'รับรอง'),
    ...byLevel(d.docs.map((x) => ({ code: x.code, lv: x.reprint_level })), 'พิมพ์ซ้ำ'),
    ...byLevel(d.books.map((x) => ({ code: x.prefix, lv: x.approve_level })), 'รับรองใบสำคัญ'),
    ...byLevel(d.books.map((x) => ({ code: x.prefix, lv: x.reprint_level })), 'พิมพ์ใบสำคัญซ้ำ'),
  ];
  if (d.over_credit_level) out.push({ lv: d.over_credit_level, text: `ขายเกินวงเงินต้องระดับ ${d.over_credit_level}` });
  if (d.ar_hold_level) out.push({ lv: d.ar_hold_level, text: `ขายให้ลูกค้าที่ถูกระงับต้องระดับ ${d.ar_hold_level}` });
  if (d.ap_hold_level) out.push({ lv: d.ap_hold_level, text: `จ่ายผู้จำหน่ายที่ถูกระงับต้องระดับ ${d.ap_hold_level}` });
  return out;
}
/**
 * คำอธิบายใต้ช่องระดับอนุมัติ (HANDOFF 198 เจ้าของ ข้อ 2): เลขยิ่งสูงอนุมัติได้มาก · ตั้งได้ที่ไหน (เปิดแท็บใหม่ — ฟอร์มนี้ไม่หาย)
 * + เรื่องที่บริษัทนี้กำหนดระดับไว้ — สีแดง = ระดับที่เลือกยังทำเรื่องนั้นไม่ได้
 */
function LevelHint({ level }: { level: number }) {
  const { me } = useSession();
  const q = useQuery({ enabled: !!me?.company, queryKey: ['level-uses', me?.company?.id], queryFn: () => api.get<LevelUses>('/api/v1/permissions/level-uses') });
  const uses = q.data ? levelUses(q.data) : [];
  return (
    <div className="level-hint">
      <div>เลขยิ่งสูง อนุมัติได้มากกว่า · กำหนดว่าเรื่องไหนต้องใช้ระดับเท่าไรที่ <a href="/settings/doc-types" target="_blank" rel="noopener">ประเภทเอกสาร</a> (ระดับรับรอง/พิมพ์ซ้ำ) และ ค่าเริ่มต้นระบบ<a href="/settings/defaults?s=AR" target="_blank" rel="noopener">ขาย</a>/<a href="/settings/defaults?s=AP" target="_blank" rel="noopener">ซื้อ</a> (เกินวงเงิน/ลูกค้าระงับ)</div>
      {uses.length > 0 && <div className="level-uses"><b>ในบริษัทนี้:</b> {uses.map((x, i) => <span key={i} className={cx(x.lv > level && 'bad')} title={x.lv > level ? levelShort(level) : undefined}>{i > 0 && ' · '}{x.text}</span>)}</div>}
      <details><summary>ระดับทำอะไรได้บ้าง</summary>{LEVEL_HELP}</details>
    </div>
  );
}
function levelShort(level: number) { return `ระดับ ${level} ที่เลือกยังทำเรื่องนี้ไม่ได้`; }
/** ป้ายปุ่มสิทธิ์เพิ่มเติมของผู้ใช้ (HANDOFF 198 เจ้าของ ข้อ 4 "เพิ่มเติมอะไรก็คลิกดูชื่อผู้ใช้นั้น") */
function rightsButton(groupCode?: string) {
  if (groupCode) return `สิทธิ์เพิ่มเติมของผู้ใช้นี้ (ปรับจากกลุ่ม ${groupCode}) ›`;
  return 'สิทธิ์เพิ่มเติมของผู้ใช้นี้ (ปรับจากระดับอนุมัติ) ›';
}
/** เมนูที่ไม่มีสิทธิ์ (เดิม "ตรวจสอบสิทธิ์" — HANDOFF 197 ข้อ 5): สิทธิ์จริงมาจากกลุ่ม/สิทธิ์รายเมนูเสมอ ตัวเลือกนี้บอกแค่ว่าซ่อนหรือแสดงจาง */
const RIGHTS_HELP = (
  <ul className="small level-help">
    <li>สิทธิ์ที่ใช้ได้จริง = สิทธิ์ของ<b>กลุ่ม</b> + ช่องที่ปรับเพิ่มใน<b>สิทธิ์รายเมนู</b>ของผู้ใช้ (ไม่มีกลุ่ม = ตามระดับอนุมัติ)</li>
    <li><b>แสดงแบบจาง</b> = เห็นทุกเมนู เมนูที่ไม่มีสิทธิ์เป็นสีจาง กดแล้วบอกเหตุผล</li>
    <li><b>ซ่อน</b> = ไม่เห็นเมนูที่ไม่มีสิทธิ์ · ไม่มีกลุ่มและไม่ได้ตั้งสิทธิ์รายเมนู = ใช้อะไรไม่ได้</li>
  </ul>
);
const MENU_LABEL = new Map<string, string>([['ALL', 'ทุกระบบงาน'], ...flattenMenu().map((m) => [m.code, m.label] as [string, string])]);
const ACT_TH: Array<[keyof GroupRight, string]> = [['can_read', 'อ่าน'], ['can_add', 'เพิ่ม'], ['can_edit', 'แก้ไข'], ['can_cancel', 'ยกเลิก'], ['can_delete', 'ลบ'], ['can_print', 'พิมพ์'], ['can_approve', 'รับรอง']];
/** สิทธิ์ของกลุ่มในบริษัทที่เลือก บรรทัดเดียว (HANDOFF 197 ข้อ 7) เช่น "ขาย: อ่าน เพิ่ม แก้ไข ยกเลิก พิมพ์ · สินค้าคงเหลือ: อ่าน พิมพ์" */
function groupSummary(rights: GroupRight[]) {
  const parts = rights.map((r) => {
    const acts = ACT_TH.filter(([c]) => r[c] === 'Y' || r[c] === 'L' || r[c] === 'S').map(([c, th]) => (r[c] === 'S' ? `${th}ออกจอ` : th));
    return acts.length ? `${MENU_LABEL.get(r.menu) ?? r.menu}: ${acts.join(' ')}` : null;
  }).filter(Boolean) as string[];
  return parts.length > 6 ? `${parts.slice(0, 6).join(' · ')} · และอีก ${parts.length - 6} เมนู` : parts.join(' · ');
}
/** ระดับอนุมัติที่กลุ่มต้องใช้ (เงินเดือน 5 · ยกเลิก/ลบ/รับรอง 5) — เตือนเมื่อระดับของผู้ใช้ต่ำกว่า */
function groupNeedsLevel(rights: GroupRight[]) {
  const on = (v: string) => v === 'Y' || v === 'L';
  const pay = rights.some((r) => (r.menu === 'PAY' || r.menu.startsWith('PAY.')) && on(r.can_read));
  const high = rights.some((r) => on(r.can_cancel) || on(r.can_delete) || on(r.can_approve));
  return { pay, high };
}
interface TenantSecurity { require_mfa: boolean; service_requires_mfa?: boolean; single_session?: boolean; users: number; without_mfa: number }
type InviteLink = { url: string; expires_at: string; hours: number; username: string; display_name: string; reissued?: boolean };
const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

/**
 * ลิงก์เชิญ (HANDOFF 184): แสดงครั้งเดียว (ระบบเก็บเฉพาะ hash) — คัดลอก / QR / ส่งทาง LINE · ใช้ได้ครั้งเดียว หมดอายุตามที่แสดง
 */
function InviteDialog({ link, onClose }: { link: InviteLink; onClose: () => void }) {
  const msg = `เชิญใช้ Buddy Account — รหัสผู้ใช้ ${link.username}\nเปิดลิงก์นี้เพื่อตั้งรหัสผ่านของคุณ (ใช้ได้ครั้งเดียว ถึง ${when(link.expires_at)}):\n${link.url}`;
  const copy = (t: string, ok: string) => navigator.clipboard?.writeText(t).then(() => toast(ok)).catch(() => toast('คัดลอกไม่ได้ — เลือกข้อความในช่องแล้วกด Ctrl+C', 'warn'));
  return (
    <Modal title={`ลิงก์เชิญ ${link.username}`} onClose={onClose} footer={<button className="primary" autoFocus onClick={onClose}>ปิด</button>}>
      <p>ส่งลิงก์นี้ให้ <b>{link.display_name}</b> ทาง LINE — เปิดแล้วตั้งรหัสผ่านเอง แล้วตั้งยืนยันตัวตนสองขั้นด้วยแอปในมือถือ · <b>ใช้ได้ครั้งเดียว ภายใน {link.hours} ชั่วโมง</b> (ถึง {when(link.expires_at)}){link.reissued && ' · ลิงก์เดิมใช้ไม่ได้แล้ว'}</p>
      <div className="invite-link">
        <input readOnly value={link.url} aria-label="ลิงก์เชิญ" onFocus={(e) => e.target.select()} />
        <button type="button" className="primary" onClick={() => copy(link.url, 'คัดลอกลิงก์แล้ว — วางในแชต LINE ได้เลย')}>คัดลอกลิงก์</button>
        <button type="button" onClick={() => copy(msg, 'คัดลอกข้อความเชิญแล้ว')}>คัดลอกพร้อมข้อความ</button>
        <a className="btn" href={`https://line.me/R/share?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer noopener">ส่งทาง LINE</a>
      </div>
      <div className="invite-qr"><QrCode text={link.url} label="QR code ของลิงก์เชิญ" /><p className="small muted">หรือให้พนักงานสแกน QR นี้ด้วยกล้องมือถือ</p></div>
      <p className="notebox">ลิงก์นี้แสดงครั้งเดียว — ระบบไม่เก็บลิงก์ไว้ ปิดหน้าต่างแล้วถ้าต้องการอีกให้กด "ออกลิงก์ใหม่" (ลิงก์เดิมจะใช้ไม่ได้) · คุณไม่เห็นรหัสผ่านที่พนักงานตั้ง</p>
    </Modal>
  );
}

/** ผู้ดูแลระบบของลูกค้า: บังคับยืนยันตัวตนสองขั้นทุกผู้ใช้ (HANDOFF 146 · ค่าเริ่มต้น ปิด · HANDOFF 184: ผู้ให้บริการบังคับทุกผู้ใช้แล้ว) */
function TenantMfaBox() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tenant-security'], queryFn: () => api.get<TenantSecurity>('/api/v1/tenant/security') });
  const [ask, setAsk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const save = async (on: boolean) => {
    setBusy(true); setErr(null);
    try { await api.put('/api/v1/tenant/security', { require_mfa: on }); toast(on ? 'บังคับยืนยันตัวตนสองขั้นทุกผู้ใช้แล้ว' : 'เลิกบังคับยืนยันตัวตนสองขั้นแล้ว (ผู้ดูแลระบบยังบังคับ)'); setAsk(null); qc.invalidateQueries({ queryKey: ['tenant-security'] }); qc.invalidateQueries({ queryKey: ['users'] }); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (!q.data) return null;
  if (q.data.service_requires_mfa) return (
    <fieldset className="box"><legend>ความปลอดภัยการเข้าระบบ</legend>
      <p>✅ <b>ทุกผู้ใช้ต้องตั้งยืนยันตัวตนสองขั้น</b> (แอป Google/Microsoft Authenticator บนมือถือ) — ผู้ที่ยังไม่ตั้ง ({q.data.without_mfa} จาก {q.data.users} คน) จะถูกพาไปหน้าตั้งค่าเมื่อเข้าระบบครั้งถัดไป · มือถือหาย: เปิดผู้ใช้นั้นแล้วกด "ล้างยืนยันตัวตนสองขั้น"</p>
      {q.data.single_session && <p className="small">ลูกค้านี้ตั้งไว้ 1 รหัสเข้าได้ทีละ 1 เครื่อง ทุกผู้ใช้ — เข้าระบบจากเครื่องใหม่ เครื่องเดิมจะออกจากระบบ (ผู้ให้บริการตั้ง)</p>}
    </fieldset>
  );
  return (
    <fieldset className="box"><legend>ความปลอดภัยการเข้าระบบ</legend>
      <label className="check"><input type="checkbox" checked={q.data.require_mfa} disabled={busy} onChange={(e) => setAsk(e.target.checked)} aria-label="บังคับยืนยันตัวตนสองขั้นทุกผู้ใช้" /> บังคับยืนยันตัวตนสองขั้นทุกผู้ใช้</label>
      <p className="small muted">{q.data.require_mfa ? `เปิดอยู่ — ผู้ใช้ที่ยังไม่ตั้ง (${q.data.without_mfa} จาก ${q.data.users} คน) จะถูกพาไปหน้าตั้งค่าทันทีหลังเข้าระบบ ก่อนใช้งานอื่น` : `ปิดอยู่ — บังคับเฉพาะผู้ดูแลระบบ · ผู้ใช้ที่ยังไม่ตั้ง ${q.data.without_mfa} จาก ${q.data.users} คน`} · ใช้แอป Google/Microsoft Authenticator บนมือถือ</p>
      {q.data.single_session && <p className="small">ลูกค้านี้ตั้งไว้ 1 รหัสเข้าได้ทีละ 1 เครื่อง ทุกผู้ใช้ — เข้าระบบจากเครื่องใหม่ เครื่องเดิมจะออกจากระบบ (ผู้ให้บริการตั้ง)</p>}
      <ErrorBox error={err} />
      {ask !== null && <Modal title={ask ? 'บังคับยืนยันตัวตนสองขั้นทุกผู้ใช้' : 'เลิกบังคับยืนยันตัวตนสองขั้น'} size="confirm" onClose={() => setAsk(null)}
        footer={<><button onClick={() => setAsk(null)}>ยกเลิก</button><button className="primary" autoFocus disabled={busy} onClick={() => save(ask)}>{busy ? 'กำลังบันทึก…' : 'ยืนยัน'}</button></>}>
        <p>{ask ? `ผู้ใช้ทุกคนของกิจการต้องตั้งยืนยันตัวตนสองขั้น — ผู้ที่ยังไม่ตั้ง (${q.data.without_mfa} คน) และ session ที่เปิดอยู่ จะถูกพาไปหน้าตั้งค่าทันทีในการใช้งานครั้งถัดไป · ถ้าคุณเองยังไม่ตั้ง ต้องตั้งก่อนใช้งานต่อ` : 'ผู้ใช้ทั่วไปจะเลือกเปิด/ปิดยืนยันตัวตนสองขั้นเองได้ · ผู้ดูแลระบบยังบังคับเหมือนเดิม'}</p>
      </Modal>}
    </fieldset>
  );
}

/** แท็บที่เปิดล่าสุดของหน้าผู้ใช้งานระบบ (จำในเครื่อง · เปิดไม่ได้ = ค่าเริ่มต้น) */
const TAB_KEY = 'buddy.users.tab';
const readTab = () => { try { return localStorage.getItem(TAB_KEY); } catch { return null; } };
const keepTab = (t: string) => { try { localStorage.setItem(TAB_KEY, t); } catch { /* ไม่มีที่เก็บในเครื่อง */ } };

/**
 * ผู้ใช้งานและสิทธิ์ — คู่มือบทที่ 23 S-SEC-01/02 · HANDOFF 198 (เจ้าของ 26/11/2569 "หน้าผู้ใช้ระบบ ควรจะแสดง เมนูรายการของกลุ่ม … จะเพิ่มกลุ่มก็ควรอยู่หน้านั้น")
 * 2 แท็บในหน้าเดียว: กลุ่มผู้ใช้ (สิทธิ์ของกลุ่ม = ค่าตั้งต้น) · ผู้ใช้ (สิทธิ์เพิ่มเติมรายคน เปิดจากแฟ้มผู้ใช้)
 */
export function UsersPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ enabled: !!me?.user.is_admin, queryKey: ['users'], queryFn: () => api.get<{ users: User[]; groups: Group[]; mfa_all?: boolean }>('/api/v1/users') });
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const urlTab = sp.get('tab');
  const [tab, setTabState] = useState(urlTab === 'groups' || urlTab === 'users' ? urlTab : readTab() === 'users' ? 'users' : 'groups');
  const setTab = (t: string) => { setTabState(t); keepTab(t); setSp((x) => { x.set('tab', t); x.delete('edit'); return x; }, { replace: true }); };
  const [edit, setEdit] = useState<User | 'new' | null>(null);
  // ?edit=<ผู้ใช้> — กลับจากตารางสิทธิ์เพิ่มเติมของผู้ใช้ เปิดแฟ้มผู้ใช้นั้นต่อ
  const editId = sp.get('edit');
  useEffect(() => { if (editId && q.data) { const u = q.data.users.find((x) => x.id === editId); if (u) { setTabState('users'); setEdit(u); } setSp((x) => { x.delete('edit'); return x; }, { replace: true }); } }, [editId, q.data, setSp]);
  const [link, setLink] = useState<InviteLink | null>(null);
  const rs = useRowSelect(q.data?.users);
  const sec = useQuery({ enabled: !!me?.user.is_admin && !!me?.user.tenant_id, queryKey: ['tenant-security'], queryFn: () => api.get<TenantSecurity>('/api/v1/tenant/security') });
  const mfaAll = !!sec.data?.require_mfa || !!q.data?.mfa_all;
  if (!me?.user.is_admin) return <div className="page"><div className="notebox">เฉพาะผู้ดูแลระบบ</div></div>;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ผู้ใช้งานและสิทธิ์" title="ผู้ใช้งานระบบ" lead="กลุ่มผู้ใช้กำหนดสิทธิ์ตั้งต้น — ผู้ใช้ได้สิทธิ์ของกลุ่ม แล้วปรับเพิ่มเฉพาะคนได้จากแฟ้มผู้ใช้ (ไม่มีกลุ่ม = ตามระดับอนุมัติ) · กลุ่ม ADMIN เข้าได้ทุกบริษัทและทุกเมนู · สิทธิ์แยกแต่ละบริษัท"
        actions={<button onClick={() => nav('/settings/permissions?menu=1')} title="ดูว่ากลุ่ม/ผู้ใช้ใดได้สิทธิ์อะไรในแต่ละเมนู">สิทธิ์ตามเมนู</button>} />
      <ErrorBox error={q.error} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'groups', label: 'กลุ่มผู้ใช้', badge: q.data ? groupsHere(q.data.groups, me).length : undefined }, { key: 'users', label: 'ผู้ใช้', badge: q.data?.users.length }]} />
      {tab === 'groups' && q.data && <GroupsTab groups={q.data.groups} users={q.data.users} onChanged={() => qc.invalidateQueries({ queryKey: ['users'] })} />}
      {tab === 'users' && <>
      {me.user.tenant_id && <TenantMfaBox />}
      <MasterBar rs={rs} word="ผู้ใช้" label={(u) => `${u.username} ${u.display_name}`} onAdd={() => setEdit('new')} onEdit={(u) => setEdit(u)} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>รหัสผู้ใช้</th><th>ชื่อ</th><th>กลุ่ม</th><th className="c">ระดับอนุมัติ</th><th>สิทธิ์รายเมนู</th><th>บริษัทที่เข้าได้</th><th>โปรแกรมที่เปิดได้</th><th>เข้าระบบล่าสุด</th><th>ยืนยันสองขั้น</th><th>สถานะ</th></tr></thead>
          <tbody>
            {q.data?.users.map((u, i) => (
              <tr key={u.id} className={cx('row-open', u.status === 'I' && 'void', rs.cls(i))} onClick={() => { rs.setSel(i); setEdit(u); }} onMouseEnter={rs.hover(i)}>
                <td className="mono">{u.username}</td><td>{u.display_name}</td><td>{u.group_code ? <Pill tone={u.group_code === 'ADMIN' ? 'n' : 'x'}>{u.group_name}</Pill> : ''}</td><td className="c">{u.approval_level}</td><td>{u.group_code === 'ADMIN' ? '' : <RightsCell u={u} onOpen={() => nav(`/settings/permissions?user=${u.id}`)} />}</td>
                <td className="small">{u.group_code === 'ADMIN' ? 'ทุกบริษัท' : u.companies.map((c) => me.companies.find((x) => x.id === c)?.code ?? '?').join(', ')}</td>
                <td className="small">{appsText(u)}</td>
                <td className="small">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('th-TH') : '—'}</td>
                <td>{u.mfa_enabled ? <Pill tone="n">เปิด</Pill> : u.group_code === 'ADMIN' || mfaAll ? <Pill tone="d">ยังไม่ตั้ง</Pill> : <span className="muted">—</span>}</td>
                <td>{u.status === 'A' ? 'ใช้งาน' : 'ระงับ'}{u.has_password === false && <> <Pill tone={u.invite_expires_at ? 'm' : 'd'}>{u.invite_expires_at ? `รอตั้งรหัสผ่าน (ลิงก์ถึง ${when(u.invite_expires_at)})` : 'ยังไม่ตั้งรหัสผ่าน — ออกลิงก์เชิญ'}</Pill></>}{u.locked_until &&<> <Pill tone="c">ล็อกถึง {new Date(u.locked_until).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</Pill></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>}
      {edit && q.data && <UserForm u={edit === 'new' ? null : edit} groups={q.data.groups} tenantOne={!!sec.data?.single_session} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['users'] }); }}
        onLink={(l) => { setEdit(null); setLink(l); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
      {link && <InviteDialog link={link} onClose={() => setLink(null)} />}
    </div>
  );
}

/** ข้อความยืนยันลบกลุ่ม */
function deleteGroupText(g: Group) { return `ลบกลุ่ม ${g.code} ${g.name} พร้อมสิทธิ์ของกลุ่มทุกบริษัท — กลุ่มนี้ไม่มีผู้ใช้`; }
/** กลุ่มของลูกค้าเจ้าของบริษัทที่เลือกอยู่ (ผู้ให้บริการเห็นทุกลูกค้า — แท็บกลุ่มแสดงเฉพาะลูกค้ารายนี้ ตรงกับตารางสิทธิ์) */
function groupsHere(groups: Group[], me: ReturnType<typeof useSession>['me']) {
  const t = me?.companies.find((c) => c.id === me.company?.id)?.tenant_id ?? null;
  return groups.filter((g) => (g.tenant_id ?? null) === t);
}

/**
 * แท็บกลุ่มผู้ใช้ (HANDOFF 198): รหัส ชื่อ จำนวนสมาชิก สิทธิ์ในบริษัทนี้ 1 บรรทัด · คลิกแถว = ตารางสิทธิ์ของกลุ่ม (Esc กลับมาแท็บนี้)
 * เพิ่มกลุ่ม · กลุ่มตั้งต้น · เปลี่ยนชื่อ · ลบ (เฉพาะกลุ่มที่ไม่มีสมาชิก)
 */
function GroupsTab({ groups, users, onChanged }: { groups: Group[]; users: User[]; onChanged: () => void }) {
  const { me } = useSession();
  const nav = useNavigate();
  const list = groupsHere(groups, me);
  const rs = useRowSelect(list);
  const [form, setForm] = useState<Group | 'new' | null>(null);
  const [std, setStd] = useState(false);
  const members = (g: Group) => users.filter((u) => u.user_group_id === g.id);
  const open = (g: Group) => {
    if (g.code === 'ADMIN') { toast('กลุ่ม ADMIN ได้ทุกเมนูทุกบริษัทเสมอ — ไม่ต้องกำหนดสิทธิ์ (เปลี่ยนชื่อได้ที่ปุ่ม "เปลี่ยนชื่อ")', 'warn'); return; }
    nav(`/settings/permissions?s=G:${g.id}`);
  };
  const addStandard = () => { setStd(false); api.post<{ created: string[]; rows: number }>('/api/v1/user-groups/standard').then((r) => { toast(r.created.length ? `เพิ่มกลุ่มตั้งต้น ${r.created.join(' ')} แล้ว (${r.rows} แถวสิทธิ์)` : r.rows ? `เพิ่มสิทธิ์ของกลุ่มตั้งต้นในบริษัทที่ยังไม่มีแล้ว (${r.rows} แถว)` : 'มีกลุ่มตั้งต้นครบแล้ว — ไม่ได้เปลี่ยนอะไร'); onChanged(); }).catch(toastError); };
  const row = rs.row;
  const busyGroup = !!row && (row.code === 'ADMIN' || members(row).length > 0);
  return (
    <>
      <MasterBar rs={rs} word="กลุ่ม" label={(g) => `${g.code} ${g.name}`} onAdd={() => setForm('new')} onEdit={open} editWord="สิทธิ์ของกลุ่ม" canDelete={!busyGroup}
        onDelete={(g) => api.del(`/api/v1/user-groups/${g.id}`).then(onChanged)}
        deleteText={deleteGroupText}
        extra={<>
          <button type="button" disabled={!row} onClick={() => row && setForm(row)}>เปลี่ยนชื่อ</button>
          <button type="button" onClick={() => setStd(true)} title="ฝ่ายขาย ฝ่ายจัดซื้อ ฝ่ายบัญชี ฝ่ายการเงิน ฝ่ายธุรการ ฝ่ายบุคคล ดูอย่างเดียว — เพิ่มเฉพาะที่ยังไม่มี ไม่เขียนทับสิทธิ์ที่แก้แล้ว">+ กลุ่มตั้งต้น</button>
        </>} />
      {row && busyGroup && row.code !== 'ADMIN' && <p className="small muted">ลบกลุ่ม {row.code} ไม่ได้ — มีผู้ใช้ {members(row).length} คน ย้ายผู้ใช้ไปกลุ่มอื่นก่อน</p>}
      <div className="table-wrap">
        <table className="grid groups-grid">
          <thead><tr><th>รหัสกลุ่ม</th><th>ชื่อกลุ่ม</th><th className="r">สมาชิก</th><th>สิทธิ์ในบริษัท <span data-no-i18n>{me?.company?.code}</span> (คลิกเพื่อดู/แก้)</th></tr></thead>
          <tbody>
            {list.map((g, i) => {
              const m = members(g);
              const text = g.code === 'ADMIN' ? '' : groupSummary(g.rights ?? []);
              return (
                <tr key={g.id} className={cx('row-open', rs.cls(i))} onClick={() => { rs.setSel(i); open(g); }} onMouseEnter={rs.hover(i)}>
                  <td className="mono">{g.code}</td><td>{g.name}</td>
                  <td className="r" title={m.map((u) => u.username).join(', ')}>{m.length || <span className="muted">0</span>}</td>
                  <td className="small">{g.code === 'ADMIN' ? <span className="muted">ทุกเมนู ทุกบริษัท</span> : text || <span className="bad">ยังไม่มีสิทธิ์ในบริษัทนี้ — คลิกเพื่อกำหนด</span>}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={4} className="empty">ยังไม่มีกลุ่ม — กด "+ กลุ่มตั้งต้น" เพื่อเพิ่มกลุ่มพร้อมสิทธิ์ หรือ "+ เพิ่ม" เพื่อตั้งกลุ่มเอง</td></tr>}
          </tbody>
        </table>
      </div>
      {std && <Confirm title="เพิ่มกลุ่มตั้งต้น" onClose={() => setStd(false)} onOk={addStandard}
        text="เพิ่มกลุ่ม ฝ่ายขาย ฝ่ายจัดซื้อ ฝ่ายบัญชี ฝ่ายการเงิน ฝ่ายธุรการ ฝ่ายบุคคล ดูอย่างเดียว ที่ยังไม่มี พร้อมสิทธิ์ตั้งต้นในทุกบริษัท — กลุ่มและสิทธิ์ที่แก้ไว้แล้วไม่ถูกเขียนทับ" />}
      {form && <GroupForm g={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); onChanged(); if (form === 'new' && id) nav(`/settings/permissions?s=G:${id}`); }} />}
    </>
  );
}

function UserForm({ u, groups, tenantOne, onClose, onSaved, onLink }: { u: User | null; groups: Group[]; tenantOne?: boolean; onClose: () => void; onSaved: () => void; onLink: (l: InviteLink) => void }) {
  // ผู้ใช้ใหม่: ค่าเริ่มต้น = ให้ตั้งรหัสผ่านเองจากลิงก์เชิญ (HANDOFF 184 — ผู้ดูแลไม่ต้องรู้รหัสผ่าน)
  const [invite, setInvite] = useState(!u);
  const { me } = useSession();
  const [f, setF] = useState({ username: u?.username ?? '', display_name: u?.display_name ?? '', password: '', user_group_id: u?.user_group_id ?? '', approval_level: u?.approval_level ?? 0, check_rights: u?.check_rights ?? false, status: u?.status ?? 'A', companies: u?.companies ?? [] as string[], single_session: u?.single_session ?? false,
    app_access: (u?.app_access ?? null) as TenantModuleKey[] | null });
  const [err, setErr] = useState<unknown>(null);
  const [sec, setSec] = useState<null | 'unlock' | 'reset-2fa' | 'invite' | 'revoke'>(null);
  const nav = useNavigate();
  // ตรวจก่อนบันทึก (HANDOFF 159 · ข้อกำหนดเจ้าของ: ช่องบังคับเตือนและให้เลือก)
  const [noCompany, setNoCompany] = useState(false);
  const [askRights, setAskRights] = useState(false);
  const isAdminGroup = groups.find((g) => g.id === f.user_group_id)?.code === 'ADMIN';
  /**
   * กลุ่มต้องเป็นของลูกค้ารายเดียวกับผู้ใช้ (HANDOFF 191): ผู้ใช้เดิม = ลูกค้าของผู้ใช้ · ผู้ใช้ใหม่ = ลูกค้าของบริษัทที่ติ๊ก (หรือของกลุ่มที่เลือกไว้ก่อน)
   * undefined = ยังไม่รู้ (ผู้ให้บริการยังไม่ได้ติ๊กบริษัท) · null = เจ้าหน้าที่ผู้ให้บริการ
   */
  const coTenant = (id: string) => me?.companies.find((c) => c.id === id)?.tenant_id ?? null;
  const multiTenant = new Set(groups.map((g) => g.tenant_id ?? null)).size > 1;
  const tenantOf = (companies: string[], groupId: string): string | null | undefined => (u ? u.tenant_id ?? null
    : companies.length ? coTenant(companies[0]!) : groupId ? groups.find((g) => g.id === groupId)?.tenant_id ?? null : undefined);
  const formTenant = tenantOf(f.companies, f.user_group_id);
  const tenantName = (t: string | null) => (t ? groups.find((g) => g.tenant_id === t)?.tenant_code ?? 'ลูกค้า' : 'ผู้ให้บริการ');
  const shownGroups = formTenant === undefined ? groups : groups.filter((g) => (g.tenant_id ?? null) === formTenant);
  const tenantGroups = [...new Set(groups.map((g) => g.tenant_id ?? null))];
  /** เลือกกลุ่ม: สิทธิ์ของกลุ่มเป็นค่าตั้งต้นของผู้ใช้ทันที (HANDOFF 197 — ไม่ต้องเปิด "ตรวจสอบสิทธิ์" อีก) */
  const pickGroup = (id: string) => setF({ ...f, user_group_id: id });
  const pickedGroup = groups.find((g) => g.id === f.user_group_id);
  /** ติ๊กบริษัท: กลุ่มที่เลือกไว้เป็นของลูกค้ารายอื่น → ล้างกลุ่ม */
  const tickCompany = (id: string, on: boolean) => {
    const companies = on ? [...f.companies, id] : f.companies.filter((x) => x !== id);
    const t = tenantOf(companies, '');
    const g = groups.find((x) => x.id === f.user_group_id);
    const clear = !!g && t !== undefined && (g.tenant_id ?? null) !== t;
    if (clear) toast(`ล้างกลุ่ม ${g!.code} — เป็นกลุ่มของ ${tenantName(g!.tenant_id ?? null)} ไม่ใช่ลูกค้าของบริษัทที่ติ๊ก · เลือกกลุ่มใหม่`, 'warn');
    setF({ ...f, companies, ...(clear ? { user_group_id: '' } : {}) });
  };
  const runSec = () => {
    const k = sec; setSec(null);
    if (k === 'invite') { api.post<InviteLink>(`/api/v1/users/${u!.id}/invite`).then(onLink).catch(setErr); return; }
    if (k === 'revoke') { api.del(`/api/v1/users/${u!.id}/invite`).then(() => { toast('ยกเลิกลิงก์เชิญแล้ว — ลิงก์เดิมใช้ไม่ได้'); onSaved(); }).catch(setErr); return; }
    api.post(`/api/v1/users/${u!.id}/${k}`).then(() => { toast(k === 'unlock' ? 'ปลดล็อกแล้ว' : 'ล้างยืนยันตัวตนสองขั้นแล้ว — ผู้ใช้ต้องเข้าระบบใหม่และตั้งใหม่'); onSaved(); }).catch(setErr);
  };
  const send = (body: typeof f) => (u ? api.put<{ id: string }>(`/api/v1/users/${u.id}`, { ...body, password: body.password || undefined, user_group_id: body.user_group_id || null })
    : api.post<{ id: string }>('/api/v1/users', { ...body, password: invite ? undefined : body.password, invite, user_group_id: body.user_group_id || null }));
  const done = (r?: { id: string }) => {
    if (!u && invite && r?.id) { api.post<InviteLink>(`/api/v1/users/${r.id}/invite`).then((l) => { toast('เพิ่มผู้ใช้แล้ว — ส่งลิงก์เชิญให้ผู้ใช้'); onLink(l); }).catch((e) => { setErr(e); onSaved(); }); return; }
    toast('บันทึกผู้ใช้แล้ว'); onSaved();
  };
  /** มีแถวสิทธิ์รายเมนู (ของผู้ใช้หรือกลุ่ม) ในบริษัทที่ติ๊กอย่างน้อย 1 บริษัท */
  const hasRights = () => { const g = groups.find((x) => x.id === f.user_group_id); const inCo = [...(u?.rights_in ?? []), ...(g?.rights_in ?? [])]; return f.companies.some((c) => inCo.includes(c)); };
  const save = () => {
    setErr(null);
    if (!isAdminGroup && !f.companies.length) { setNoCompany(true); toast('ยังไม่ได้เลือกบริษัทที่เข้าได้ — ติ๊กบริษัทอย่างน้อย 1 บริษัท', 'warn'); return; }
    if (f.check_rights && !isAdminGroup && !hasRights()) { setAskRights(true); return; }
    send(f).then(done).catch(setErr);
  };
  // (ก) เปลี่ยนเป็นไม่ตรวจสอบสิทธิ์ แล้วบันทึก · (ข) บันทึก แล้วไปกำหนดสิทธิ์รายเมนูของผู้ใช้นี้
  const saveAsLevel = () => { setAskRights(false); const next = { ...f, check_rights: false }; setF(next); send(next).then(done).catch(setErr); };
  const saveThenRights = () => { setAskRights(false); send(f).then((r) => { toast('บันทึกผู้ใช้แล้ว — กำหนดสิทธิ์รายเมนูของผู้ใช้นี้ต่อ'); onSaved(); nav(`/settings/permissions?user=${r.id}`); }).catch(setErr); };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  /** สิทธิ์เพิ่มเติมของผู้ใช้นี้ — ตารางเดียวกับกลุ่ม: ช่องจากกลุ่มจาง · ช่องที่ปรับเพิ่มตัวหนา (แก้ค้างอยู่ = บันทึกก่อน เพื่อให้ตารางใช้กลุ่ม/ระดับล่าสุด) */
  const [initial] = useState(() => JSON.stringify(f));
  const dirty = JSON.stringify(f) !== initial;
  const openRights = () => {
    if (!u) return;
    if (!dirty) { onClose(); nav(`/settings/permissions?user=${u.id}`); return; }
    setErr(null);
    send(f).then(() => { toast('บันทึกผู้ใช้แล้ว — เปิดสิทธิ์เพิ่มเติมของผู้ใช้นี้'); onSaved(); nav(`/settings/permissions?user=${u.id}`); }).catch(setErr);
  };
  return (
    <Modal title={u ? `แก้ไขผู้ใช้ ${u.username}` : 'เพิ่มผู้ใช้'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสผู้ใช้" req><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="ชื่อผู้ใช้" req><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        {!u && <fieldset className="wide"><span className="lbl">รหัสผ่าน</span>
          <label className="inline chk"><input type="radio" name="pw-mode" checked={invite} onChange={() => setInvite(true)} /> ให้ผู้ใช้ตั้งรหัสผ่านเองจากลิงก์เชิญ (แนะนำ — ส่งทาง LINE · ผู้ดูแลไม่เห็นรหัสผ่าน)</label>
          <label className="inline chk"><input type="radio" name="pw-mode" checked={!invite} onChange={() => setInvite(false)} /> ตั้งรหัสผ่านเริ่มต้นเอง</label>
          {invite && <p className="hint">บันทึกแล้วจะได้ลิงก์ + QR ให้คัดลอกส่ง · ใช้ได้ครั้งเดียว ภายใน 72 ชั่วโมง · ผู้ใช้ตั้งรหัสผ่านแล้วตั้งยืนยันตัวตนสองขั้นต่อทันที</p>}
        </fieldset>}
        {!u && !invite && <Field label="รหัสผ่านเริ่มต้น" hint={PASSWORD_RULE} req><PasswordInput value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>}
        {u && <Field label="รีเซ็ตรหัสผ่าน (ผู้ดูแลตั้งให้ใหม่ · ว่าง = ไม่เปลี่ยน)" hint={<>{PASSWORD_RULE}{u.id !== me?.user.id && <ResetLinkHint u={u} onLink={() => setSec('invite')} />}</>}>
          <PasswordInput value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" aria-label="รีเซ็ตรหัสผ่าน" /></Field>}
        <Field label="กลุ่มผู้ใช้" hint={multiTenant && formTenant === undefined ? 'ติ๊กบริษัทที่เข้าได้ก่อน รายการจะเหลือเฉพาะกลุ่มของลูกค้ารายนั้น' : multiTenant ? `เฉพาะกลุ่มของ ${tenantName(formTenant ?? null)}` : undefined}>
          <select aria-label="กลุ่มผู้ใช้" value={f.user_group_id} onChange={(e) => pickGroup(e.target.value)}><option value="">— ไม่มีกลุ่ม —</option>
            {multiTenant && formTenant === undefined
              ? tenantGroups.map((t) => <optgroup key={t ?? '-'} label={tenantName(t)}>{groups.filter((g) => (g.tenant_id ?? null) === t).map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name} ({tenantName(t)})</option>)}</optgroup>)
              : shownGroups.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
          </select>
        </Field>
        <Field label="ระดับอนุมัติ" hint={<LevelHint level={f.approval_level} />}>
          <select aria-label="ระดับอนุมัติ" value={f.approval_level} onChange={(e) => setF({ ...f, approval_level: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{levelLabel(i)}</option>)}</select>
        </Field>
        {pickedGroup && !isAdminGroup && <GroupSummary g={pickedGroup} level={f.approval_level} onOpen={() => nav(`/settings/permissions?s=G:${pickedGroup.id}`)} onLevel={(n) => setF({ ...f, approval_level: n })} />}
        {u && !isAdminGroup && <div className="wide user-rights-open">
          <button type="button" className="primary" onClick={openRights}>{rightsButton(pickedGroup?.code)}</button>
          {' '}<span className="small muted">{rightsNote(!!u.rights_in?.includes(me?.company?.id ?? ''), dirty)}</span>
        </div>}
        <Field label="เมนูที่ไม่มีสิทธิ์" hint={RIGHTS_HELP}>
          <select aria-label="เมนูที่ไม่มีสิทธิ์" disabled={isAdminGroup} value={f.check_rights ? '1' : '0'} onChange={(e) => setF({ ...f, check_rights: e.target.value === '1' })}><option value="0">แสดงแบบจาง (กดแล้วบอกเหตุผล)</option><option value="1">ซ่อนเมนูที่ไม่มีสิทธิ์</option></select>
        </Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">ระงับ</option></select></Field>
        <Field label="เข้าระบบพร้อมกัน" hint={tenantOne ? 'ลูกค้านี้ตั้งไว้ 1 เครื่องทุกผู้ใช้ (ผู้ให้บริการตั้ง)' : '1 เครื่อง = เข้าระบบจากเครื่องใหม่ เครื่องเดิมออกจากระบบ (มีผลครั้งถัดไปที่เข้าระบบ)'}>
          <select value={tenantOne || f.single_session ? '1' : '0'} disabled={tenantOne} onChange={(e) => setF({ ...f, single_session: e.target.value === '1' })}><option value="0">หลายเครื่องพร้อมกันได้</option><option value="1">1 รหัสเข้าได้ทีละ 1 เครื่อง</option></select>
        </Field>
        <fieldset className={cx('wide', noCompany && !f.companies.length && !isAdminGroup && 'invalid')}><span className="lbl">บริษัทที่เข้าได้{!isAdminGroup && <b className="req" aria-hidden="true">*</b>}</span>
          {me?.companies.map((c) => {
            // บริษัทของลูกค้ารายอื่น (ผู้ให้บริการเห็นทุกราย): ติ๊กไม่ได้ — ผู้ใช้หนึ่งคนอยู่ได้ลูกค้ารายเดียว
            const other = formTenant !== undefined && (c.tenant_id ?? null) !== formTenant && !f.companies.includes(c.id);
            return <label key={c.id} className={cx('inline chk', other && 'muted')} title={other ? `เป็นบริษัทของ ${tenantName(c.tenant_id ?? null)} — ผู้ใช้นี้อยู่กับ ${tenantName(formTenant ?? null)}` : undefined}>
              <input type="checkbox" disabled={other} checked={f.companies.includes(c.id)} onChange={(e) => tickCompany(c.id, e.target.checked)} /> {c.code} {c.name_th}{multiTenant && <span className="muted small"> ({tenantName(c.tenant_id ?? null)})</span>}</label>;
          })}
          {isAdminGroup ? <p className="small muted">กลุ่ม ADMIN เข้าได้ทุกบริษัทของกิจการ</p>
            : noCompany && !f.companies.length && <p className="bad small" role="alert">ยังไม่ได้เลือกบริษัทที่เข้าได้ — ผู้ใช้นี้จะเข้าบริษัทใดไม่ได้ ติ๊กบริษัทอย่างน้อย 1 บริษัท</p>}
        </fieldset>
        <AppAccessField value={f.app_access} onChange={(v) => setF({ ...f, app_access: v })} admin={groups.find((g) => g.id === f.user_group_id)?.code === 'ADMIN'} />
        {u && u.id !== me?.user.id && (
          <fieldset className="wide"><span className="lbl">ความปลอดภัยการเข้าระบบ</span>
            {u.invite_expires_at && <button type="button" onClick={() => setSec('revoke')}>ยกเลิกลิงก์เชิญ</button>}{' '}
            {u.locked_until && <button type="button" onClick={() => setSec('unlock')}>ปลดล็อก (ใส่รหัสผิดเกิน 5 ครั้ง)</button>}{' '}
            {u.mfa_enabled && <button type="button" className="danger" onClick={() => setSec('reset-2fa')}>ล้างยืนยันตัวตนสองขั้น (มือถือหาย)</button>}
            {u.invite_expires_at && <p className="small muted">มีลิงก์เชิญที่ยังไม่ใช้ ถึง {when(u.invite_expires_at)}</p>}
            {!u.invite_expires_at && !u.locked_until && !u.mfa_enabled && <p className="small muted">ยังไม่ได้ตั้งยืนยันตัวตนสองขั้น — ผู้ใช้จะถูกพาไปตั้งเมื่อเข้าระบบ (ถ้าบังคับทุกผู้ใช้)</p>}
          </fieldset>
        )}
      </div>
      {askRights && <Modal title="ยังไม่ได้กำหนดสิทธิ์รายเมนู" size="confirm" onClose={() => setAskRights(false)} footer={<>
        <button onClick={() => setAskRights(false)}>กลับไปแก้ <kbd>Esc</kbd></button>
        <button onClick={saveAsLevel}>แสดงเมนูแบบจาง (ตามระดับอนุมัติ) แล้วบันทึก</button>
        <button className="primary" autoFocus onClick={saveThenRights}>บันทึก แล้วไปกำหนดสิทธิ์รายเมนู</button>
      </>}>
        <p>เลือก "ซ่อนเมนูที่ไม่มีสิทธิ์" แต่ทั้งผู้ใช้นี้{f.user_group_id ? 'และกลุ่มที่เลือก' : ''}ยังไม่มีสิทธิ์รายเมนูในบริษัทที่ติ๊กไว้ — ถ้าบันทึกเลย ผู้ใช้จะเปิดเมนูใดไม่ได้</p>
        <ul className="small">
          <li>เลือกกลุ่มตั้งต้น (ฝ่ายขาย ฝ่ายจัดซื้อ ฝ่ายบัญชี ฝ่ายการเงิน ฝ่ายธุรการ ฝ่ายบุคคล ดูอย่างเดียว) ซึ่งมีสิทธิ์รายเมนูพร้อมใช้ — กด "กลับไปแก้"</li>
          <li>หรือแสดงเมนูแบบจาง ใช้สิทธิ์ตามระดับอนุมัติ</li>
          <li>หรือบันทึก แล้วกำหนดสิทธิ์รายเมนูของผู้ใช้นี้ต่อทันที</li>
        </ul>
      </Modal>}
      {sec && <Confirm title={{ unlock: 'ปลดล็อกผู้ใช้', 'reset-2fa': 'ล้างยืนยันตัวตนสองขั้น', invite: u?.invite_expires_at ? 'ออกลิงก์เชิญใหม่' : 'สร้างลิงก์เชิญ', revoke: 'ยกเลิกลิงก์เชิญ' }[sec]}
        danger={sec === 'reset-2fa' || sec === 'revoke'} onClose={() => setSec(null)} onOk={runSec}
        text={{
          unlock: `ให้ ${u?.username} เข้าระบบได้ทันที`,
          'reset-2fa': `${u?.username} จะถูกออกจากระบบ และต้องตั้งยืนยันตัวตนสองขั้นใหม่ด้วยมือถือเครื่องใหม่ทันทีที่เข้าระบบครั้งถัดไป — ตรวจว่าเป็นเจ้าของบัญชีจริงก่อน`,
          invite: `${u?.username} จะตั้งรหัสผ่านใหม่เองจากลิงก์ (ใช้ได้ครั้งเดียว ภายใน 72 ชั่วโมง)${u?.invite_expires_at ? ' · ลิงก์เดิมจะใช้ไม่ได้' : ''}${u?.has_password ? ' · รหัสผ่านเดิมใช้ได้จนกว่าจะตั้งใหม่' : ''}`,
          revoke: `ลิงก์เชิญของ ${u?.username} จะใช้ไม่ได้ทันที`,
        }[sec]} />}
    </Modal>
  );
}

/** ข้อความข้างปุ่มสิทธิ์เพิ่มเติม */
function rightsNote(has: boolean, dirty: boolean) {
  const a = has ? 'มีช่องที่ปรับเพิ่มไว้ในบริษัทนี้' : 'ยังไม่ได้ปรับเพิ่มในบริษัทนี้ — ใช้ตามกลุ่ม';
  return dirty ? `${a} · กดแล้วบันทึกการแก้ไขก่อนเปิด` : a;
}
/**
 * ส่งลิงก์ให้ผู้ใช้ตั้งรหัสใหม่เอง (HANDOFF 198 เจ้าของ ข้อ 1) — ใช้ลิงก์เชิญเดิม (HANDOFF 184): ใช้ได้ครั้งเดียว 72 ชั่วโมง ผู้ดูแลไม่เห็นรหัสผ่าน
 * ผู้ใช้ที่เปิดยืนยันตัวตนสองขั้นแล้ว ส่งลิงก์ไม่ได้ (ลิงก์จะข้ามขั้นที่ 2) — ผู้ดูแลตั้งรหัสให้ใหม่ หรือถ้ามือถือหายด้วย ล้างยืนยันสองขั้นก่อน
 */
function ResetLinkHint({ u, onLink }: { u: User; onLink: () => void }) {
  if (u.status !== 'A') return <div className="small muted">ผู้ใช้ถูกระงับ — เปลี่ยนสถานะเป็น "ใช้งาน" ก่อนส่งลิงก์ตั้งรหัสผ่าน</div>;
  if (u.mfa_enabled) return <div className="small muted">ส่งลิงก์ให้ตั้งรหัสเองไม่ได้ — ผู้ใช้นี้เปิดยืนยันตัวตนสองขั้นแล้ว (ลิงก์จะข้ามขั้นที่ 2) · ตั้งรหัสให้ใหม่ในช่องนี้ หรือถ้ามือถือหายด้วย กด "ล้างยืนยันตัวตนสองขั้น" ก่อน</div>;
  return <div className="small">หรือ <button type="button" className="linklike" onClick={onLink}>{u.invite_expires_at ? 'ออกลิงก์ใหม่ให้ผู้ใช้ตั้งรหัสเอง' : 'ส่งลิงก์ให้ผู้ใช้ตั้งรหัสใหม่เอง'}</button> <span className="muted">(ส่งทาง LINE · ใช้ได้ครั้งเดียว 72 ชั่วโมง · คุณไม่เห็นรหัสผ่าน)</span></div>;
}

/** สรุปสิทธิ์ของกลุ่มที่เลือกในบริษัทที่เลือกอยู่ + ลิงก์ไปตารางสิทธิ์ของกลุ่ม + เตือนเมื่อระดับอนุมัติไม่พอ (HANDOFF 197 ข้อ 7) */
function GroupSummary({ g, level, onOpen, onLevel }: { g: Group; level: number; onOpen: () => void; onLevel: (n: number) => void }) {
  const { me } = useSession();
  const rights = g.rights ?? [];
  const text = groupSummary(rights);
  const need = groupNeedsLevel(rights);
  return (
    <div className="wide group-summary" role="note">
      <div><b>กลุ่ม {g.code} ทำได้</b> <span className="muted small">(บริษัท {me?.company?.code})</span>: {text || <span className="bad">ยังไม่มีสิทธิ์ในบริษัทนี้ — ผู้ใช้ใช้ได้ตามระดับอนุมัติ หรือกำหนดสิทธิ์ของกลุ่มก่อน</span>}
        {' '}<button type="button" className="linklike" onClick={onOpen}>ดู/แก้สิทธิ์ของกลุ่ม ›</button></div>
      {need.pay && level < 5 && <div className="warn-line small">⚠ ระบบเงินเดือนต้องระดับอนุมัติ 5 ขึ้นไป — ระดับ {level} จะเปิดเมนูเงินเดือนไม่ได้ <button type="button" className="linklike" onClick={() => onLevel(5)}>ตั้งระดับ 5</button></div>}
      {!need.pay && need.high && level < 5 && <div className="muted small">ยกเลิก/ลบ/รับรอง ที่กลุ่มให้ไว้ ใช้ได้เมื่อระดับอนุมัติ 5 ขึ้นไป</div>}
    </div>
  );
}

/** คอลัมน์ "สิทธิ์รายเมนู" ในรายการผู้ใช้: ได้สิทธิ์จากไหน + ซ่อนหรือแสดงจางเมนูที่ไม่มีสิทธิ์ */
function RightsCell({ u, onOpen }: { u: User; onOpen: () => void }) {
  const label = u.approval_level >= 9 && !u.check_rights ? 'ทุกอย่าง (ระดับ 9)' : u.group_code ? `ตามกลุ่ม ${u.group_code}` : u.rights_in?.length || u.check_rights ? 'ตามตารางสิทธิ์' : 'ตามระดับ';
  return <><button className="linklike" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{label}</button>{u.check_rights && <span className="muted small"> · ซ่อนเมนู</span>}</>;
}

/** เพิ่ม / เปลี่ยนชื่อกลุ่มผู้ใช้ (S-SEC-01) — เพิ่มแล้วไปตารางสิทธิ์ของกลุ่มต่อทันที · รหัสกลุ่มเปลี่ยนไม่ได้ */
function GroupForm({ g, onClose, onSaved }: { g: Group | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const [f, setF] = useState({ code: g?.code ?? '', name: g?.name ?? '' });
  const [err, setErr] = useState<unknown>(null);
  const save = () => (g ? api.put<{ id: string }>(`/api/v1/user-groups/${g.id}`, { name: f.name }) : api.post<{ id: string }>('/api/v1/user-groups', f))
    .then((r) => { toast(g ? 'เปลี่ยนชื่อกลุ่มแล้ว' : 'เพิ่มกลุ่มแล้ว — กำหนดสิทธิ์ของกลุ่มต่อ'); onSaved(r?.id); }).catch(setErr);
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title={g ? `แก้ไขกลุ่ม ${g.code}` : 'เพิ่มกลุ่มผู้ใช้'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสกลุ่ม" req={!g} hint={g ? 'รหัสกลุ่มเปลี่ยนไม่ได้' : 'ภาษาอังกฤษ/ตัวเลข เช่น ACC FIN'}><input autoFocus={!g} disabled={!!g} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="ชื่อกลุ่ม" req><input autoFocus={!!g} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="เช่น แผนกบัญชี" /></Field>
      </div>
    </Modal>
  );
}

/** ชื่อสั้นของโปรแกรม (Hub) */
const appName = (k: TenantModuleKey) => HUB_APPS[k].name;
/** คอลัมน์ "โปรแกรมที่เปิดได้" ในรายการผู้ใช้ */
function appsText(u: User) {
  if (u.group_code === 'ADMIN' || u.app_access == null) return <span className="muted">ทุกโปรแกรม</span>;
  if (!u.app_access.length) return <Pill tone="d">ยังไม่ให้เปิด</Pill>;
  return u.app_access.map(appName).join(', ');
}

/**
 * โปรแกรมที่ผู้ใช้เปิดได้จากหน้าเปิดโปรแกรม (Hub · เจ้าของ 09/11/2569) — ผู้ใช้เดิม = ทุกโปรแกรมที่ลูกค้าเปิดใช้
 * ไม่ติ๊ก Buddy Account = ผู้ใช้เห็นเฉพาะหน้าเปิดโปรแกรม (เช่น พนักงานหน้าร้าน) ไม่เห็นเมนูบัญชี
 */
function AppAccessField({ value, onChange, admin }: { value: TenantModuleKey[] | null; onChange: (v: TenantModuleKey[] | null) => void; admin: boolean }) {
  const mods = useQuery({ queryKey: ['tenant-modules'], queryFn: () => api.get<{ modules: Array<{ key: TenantModuleKey; active: boolean }> }>('/api/v1/tenant/modules') });
  const activeOf = (k: TenantModuleKey) => mods.data?.modules.find((m) => m.key === k)?.active ?? true;
  if (admin) return <fieldset className="wide"><span className="lbl">โปรแกรมที่เปิดได้</span><span className="muted">ผู้ดูแลระบบ (กลุ่ม ADMIN) เปิดได้ทุกโปรแกรมเสมอ</span></fieldset>;
  const pick = value ?? [];
  return (
    <fieldset className="wide" data-testid="app-access"><span className="lbl">โปรแกรมที่เปิดได้ (หน้าเปิดโปรแกรม ▦ WTS)</span>
      <label className="inline chk"><input type="radio" name="app-access-mode" checked={value === null} onChange={() => onChange(null)} /> ทุกโปรแกรมที่บริษัทเปิดใช้</label>
      <label className="inline chk"><input type="radio" name="app-access-mode" checked={value !== null} onChange={() => onChange(value ?? ['buddy'])} /> เฉพาะที่เลือก</label>
      {value !== null && <div className="app-access-list">
        {TENANT_MODULES.map((m) => (
          <label key={m.key} className="inline chk">
            <input type="checkbox" checked={pick.includes(m.key)} onChange={(e) => onChange(TENANT_MODULES.map((x) => x.key).filter((k) => (k === m.key ? e.target.checked : pick.includes(k))))} />
            {' '}{appName(m.key)}{!activeOf(m.key) && <span className="muted small"> (บริษัทยังไม่เปิดใช้)</span>}
          </label>
        ))}
        <p className="hint">ไม่ติ๊ก Buddy Account = ผู้ใช้เห็นเฉพาะหน้าเปิดโปรแกรม ไม่เห็นเมนูบัญชี (เช่น พนักงานหน้าร้าน) · ไม่ติ๊กเลย = เข้าระบบได้แต่ยังเปิดโปรแกรมใดไม่ได้</p>
      </div>}
    </fieldset>
  );
}
