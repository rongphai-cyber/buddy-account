import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type PermAction } from '../../api';
import { useSession } from '../../session';
import { cx, ErrorBox, KeyHints, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';

interface MenuRow { code: string; label: string; depth: number; group: boolean }
interface Subjects { users: Array<{ id: string; username: string; display_name: string; approval_level: number; check_rights: boolean; group_code: string | null }>; groups: Array<{ id: string; code: string; name: string }> }
type Vals = Record<string, string>;
const ACTS: Array<[PermAction, string, string]> = [['read', 'อ่าน', 'can_read'], ['add', 'เพิ่ม', 'can_add'], ['edit', 'แก้ไข', 'can_edit'], ['cancel', 'ยกเลิก', 'can_cancel'], ['delete', 'ลบ', 'can_delete'], ['print', 'พิมพ์', 'can_print'], ['approve', 'รับรอง', 'can_approve']];
const EMPTY: Vals = Object.fromEntries(ACTS.map(([, , c]) => [c, '']));

/**
 * สิทธิ์ 7 ชนิดรายเมนู — คู่มือบทที่ 23: ตามกลุ่ม (S-SEC-01 แท็บ F8) ตามผู้ใช้ (S-SEC-02 แท็บ F8) และตามเมนู (S-SEC-03)
 * ใช้กับบริษัทที่เลือกอยู่ · ผู้ใช้ต้องเปิด "ตรวจสอบสิทธิ์ก่อนใช้งาน" ตารางจึงมีผล
 */
export function PermissionsPage() {
  const { me } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState(sp.get('menu') ? 'menu' : 'subject');
  const subject = sp.get('s') ?? '';   // G:<id> หรือ U:<id>
  const menus = useQuery({ queryKey: ['perm-menus'], queryFn: () => api.get<MenuRow[]>('/api/v1/permissions/menus') });
  const subs = useQuery({ queryKey: ['users'], queryFn: () => api.get<Subjects>('/api/v1/users') });
  const [type, id] = subject ? (subject.split(':') as ['U' | 'G', string]) : [null, null];
  const cur = useQuery({ enabled: !!id, queryKey: ['perms', subject], queryFn: () => api.get<{ subject: { code: string; name: string; approval_level: number | null; check_rights: boolean | null }; rows: Record<string, Vals>; effective: Record<string, Record<PermAction, boolean | 'S'>> | null }>('/api/v1/permissions', { subject_type: type, subject_id: id }) });
  const [vals, setVals] = useState<Record<string, Vals>>({});
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (cur.data) { setVals(Object.fromEntries(Object.entries(cur.data.rows).map(([k, r]) => [k, Object.fromEntries(ACTS.map(([, , c]) => [c, r[c] ?? '']))]))); setDirty(false); } }, [cur.data]);
  const set = (code: string, col: string, v: string) => { setDirty(true); setVals((x) => ({ ...x, [code]: { ...EMPTY, ...x[code], [col]: v } })); };
  const setRow = (code: string, v: string) => { setDirty(true); setVals((x) => ({ ...x, [code]: Object.fromEntries(ACTS.map(([a, , c]) => [c, v === 'S' && a !== 'print' ? 'Y' : v])) })); };
  const save = async () => {
    if (!type || !id) return;
    setErr(null);
    try {
      const rows = Object.entries(vals).filter(([, v]) => Object.values(v).some(Boolean)).map(([menu_code, v]) => ({ menu_code, ...EMPTY, ...v }));
      const r = await api.put<{ rows: number }>('/api/v1/permissions', { subject_type: type, subject_id: id, rows });
      toast(`บันทึกสิทธิ์แล้ว (${r.rows} เมนู)`);
      qc.invalidateQueries({ queryKey: ['perms'] }); qc.invalidateQueries({ queryKey: ['perm-by-menu'] });
    } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save, Escape: () => nav('/settings/users') }, [vals, type, id]);
  const s = cur.data?.subject;
  const eff = cur.data?.effective;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ผู้ใช้งานและสิทธิ์" title="สิทธิ์รายเมนู" lead={<>บริษัท <b>{me?.company?.code} {me?.company?.name_th}</b> · Y = ใช้ได้ · L = ใช้ได้และบันทึกเหตุการณ์ · N = ไม่ให้ใช้ · S = (ช่องพิมพ์) พิมพ์ออกจอเท่านั้น · ว่าง = ไม่กำหนด (ใช้แถวเมนูหลักหรือ "ทุกระบบงาน")</>}
        actions={<><button onClick={() => nav('/settings/users')}>ผู้ใช้งาน <kbd>Esc</kbd></button>{tab === 'subject' && <button className="primary" disabled={!id || !dirty} onClick={save}>บันทึก <kbd>F9</kbd></button>}</>} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'subject', label: 'ตามกลุ่ม/ผู้ใช้' }, { key: 'menu', label: 'ตามเมนู (ระบบงานที่อนุญาต)' }]} />
      {tab === 'subject' && (
        <>
          <div className="filters">
            <label className="inline">กำหนดสิทธิ์ให้{' '}
              <select value={subject} onChange={(e) => setSp({ s: e.target.value }, { replace: true })}>
                <option value="">— เลือกกลุ่มหรือผู้ใช้ —</option>
                <optgroup label="กลุ่มผู้ใช้">{subs.data?.groups.filter((g) => g.code !== 'ADMIN').map((g) => <option key={g.id} value={`G:${g.id}`}>{g.code} · {g.name}</option>)}</optgroup>
                <optgroup label="ผู้ใช้">{subs.data?.users.filter((u) => u.group_code !== 'ADMIN').map((u) => <option key={u.id} value={`U:${u.id}`}>{u.username} · {u.display_name}</option>)}</optgroup>
              </select>
            </label>
            {s && type === 'U' && <span>ระดับอนุมัติ <b>{s.approval_level}</b> · {s.check_rights ? <Pill tone="n">ตรวจสอบสิทธิ์ก่อนใช้งาน</Pill> : <Pill tone="d">ไม่ตรวจสอบสิทธิ์ — ตารางนี้ยังไม่มีผล (เปิดที่หน้าผู้ใช้)</Pill>}</span>}
          </div>
          <ErrorBox error={err ?? cur.error ?? menus.error} />
          {!id && <p className="notebox">เลือกกลุ่มหรือผู้ใช้ที่จะกำหนดสิทธิ์ · ผู้ใช้ได้สิทธิ์จากแถวของตัวเองก่อน ถ้าไม่มีจึงใช้ของกลุ่ม · สิทธิ์ในตารางจำกัดได้ไม่เกินสิทธิ์พื้นฐานตามระดับอนุมัติ (0–4 อ่าน/เพิ่ม/แก้ไข/พิมพ์ · 5–8 + ยกเลิก/ลบ/รับรอง/กำหนดค่า · 9 ทุกอย่าง)</p>}
          {id && menus.data && (
            <div className="table-wrap lines">
              <table className="grid">
                <thead><tr><th>เมนู</th><th style={{ width: 92 }}>ทั้งแถว</th>{ACTS.map(([, th]) => <th key={th} className="c" style={{ width: 70 }}>{th}</th>)}{eff && <th>สิทธิ์ที่ได้จริง</th>}</tr></thead>
                <tbody>
                  {menus.data.map((m) => {
                    const v = { ...EMPTY, ...vals[m.code] };
                    const e = eff?.[m.code];
                    return (
                      <tr key={m.code} className={cx(m.group && 'ctl')}>
                        <td style={{ paddingLeft: 8 + m.depth * 14 }}>{m.group ? <b>{m.label}</b> : m.label} <span className="muted mono small">{m.code}</span></td>
                        <td><select value="" onChange={(x) => x.target.value && setRow(m.code, x.target.value === '-' ? '' : x.target.value)} aria-label="ตั้งทั้งแถว"><option value="">…</option><option value="Y">Y ทั้งแถว</option><option value="N">N ทั้งแถว</option><option value="L">L ทั้งแถว</option><option value="-">ล้าง</option></select></td>
                        {ACTS.map(([a, th, c]) => (
                          <td key={c} className="c">
                            <select value={v[c] ?? ''} onChange={(x) => set(m.code, c, x.target.value)} aria-label={`${m.label} ${th}`} className={cx(v[c] === 'N' && 'bad')}>
                              <option value="" /><option value="Y">Y</option><option value="L">L</option><option value="N">N</option>{a === 'print' && <option value="S">S</option>}
                            </select>
                          </td>
                        ))}
                        {eff && <td className="small">{e ? ACTS.filter(([a]) => e[a]).map(([a, th]) => (e[a] === 'S' ? `${th}(จอ)` : th)).join(' · ') || <span className="bad">ใช้ไม่ได้</span> : ''}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {tab === 'menu' && <ByMenu menus={menus.data ?? []} onOpen={(st, sid) => { setSp({ s: `${st}:${sid}` }, { replace: true }); setTab('subject'); }} />}
      <KeyHints keys={[['F9', 'บันทึก'], ['Esc', 'กลับหน้าผู้ใช้']]} />
    </div>
  );
}

/** ระบบงานที่อนุญาตให้ใช้ (S-SEC-03): มุมมองกลับด้าน — เลือกเมนูแล้วดูว่ากลุ่ม/ผู้ใช้ใดได้สิทธิ์อะไร */
function ByMenu({ menus, onOpen }: { menus: MenuRow[]; onOpen: (type: string, id: string) => void }) {
  const [code, setCode] = useState('ALL');
  const q = useQuery({ queryKey: ['perm-by-menu', code], queryFn: () => api.get<Array<{ subject_type: string; subject_id: string; code: string; name: string } & Vals>>('/api/v1/permissions/by-menu', { menu_code: code }) });
  return (
    <>
      <div className="filters"><label className="inline">เมนู <select value={code} onChange={(e) => setCode(e.target.value)}>{menus.map((m) => <option key={m.code} value={m.code}>{' '.repeat(m.depth * 2)}{m.label} ({m.code})</option>)}</select></label></div>
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 90 }}>ประเภท</th><th>ผู้ใช้/กลุ่ม</th><th>ชื่อ</th>{ACTS.map(([, th]) => <th key={th} className="c">{th}</th>)}</tr></thead>
          <tbody>
            {q.data?.map((r) => (
              <tr key={r.subject_type + r.subject_id} className="row-open" onClick={() => onOpen(r.subject_type, r.subject_id)}>
                <td>{r.subject_type === 'G' ? 'กลุ่ม' : 'ผู้ใช้'}</td><td className="mono">{r.code}</td><td>{r.name}</td>
                {ACTS.map(([, , c]) => <td key={c} className={cx('c mono', r[c] === 'N' && 'bad')}>{r[c]}</td>)}
              </tr>
            ))}
            {q.data && !q.data.length && <tr><td colSpan={10} className="empty">ยังไม่มีกลุ่มหรือผู้ใช้ที่กำหนดสิทธิ์ในเมนูนี้โดยตรง (อาจได้จากเมนูหลักหรือ "ทุกระบบงาน")</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
