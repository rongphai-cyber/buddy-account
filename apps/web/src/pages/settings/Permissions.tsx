import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type PermAction } from '../../api';
import { useSession } from '../../session';
import { cx, ErrorBox, KeyHints, Modal, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { PERM_COLS, permClear, permCompact, permConflicts, permInheritedCell, permMark, permOwn, permSet, type PermCol, type PermRowVals, type PermRows, type PermSource } from '@buddy/core';
import { useUnsaved } from '../../unsaved';

interface MenuRow { code: string; label: string; depth: number; group: boolean; admin_only?: boolean }
interface Subjects { users: Array<{ id: string; username: string; display_name: string; approval_level: number; check_rights: boolean; group_code: string | null }>; groups: Array<{ id: string; code: string; name: string }> }
type Vals = Record<string, string>;
type TableMode = 'strict' | 'adjust' | 'off';
interface PermView {
  subject: { code: string; name: string; approval_level: number | null; check_rights: boolean | null };
  company: { id: string; code?: string; name_th?: string };
  rows: Record<string, Vals>;
  group: { id: string; code: string; name: string; admin: boolean; rows: Record<string, Vals> } | null;
  effective: Record<string, Record<PermAction, boolean | 'S'>> | null;
  table_applies: TableMode | null;
  need: Record<string, Partial<Record<PermAction, number>>>;
}
const ACTS: Array<[PermAction, string, PermCol]> = [['read', 'อ่าน', 'can_read'], ['add', 'เพิ่ม', 'can_add'], ['edit', 'แก้ไข', 'can_edit'], ['cancel', 'ยกเลิก', 'can_cancel'], ['delete', 'ลบ', 'can_delete'], ['print', 'พิมพ์', 'can_print'], ['approve', 'รับรอง', 'can_approve']];
const EMPTY: Vals = Object.fromEntries(ACTS.map(([, , c]) => [c, '']));
/** แถวจาก API ('' = ไม่ได้ตั้ง) → เฉพาะช่องที่ตั้ง */
const compactRows = (rows: Record<string, Vals> | undefined): PermRows => permCompact((rows ?? {}) as PermRows);
/** ป้ายตัวเลือกที่ตั้งเอง — เครื่องหมาย + รหัส (HANDOFF 197 เจ้าของ ข้อ 6) */
function ownLabel(v: string) { return v === 'S' ? 'S จอ' : `${permMark(v)} ${v}`.replace('✓L L', '✓ L'); }

/**
 * สิทธิ์ 7 ชนิดรายเมนู — คู่มือบทที่ 23: ตามกลุ่ม (S-SEC-01 แท็บ F8) ตามผู้ใช้ (S-SEC-02 แท็บ F8) และตามเมนู (S-SEC-03)
 * HANDOFF 197 (เจ้าของ 26/11/2569): สิทธิ์ของกลุ่ม = ค่าตั้งต้นของผู้ใช้ · ผู้ใช้ปรับเพิ่มเองทีละช่อง · แยกแต่ละบริษัท (คัดลอกไปบริษัทอื่นได้)
 * ทุกช่องแสดงเครื่องหมายของค่าที่ได้ — ตั้งเอง = ตัวหนาสี · ได้จากกลุ่ม/เมนูหลัก/ระดับอนุมัติ = จาง (ชี้ดูที่มา) · เลือก "ตามกลุ่ม/ตามเมนูหลัก" = ล้างช่อง
 */
export function PermissionsPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('menu') ? 'menu' : 'subject');
  // ?user=<id> = สิทธิ์เพิ่มเติมของผู้ใช้ (HANDOFF 198 · เปิดจากแฟ้มผู้ใช้) — ที่อยู่เดิม ?s=U:<id> ยังใช้ได้
  const userParam = sp.get('user');
  useEffect(() => { if (userParam) setSp({ s: `U:${userParam}`, ...(sp.get('m') ? { m: sp.get('m')! } : {}) }, { replace: true }); }, [userParam, setSp]); // eslint-disable-line react-hooks/exhaustive-deps
  // ?m=<เมนู> = เลื่อนไปที่เมนูนั้นในตาราง (เปิดจากแท็บ "ใครใช้เมนูนี้ได้" · HANDOFF 200)
  const focusMenu = sp.get('m');
  const subject = sp.get('s') ?? (userParam ? `U:${userParam}` : '');   // G:<id> หรือ U:<id>
  const menus = useQuery({ queryKey: ['perm-menus'], queryFn: () => api.get<MenuRow[]>('/api/v1/permissions/menus') });
  // เฉพาะกลุ่ม/ผู้ใช้ของลูกค้าเจ้าของบริษัทที่เลือกอยู่ — ผู้ให้บริการก็เช่นกัน (HANDOFF 191)
  const subs = useQuery({ queryKey: ['users', 'company', me?.company?.id], queryFn: () => api.get<Subjects>('/api/v1/users', { for: 'company' }) });
  const [type, id] = subject ? (subject.split(':') as ['U' | 'G', string]) : [null, null];
  const cur = useQuery({ enabled: !!id, queryKey: ['perms', subject, me?.company?.id], queryFn: () => api.get<PermView>('/api/v1/permissions', { subject_type: type, subject_id: id }) });
  const [vals, setVals] = useState<PermRows>({});
  // ตั้งค่าที่เมนูหลักแล้วเมนูย่อยตั้งช่องนั้นไว้ต่าง → ถามก่อน (HANDOFF 161)
  const [ask, setAsk] = useState<{ code: string; set: PermRowVals; conflicts: string[] } | null>(null);
  const [copy, setCopy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (cur.data) { setVals(compactRows(cur.data.rows)); setDirty(false); } }, [cur.data]);
  useEffect(() => {
    if (!focusMenu || !cur.data || tab !== 'subject') return;
    const t = setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`.perm-grid tr[data-menu="${CSS.escape(focusMenu)}"]`);
      row?.scrollIntoView({ block: 'center' }); row?.querySelector<HTMLElement>('select')?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [focusMenu, cur.data, tab]);
  const groupRows = useMemo(() => (cur.data?.group && !cur.data.group.admin ? compactRows(cur.data.group.rows) : null), [cur.data]);
  const apply = (code: string, set: PermRowVals) => {
    const conflicts = permConflicts(vals, code, set);
    if (conflicts.length) { setAsk({ code, set, conflicts }); return; }
    setDirty(true); setVals((x) => permSet(x, code, set));
  };
  const decide = (mode: 'overwrite' | 'keep') => { if (!ask) return; const a = ask; setAsk(null); setDirty(true); setVals((x) => permSet(x, a.code, a.set, mode)); };
  const set = (code: string, col: PermCol, v: string) => (v ? apply(code, { [col]: v }) : (setDirty(true), setVals((x) => permSet(x, code, { [col]: '' }))));
  const setRow = (code: string, v: string) => {
    if (!v) { setDirty(true); setVals((x) => permClear(x, code)); return; }
    apply(code, Object.fromEntries(ACTS.map(([a, , c]) => [c, v === 'S' && a !== 'print' ? 'Y' : v])) as PermRowVals);
  };
  const labelOf = (code: string) => (code === 'ALL' ? 'ทุกระบบงาน' : menus.data?.find((m) => m.code === code)?.label ?? code);
  const save = async () => {
    if (!type || !id) return;
    setErr(null);
    try {
      // เก็บเฉพาะช่องที่ตั้งเอง (ช่องว่าง = ตามกลุ่ม/เมนูหลัก)
      const rows = Object.entries(permCompact(vals)).map(([menu_code, v]) => ({ menu_code, ...EMPTY, ...v }));
      // ที่อยู่เดียวกับตอนโหลด (มี subject ใน query) — รุ่นของตารางสิทธิ์ส่งกลับให้ตรวจแก้พร้อมกัน (HANDOFF 163)
      const r = await api.put<{ rows: number }>(`/api/v1/permissions?subject_type=${encodeURIComponent(type)}&subject_id=${encodeURIComponent(id)}`, { subject_type: type, subject_id: id, rows });
      toast(`บันทึกสิทธิ์แล้ว (${r.rows} เมนู)`);
      qc.invalidateQueries({ queryKey: ['perms'] }); qc.invalidateQueries({ queryKey: ['perm-by-menu'] }); qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) { setErr(e); }
  };
  // Esc กลับ: กลุ่ม → แท็บกลุ่มผู้ใช้ · ผู้ใช้ → เปิดแฟ้มผู้ใช้นั้นต่อ (HANDOFF 198)
  const back = () => nav(type === 'U' && id ? `/settings/users?tab=users&edit=${id}` : '/settings/users?tab=groups');
  useHotkeys({ F9: save, 'Ctrl+S': save, Escape: back }, [vals, type, id]);
  // ถามก่อนออกจากหน้าเมื่อยังไม่บันทึก (HANDOFF 149)
  useUnsaved(dirty, { word: 'ตารางสิทธิ์', save: () => void save() });
  const d = cur.data;
  const s = d?.subject;
  const eff = d?.effective;
  const mode = d?.table_applies ?? null;
  const level = s?.approval_level ?? 9;
  const co = me?.company;
  /** ที่มาของค่าที่ช่องได้ เมื่อไม่ได้ตั้งเอง */
  const byLevel = type === 'U' && (mode === 'adjust' || mode === 'off');
  const clearWord = type === 'U' && d?.group ? 'ตามกลุ่ม' : 'ตามเมนูหลัก';
  const fromWhere = type === 'U' ? 'กลุ่ม เมนูหลัก หรือระดับอนุมัติ' : 'เมนูหลัก';
  function fromText(inh: PermSource | null, code: string) {
    if (inh?.layer === 'group') return `จากกลุ่ม ${d?.group?.code}${inh.from !== code ? ` (ที่เมนู ${labelOf(inh.from)})` : ''}`;
    if (inh) return `จากเมนูหลัก ${labelOf(inh.from)}`;
    if (byLevel) return `จากระดับอนุมัติ ${level}`;
    return 'ไม่ได้กำหนด = ไม่มีสิทธิ์';
  }
  /** คำสั้นในช่อง (ช่องแคบ) — คำเต็มอยู่ในคำอธิบายเครื่องหมายและเมื่อชี้ */
  function shortFrom(inh: PermSource | null) {
    if (inh?.layer === 'group') return 'กลุ่ม';
    if (inh) return 'เมนูหลัก';
    return byLevel ? 'ระดับ' : 'ไม่มี';
  }
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ผู้ใช้งานและสิทธิ์" title="สิทธิ์รายเมนู" lead={<><b>ตั้งสิทธิ์ของกลุ่ม</b> = กลุ่มใช้เมนูใดได้ (ค่าตั้งต้นของสมาชิก) · <b>สิทธิ์เพิ่มเติมของผู้ใช้</b> = ปรับเฉพาะคน · <b>ใครใช้เมนูนี้ได้</b> = ดูว่าทุกกลุ่ม/ผู้ใช้ใช้เมนูหนึ่งได้จริงอย่างไร (ดูอย่างเดียว) · สิทธิ์แยกแต่ละบริษัท</>}
        actions={<><button onClick={back}>{type === 'U' ? 'กลับแฟ้มผู้ใช้' : 'กลุ่มผู้ใช้'} <kbd>Esc</kbd></button>{tab === 'subject' && <button className="primary" disabled={!id || !dirty} onClick={save}>บันทึก <kbd>F9</kbd></button>}</>} />
      {/* แยกบริษัท (เจ้าของ ข้อ 3): บอกชัดว่ากำลังแก้ของบริษัทไหน */}
      <div className="perm-company" role="note">
        <span>กำลังแก้สิทธิ์ของบริษัท <b data-no-i18n>{co?.code} · {co?.name_th}</b></span>
        <span className="small muted">สิทธิ์แยกแต่ละบริษัท — เปลี่ยนบริษัทที่แถบบน</span>
        <button type="button" disabled={dirty} title={dirty ? 'บันทึกก่อน แล้วจึงคัดลอก' : 'ตั้งสิทธิ์ของบริษัทอื่นให้เหมือนบริษัทนี้ (ดูตัวอย่างก่อน)'} onClick={() => setCopy(true)}>คัดลอกสิทธิ์ไปบริษัทอื่น…</button>
      </div>
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'subject', label: type === 'U' ? 'สิทธิ์เพิ่มเติมของผู้ใช้' : 'ตั้งสิทธิ์ของกลุ่ม' }, { key: 'menu', label: 'ใครใช้เมนูนี้ได้ (ดูอย่างเดียว)' }]} />
      {tab === 'subject' && (
        <>
          <div className="filters">
            {/* เฉพาะกลุ่ม (เจ้าของ ข้อ 4): สิทธิ์เพิ่มเติมรายคนเปิดจากแฟ้มผู้ใช้ ไม่รวมในรายการนี้ */}
            {type === 'U'
              ? <span className="perm-user-head">สิทธิ์เพิ่มเติมของผู้ใช้ <b data-no-i18n>{s ? `${s.code} · ${s.name}` : ''}</b></span>
              : <label className="inline">กำหนดสิทธิ์ให้กลุ่ม{' '}
                <select value={type === 'G' ? subject : ''} onChange={(e) => setSp({ s: e.target.value }, { replace: true })} aria-label="กำหนดสิทธิ์ให้กลุ่ม">
                  <option value="">— เลือกกลุ่มผู้ใช้ —</option>
                  {subs.data?.groups.filter((g) => g.code !== 'ADMIN').map((g) => <option key={g.id} value={`G:${g.id}`}>{g.code} · {g.name}</option>)}
                </select>
              </label>}
            {s && type === 'U' && <span className="perm-subject">ระดับอนุมัติ <b>{s.approval_level}</b>
              {' · '}{d?.group ? <>กลุ่ม <button type="button" className="linklike" onClick={() => setSp({ s: `G:${d.group!.id}` }, { replace: true })} title="เปิดตารางสิทธิ์ของกลุ่ม (ค่าตั้งต้น)">{d.group.code} · {d.group.name}</button></> : <span className="muted">ไม่มีกลุ่ม</span>}
              {' · '}{s.check_rights ? <Pill tone="n">ซ่อนเมนูที่ไม่มีสิทธิ์</Pill> : <Pill tone="x">แสดงเมนูที่ไม่มีสิทธิ์แบบจาง</Pill>}
            </span>}
          </div>
          {s && type === 'U' && mode && <p className="small perm-mode">{mode === 'strict' ? (d?.group ? `ใช้ได้ตามสิทธิ์ของกลุ่ม ${d.group.code} และช่องที่ตั้งเพิ่มในตารางนี้ — ช่องที่ไม่ได้กำหนดเลย = ใช้ไม่ได้` : 'ใช้ได้เฉพาะที่ตั้งในตารางนี้ — ช่องที่ไม่ได้กำหนด = ใช้ไม่ได้')
            : mode === 'adjust' ? `ไม่มีกลุ่ม (หรือกลุ่มยังไม่มีสิทธิ์ในบริษัทนี้): ใช้ได้ตามระดับอนุมัติ ${level} — ช่องที่ตั้งในตารางนี้ปรับเฉพาะช่องนั้น`
            : 'ระดับอนุมัติ 9 ที่ไม่ได้ตั้ง "ซ่อนเมนูที่ไม่มีสิทธิ์": ใช้ได้ทุกอย่าง — ตารางนี้ยังไม่มีผล'}</p>}
          <ErrorBox error={err ?? cur.error ?? menus.error} />
          {!id && <p className="notebox">เลือกกลุ่มที่จะกำหนดสิทธิ์ (เฉพาะกลุ่มของกิจการเจ้าของบริษัทนี้) · ผู้ใช้ได้สิทธิ์ของกลุ่มเป็นค่าตั้งต้น — ปรับเพิ่มเฉพาะคนได้ที่ ผู้ใช้งานระบบ › แท็บผู้ใช้ › แก้ไขผู้ใช้ › "สิทธิ์เพิ่มเติมของผู้ใช้นี้" · ตารางให้สิทธิ์ได้ไม่เกินระดับอนุมัติ (0–4 อ่าน/เพิ่ม/แก้ไข/พิมพ์ · 5–8 + ยกเลิก/ลบ/รับรอง/กำหนดค่า/เงินเดือน · 9 ทุกอย่าง)</p>}
          {id && menus.data && <>
            <p className="perm-legend small">
              <span className="perm-own">✓ Y</span> ใช้ได้ · <span className="perm-own">✓ L</span> ใช้ได้และบันทึกเหตุการณ์ · <span className="perm-own bad">✗ N</span> ไม่ให้ใช้ · <span className="perm-own">S จอ</span> พิมพ์ออกจอเท่านั้น
              {' · '}<b>ตัวหนาสี</b> = ตั้งเฉพาะที่นี่
              {' · '}<span className="perm-inh">(✓) กลุ่ม</span> <span className="perm-inh">(✓) เมนูหลัก</span> <span className="perm-inh">(✓) ระดับ</span>
              {' '}= ได้จาก{fromWhere} (จาง · ชี้ดูที่มา · เลือก "{clearWord}" เพื่อล้าง)
              {' · '}<span className="perm-inh bad">(✗) ไม่มี</span> = ไม่ได้ตั้งไว้ที่ใดเลย = ไม่มีสิทธิ์
              {type === 'U' && <>{' · '}<span className="perm-blocked-key">ขอบส้ม</span> = ตารางให้ แต่ระดับอนุมัติยังไม่พอ</>}
            </p>
            <div className="table-wrap lines perm-grid">
              <table className="grid">
                <thead><tr><th>เมนู</th><th style={{ width: 92 }}>ทั้งแถว</th>{ACTS.map(([, th]) => <th key={th} className="c" style={{ width: 96 }}>{th}</th>)}{eff && <th>สิทธิ์ที่ได้จริง (ที่บันทึกแล้ว)</th>}</tr></thead>
                <tbody>
                  {menus.data.map((m) => {
                    const has = !!vals[m.code];
                    const e = eff?.[m.code];
                    // เมนูเฉพาะผู้ดูแลระบบ (HANDOFF 201): แถวคงที่ ตั้งไม่ได้ — สิทธิ์รวม (ALL/เมนูหลัก) ไม่ให้เมนูนี้
                    if (m.admin_only) return (
                      <tr key={m.code} data-menu={m.code} className="perm-fixed">
                        <td style={{ paddingLeft: 8 + m.depth * 14 }}>{m.label} <span className="muted mono small">{m.code}</span></td>
                        <td colSpan={ACTS.length + 1} className="c"><Pill tone="x">เฉพาะผู้ดูแลระบบ (ADMIN)</Pill> <span className="small muted">ตั้งสิทธิ์ไม่ได้ · ทุกระบบงาน/เมนูหลักไม่รวมเมนูนี้</span></td>
                        {eff && <td className="small">{e && Object.values(e).some(Boolean) ? 'ใช้ได้ (ผู้ดูแลระบบ)' : <span className="bad">ใช้ไม่ได้</span>}</td>}
                      </tr>
                    );
                    return (
                      <tr key={m.code} data-menu={m.code} className={cx(m.group && 'ctl', focusMenu === m.code && 'perm-focus')}>
                        <td style={{ paddingLeft: 8 + m.depth * 14 }}>{m.group ? <b>{m.label}</b> : m.label} <span className="muted mono small">{m.code}</span></td>
                        <td><select value="" onChange={(x) => x.target.value && setRow(m.code, x.target.value === '-' ? '' : x.target.value)} aria-label={`${m.label} ตั้งทั้งแถว`}><option value="">…</option><option value="Y">✓ Y ทั้งแถว</option><option value="N">✗ N ทั้งแถว</option><option value="L">✓ L ทั้งแถว</option>{has && <option value="-">ล้าง ({type === 'U' && d?.group ? 'ตามกลุ่ม' : m.code === 'ALL' ? 'ไม่ได้กำหนด' : 'ตามเมนูหลัก'})</option>}</select></td>
                        {ACTS.map(([a, th, c]) => {
                          const own = permOwn(vals, m.code, c);
                          const inh = own ? null : permInheritedCell(vals, m.code, c, groupRows);
                          // ไม่ได้ตั้งและไม่มีค่าที่ได้รับ: ผู้ใช้ตามระดับอนุมัติ = ค่าที่ได้จริง
                          const shown = own || inh?.v || (type === 'U' && (mode === 'adjust' || mode === 'off') && e ? (e[a] === 'S' ? 'S' : e[a] ? 'Y' : 'N') : '');
                          const grants = shown === 'Y' || shown === 'L' || shown === 'S';
                          const need = type === 'U' ? d?.need?.[m.code]?.[a] : undefined;
                          const blocked = grants && !!need;
                          const tip = [own ? `ตั้งเฉพาะ${type === 'U' ? 'ผู้ใช้นี้' : 'กลุ่มนี้'}ที่เมนูนี้` : fromText(inh, m.code), blocked ? `แต่ระดับอนุมัติ ${level} ยังไม่พอ (ต้อง ${need} ขึ้นไป)` : ''].filter(Boolean).join(' · ');
                          return (
                            <td key={c} className="c">
                              <select value={own} title={tip} onChange={(x) => set(m.code, c, x.target.value)} aria-label={`${m.label} ${th}`}
                                className={cx(own ? 'perm-own' : 'perm-inh', shown === 'N' || !shown ? 'bad' : '', blocked && 'perm-blocked')}>
                                <option value="">({permMark(shown)}) {shortFrom(inh)}</option>
                                <option value="Y">{ownLabel('Y')}</option><option value="L">{ownLabel('L')}</option><option value="N">{ownLabel('N')}</option>{a === 'print' && <option value="S">{ownLabel('S')}</option>}
                              </select>
                            </td>
                          );
                        })}
                        {eff && <td className="small">{e ? ACTS.filter(([a]) => e[a]).map(([a, th]) => (e[a] === 'S' ? `${th}(จอ)` : th)).join(' · ') || <span className="bad">ใช้ไม่ได้</span> : ''}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>}
        </>
      )}
      {ask && <Modal title="เมนูย่อยตั้งไว้ต่างจากนี้" size="confirm" onClose={() => setAsk(null)} footer={<>
        <button onClick={() => setAsk(null)}>ยกเลิก <kbd>Esc</kbd></button>
        <button onClick={() => decide('keep')}>คงค่าเดิมไว้</button>
        <button className="primary" autoFocus onClick={() => decide('overwrite')}>ใช้ค่าเดียวกันทั้งหมด</button>
      </>}>
        <p>เมนูย่อย {ask.conflicts.length} รายการตั้งช่องนี้ไว้ต่างจากนี้ — ใช้ค่าเดียวกันทั้งหมด (ล้างค่าที่ตั้งไว้ที่เมนูย่อย) หรือคงค่าเดิมของเมนูย่อยเหล่านี้ไว้</p>
        <p className="small muted" data-no-i18n>{ask.conflicts.slice(0, 8).map((c) => `${labelOf(c)} (${c})`).join(' · ')}{ask.conflicts.length > 8 ? ' …' : ''}</p>
        <p className="small muted">เมนูย่อยที่ไม่ได้ตั้งเองได้ค่าใหม่จากเมนูหลักทันที</p>
      </Modal>}
      {copy && <CopyRights subject={type && id && s ? { type, id, code: s.code } : null} onClose={() => setCopy(false)} onDone={() => { setCopy(false); qc.invalidateQueries({ queryKey: ['perms'] }); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
      {tab === 'menu' && <ByMenu menus={menus.data ?? []} initial={sp.get('menu') ?? focusMenu ?? 'ALL'} onOpen={(st, sid, m) => { setSp({ s: `${st}:${sid}`, m }, { replace: true }); setTab('subject'); }} />}
      <KeyHints keys={[['F9', 'บันทึก'], ['Esc', 'กลับหน้าผู้ใช้']]} />
    </div>
  );
}

interface CopyPlan { scope: 'subject' | 'all'; subject: { type: string; code: string } | null; companies: Array<{ company_id: string; code: string; name: string; changed: number; subjects: Array<{ subject_type: string; subject_id: string; code: string; before: number; after: number; changed: number }> }> }
/**
 * คัดลอกสิทธิ์ของบริษัทนี้ไปบริษัทอื่น (HANDOFF 197 · เจ้าของ ข้อ 3) — เลือกบริษัทปลายทาง ดูตัวอย่างว่าเปลี่ยนอะไร แล้วจึงคัดลอก
 * เฉพาะบริษัทของกิจการเดียวกันที่คุณเข้าได้ · คัดลอกแล้วแต่ละบริษัทยังแก้แยกได้
 */
function CopyRights({ subject, onClose, onDone }: { subject: { type: 'U' | 'G'; id: string; code: string } | null; onClose: () => void; onDone: () => void }) {
  const { me } = useSession();
  const here = me?.company;
  const hereTenant = me?.companies.find((c) => c.id === here?.id)?.tenant_id ?? null;
  const targets = (me?.companies ?? []).filter((c) => c.id !== here?.id && (c.tenant_id ?? null) === hereTenant);
  const [scope, setScope] = useState<'subject' | 'all'>(subject ? 'subject' : 'all');
  const [pick, setPick] = useState<string[]>([]);
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const body = () => ({ scope, company_ids: pick, ...(scope === 'subject' && subject ? { subject_type: subject.type, subject_id: subject.id } : {}) });
  const preview = () => { setErr(null); setBusy(true); api.post<CopyPlan>('/api/v1/permissions/copy/preview', body()).then(setPlan).catch(setErr).finally(() => setBusy(false)); };
  const run = () => { setErr(null); setBusy(true); api.post<{ companies: number; rows: number }>('/api/v1/permissions/copy', body()).then((r) => { toast(`คัดลอกสิทธิ์ไป ${r.companies} บริษัทแล้ว (${r.rows} แถว)`); onDone(); }).catch(setErr).finally(() => setBusy(false)); };
  const tick = (id: string, on: boolean) => { setPlan(null); setPick((p) => (on ? [...p, id] : p.filter((x) => x !== id))); };
  const noChange = !!plan && plan.companies.every((c) => !c.changed);
  return (
    <Modal title="คัดลอกสิทธิ์ไปบริษัทอื่น" onClose={onClose} footer={<>
      <button onClick={onClose}>ปิด <kbd>Esc</kbd></button>
      <button disabled={!pick.length || busy} className={cx(!plan && 'primary')} onClick={preview}>ดูตัวอย่าง</button>
      <button className="primary" disabled={!plan || busy} onClick={run}>คัดลอกไป {pick.length} บริษัท</button>
    </>}>
      <ErrorBox error={err} />
      <p>ต้นทาง: บริษัท <b data-no-i18n>{here?.code} · {here?.name_th}</b> — บริษัทปลายทางจะได้สิทธิ์เหมือนบริษัทนี้ทุกช่อง แล้วยังแก้แยกแต่ละบริษัทได้ภายหลัง</p>
      <fieldset><span className="lbl">คัดลอกอะไร</span>
        {subject && <label className="inline chk"><input type="radio" name="copy-scope" checked={scope === 'subject'} onChange={() => { setScope('subject'); setPlan(null); }} /> เฉพาะ{subject.type === 'G' ? 'กลุ่ม' : 'ผู้ใช้'} <b data-no-i18n>{subject.code}</b></label>}
        <label className="inline chk"><input type="radio" name="copy-scope" checked={scope === 'all'} onChange={() => { setScope('all'); setPlan(null); }} /> ทุกกลุ่มและผู้ใช้ของบริษัทนี้</label>
      </fieldset>
      <fieldset><span className="lbl">บริษัทปลายทาง <b className="req" aria-hidden="true">*</b></span>
        {targets.length > 1 && <label className="inline chk"><input type="checkbox" checked={pick.length === targets.length} onChange={(e) => { setPlan(null); setPick(e.target.checked ? targets.map((t) => t.id) : []); }} /> เลือกทั้งหมด</label>}
        {targets.map((c) => <label key={c.id} className="inline chk"><input type="checkbox" checked={pick.includes(c.id)} onChange={(e) => tick(c.id, e.target.checked)} /> <span data-no-i18n>{c.code} {c.name_th}</span></label>)}
        {!targets.length && <p className="muted small">ไม่มีบริษัทอื่นของกิจการนี้ที่คุณเข้าได้</p>}
      </fieldset>
      {plan && <div className="table-wrap">
        <table className="grid">
          <thead><tr><th>บริษัท</th><th>กลุ่ม/ผู้ใช้</th><th className="r">เมนูที่มีสิทธิ์ เดิม → ใหม่</th><th className="r">เมนูที่เปลี่ยน</th></tr></thead>
          <tbody>
            {plan.companies.flatMap((c) => (c.subjects.length ? c.subjects : [null]).map((x, i) => (
              <tr key={c.company_id + (x ? x.subject_type + x.subject_id : '-')}>
                <td data-no-i18n>{i === 0 ? `${c.code} ${c.name}` : ''}</td>
                <td>{x ? <>{x.subject_type === 'G' ? 'กลุ่ม' : 'ผู้ใช้'} <span className="mono" data-no-i18n>{x.code}</span></> : <span className="muted">ไม่มีสิทธิ์ที่จะคัดลอก</span>}</td>
                <td className="r">{x ? `${x.before} → ${x.after}` : ''}</td><td className={cx('r', x?.changed ? 'bad' : 'muted')}>{x ? x.changed || 'เหมือนเดิม' : ''}</td>
              </tr>)))}
          </tbody>
        </table>
        <p className="small">{noChange ? 'บริษัทปลายทางมีสิทธิ์เหมือนบริษัทนี้อยู่แล้ว' : 'กด "คัดลอก" เพื่อเปลี่ยนตามตาราง — บันทึกในประวัติการใช้งานของทุกบริษัทที่เปลี่ยน'}</p>
      </div>}
    </Modal>
  );
}

/** กลุ่ม · ระดับ · ซ่อนเมนู ของผู้ใช้ (บรรทัดเล็กใต้ชื่อ) */
function userLine(u: { group_code: string | null; approval_level: number; check_rights: boolean }) {
  const g = u.group_code ? `กลุ่ม ${u.group_code}` : 'ไม่มีกลุ่ม';
  const hide = u.check_rights ? ' · ซ่อนเมนูที่ไม่มีสิทธิ์' : '';
  return `${g} · ระดับ ${u.approval_level}${hide}`;
}
type BCell = { v: 'Y' | 'L' | 'S' | 'N'; src: 'admin' | 'user' | 'group' | 'level' | 'none' | 'block'; at?: string; need?: number; why?: string };
type BGroup = { id: string; code: string; name: string; admin: boolean; members: number; has_rows: boolean; cells: Record<PermAction, BCell> };
type BUser = { id: string; code: string; name: string; status: string; group_code: string | null; approval_level: number; check_rights: boolean; admin: boolean; table: TableMode; cells: Record<PermAction, BCell> };
/**
 * ใครใช้เมนูนี้ได้ (S-SEC-03 · HANDOFF 200 ส่วนที่ 2 · เจ้าของ "เมนูตามกลุ่ม และ ตามเมนู นี้ต่างกันอย่างไร … สับสน"):
 * ทุกกลุ่มและทุกผู้ใช้ของกิจการนี้ทุกครั้ง · ผลที่ได้จริงรายช่อง (server คิดด้วยกฎเดียวกับตอนใช้งาน) + ที่มา · ดูอย่างเดียว — คลิกแถวเพื่อไปแก้
 */
function ByMenu({ menus, initial, onOpen }: { menus: MenuRow[]; initial: string; onOpen: (type: 'G' | 'U', id: string, menu: string) => void }) {
  const [code, setCode] = useState(initial);
  const q = useQuery({ queryKey: ['perm-by-menu', code], queryFn: () => api.get<{ groups: BGroup[]; users: BUser[] }>('/api/v1/permissions/by-menu', { menu_code: code }) });
  const labelOf = (c: string) => (c === 'ALL' ? 'ทุกระบบงาน' : menus.find((m) => m.code === c)?.label ?? c);
  function where(c: BCell, kind: 'G' | 'U', group: string | null): [string, string] {
    const at = c.at === code ? '' : c.at === 'ALL' ? 'ทุกระบบงาน' : c.at ? `เมนูหลัก ${labelOf(c.at)}` : '';
    switch (c.src) {
      case 'admin': return ['ADMIN', 'กลุ่ม ADMIN ได้ทุกอย่าง'];
      case 'group': return kind === 'G' ? [at ? (c.at === 'ALL' ? 'ทุกระบบ' : 'เมนูหลัก') : 'ตั้งที่นี่', at ? `ได้จาก${at} (${c.at})` : 'ตั้งที่เมนูนี้'] : ['กลุ่ม', `จากกลุ่ม ${group ?? ''}${at ? ` ที่${at}` : ''}`];
      case 'user': return [kind === 'U' && !at ? 'ตั้งเฉพาะคน' : 'เฉพาะคน', `ตั้งเฉพาะผู้ใช้นี้${at ? ` ที่${at}` : 'ที่เมนูนี้'}`];
      case 'level': return ['ระดับ', 'ตามระดับอนุมัติ (ไม่ได้ตั้งในตารางสิทธิ์)'];
      case 'none': return ['ไม่ได้ตั้ง', kind === 'G' ? 'กลุ่มนี้ไม่ได้ให้สิทธิ์ที่เมนูนี้ เมนูหลัก หรือทุกระบบงาน' : 'ไม่ได้ตั้งที่ใดเลย = ใช้ไม่ได้'];
      default: return ['ปิด', c.why ?? ''];
    }
  }
  const cell = (c: BCell, kind: 'G' | 'U', group: string | null, a: PermAction) => {
    const [w, tip] = where(c, kind, group);
    const ok = c.v !== 'N';
    const own = (c.src === 'group' && kind === 'G' && c.at === code) || (c.src === 'user' && c.at === code);
    return <td key={a} className={cx('c', own ? 'perm-own' : 'perm-inh', !ok && 'bad')} title={[tip, c.need ? `สมาชิกต้องระดับอนุมัติ ${c.need} ขึ้นไป` : ''].filter(Boolean).join(' · ')}>
      <span className="bm-v">{c.v === 'S' ? 'S จอ' : `${permMark(c.v)} ${c.v}`}</span><span className="bm-src">{w}{c.need ? ` ≥${c.need}` : ''}</span>
    </td>;
  };
  const go = (e: React.KeyboardEvent, fn: () => void) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };
  const d = q.data;
  return (
    <>
      <div className="filters"><label className="inline">เมนู <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="เมนู">{menus.map((m) => <option key={m.code} value={m.code}>{' '.repeat(m.depth * 2)}{m.label} ({m.code})</option>)}</select></label>
        <span className="small muted">ดูอย่างเดียว — คลิกแถวเพื่อไปแก้สิทธิ์ของกลุ่ม/ผู้ใช้นั้นที่เมนูนี้</span></div>
      <ErrorBox error={q.error} />
      <p className="perm-legend small"><span className="perm-own">✓ Y</span> ใช้ได้ · <span className="perm-own">✓ L</span> ใช้ได้และบันทึกเหตุการณ์ · <span className="perm-own">S จอ</span> พิมพ์ออกจอเท่านั้น · <span className="perm-own bad">✗ N</span> ใช้ไม่ได้
        {' · '}ใต้เครื่องหมาย = ที่มา: <b>ตั้งที่นี่</b>/<b>ตั้งเฉพาะคน</b> (ตัวหนาสี = ตั้งที่เมนูนี้) · เมนูหลัก · ทุกระบบ · กลุ่ม · ระดับ (ตามระดับอนุมัติ) · ไม่ได้ตั้ง · ปิด (ชี้ดูเหตุ) · ≥5 = สมาชิกต้องระดับ 5 ขึ้นไป</p>
      <div className="table-wrap perm-bymenu">
        <table className="grid">
          <colgroup><col className="w-type" /><col className="w-code" /><col />{ACTS.map(([a]) => <col key={a} className="w-act" />)}</colgroup>
          <thead><tr><th>ประเภท</th><th>รหัส</th><th>ชื่อ</th>{ACTS.map(([, th]) => <th key={th} className="c">{th}</th>)}</tr></thead>
          <tbody>
            {d?.groups.map((g) => (
              <tr key={g.id} className={cx('row-open', g.admin && 'perm-admin-row')} tabIndex={0} title={g.admin ? 'กลุ่ม ADMIN ได้ทุกอย่าง — ไม่ต้องตั้งสิทธิ์' : `คลิกเพื่อตั้งสิทธิ์ของกลุ่ม ${g.code} ที่เมนูนี้`}
                onClick={() => !g.admin && onOpen('G', g.id, code)} onKeyDown={(e) => !g.admin && go(e, () => onOpen('G', g.id, code))}>
                <td>กลุ่ม</td><td className="mono" data-no-i18n>{g.code}</td>
                <td><span data-no-i18n>{g.name}</span> <span className="small muted">· {g.members} คน</span>{!g.admin && !g.has_rows && <div className="small warn-text">ยังไม่ได้ตั้งสิทธิ์ของกลุ่มในบริษัทนี้</div>}</td>
                {g.admin ? <td colSpan={ACTS.length} className="c perm-own">ได้ทุกอย่าง (ADMIN)</td> : ACTS.map(([a]) => cell(g.cells[a], 'G', g.code, a))}
              </tr>
            ))}
            {d?.users.map((u) => (
              <tr key={u.id} className={cx('row-open', u.status !== 'A' && 'muted')} tabIndex={0} title={`คลิกเพื่อดู/ปรับสิทธิ์เพิ่มเติมของ ${u.code} ที่เมนูนี้`}
                onClick={() => onOpen('U', u.id, code)} onKeyDown={(e) => go(e, () => onOpen('U', u.id, code))}>
                <td>ผู้ใช้</td><td className="mono" data-no-i18n>{u.code}</td>
                <td><span data-no-i18n>{u.name}</span>
                  <div className="small muted">{userLine(u)}{u.status !== 'A' && <> · <Pill tone="d">ระงับ — เข้าระบบไม่ได้</Pill></>}</div></td>
                {u.admin ? <td colSpan={ACTS.length} className="c perm-own">ได้ทุกอย่าง (ADMIN)</td> : ACTS.map(([a]) => cell(u.cells[a], 'U', u.group_code, a))}
              </tr>
            ))}
            {d && !d.groups.length && !d.users.length && <tr><td colSpan={10} className="empty">ยังไม่มีกลุ่มหรือผู้ใช้ในบริษัทนี้</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
