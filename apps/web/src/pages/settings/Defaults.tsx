import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SETTING_SECTIONS, UDF_LABELS, validateSetting, type SettingDef } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { cx, ErrorBox, KeyHints, MoneyInput, PageHead, Pill, toast, useHotkeys } from '../../ui';

type Vals = Record<string, unknown>;
type Tier = { amount: number; level: number };
type Udf = Record<string, { use?: boolean; th?: string; en?: string }>;
type Petty = Array<{ th: string; en?: string; account?: string | null }>;

/**
 * ค่าเริ่มต้นแต่ละระบบ — คู่มือบทที่ 5 (เริ่มระบบ › 1. กำหนดค่าเริ่มต้นต่าง ๆ) S-SET-02/03/05/07/09/10/11
 * หน้าจอระเบียนเดียวแบบ Express: แก้ไข (Alt+E) → บันทึก (F9) / ยกเลิก (Esc)
 */
export function DefaultsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const can = useCan('SET.DEF');
  const [sp, setSp] = useSearchParams();
  const code = sp.get('s') ?? 'GEN';
  const sec = SETTING_SECTIONS.find((s) => s.code === code) ?? SETTING_SECTIONS[0]!;
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ values: Vals; customized: string[] }>('/api/v1/settings') });
  const [vals, setVals] = useState<Vals>({});
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data && !editing) setVals(q.data.values); }, [q.data, editing]);
  const set = (k: string, v: unknown) => setVals((x) => ({ ...x, [k]: v }));
  const cancel = () => { setEditing(false); setErr(null); if (q.data) setVals(q.data.values); };
  const save = async () => {
    if (!editing || busy) return;
    const changed = Object.fromEntries(sec.defs.map((d) => [d.key, clean(d, vals[d.key])]).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(q.data?.values[k as string])));
    const bad = sec.defs.map((d) => (d.key in changed ? validateSetting(d, changed[d.key]) : null)).find(Boolean);
    if (bad) { setErr(new Error(bad)); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.put<{ changed: string[] }>('/api/v1/settings', { values: changed });
      toast(r.changed.length ? `บันทึกค่าเริ่มต้นแล้ว (${r.changed.length} ข้อ)` : 'ไม่มีการเปลี่ยนแปลง');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['settings'] }); qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ 'Alt+E': () => can('edit') && setEditing(true), F9: save, 'Ctrl+S': save, Escape: () => (editing ? cancel() : nav('/')) }, [editing, vals, busy, sec]);
  const own = new Set(q.data?.customized ?? []);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › กำหนดค่าเริ่มต้นต่าง ๆ" title={`ค่าเริ่มต้น — ${sec.title}`} lead={<>คู่มือ Express บทที่ 5 ({sec.screen}) · ค่าที่ยังไม่เคยแก้ใช้ค่าเริ่มต้นตามคู่มือ</>}
        actions={editing
          ? <><button onClick={cancel}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={busy} onClick={save}>บันทึก <kbd>F9</kbd></button></>
          : <button className="primary" disabled={!can('edit')} title={can('edit') ? 'แก้ไข (Alt+E)' : 'ไม่มีสิทธิ์แก้ค่าเริ่มต้น (ต้องระดับอนุมัติ 5 ขึ้นไป)'} onClick={() => setEditing(true)}>แก้ไข <kbd>Alt+E</kbd></button>} />
      <ErrorBox error={err ?? q.error} />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="ระบบงาน">
          {SETTING_SECTIONS.map((s, i) => (
            <button key={s.code} className={cx(s.code === sec.code && 'on')} disabled={editing && s.code !== sec.code} onClick={() => setSp({ s: s.code }, { replace: true })}>
              <span className="muted">{i + 2}.</span> {s.title}
            </button>
          ))}
        </nav>
        <fieldset className="settings-form" disabled={!editing}>
          {sec.defs.map((d) => (
            <div key={d.key} className="set-row">
              <div className="set-label">
                <b>{d.no}</b> {d.label}{d.assumed && <span className="muted small"> [สันนิษฐาน]</span>}
                {d.hint && <div className="hint">{d.hint}</div>}
              </div>
              <div className="set-input"><Input d={d} v={vals[d.key]} onChange={(v) => set(d.key, v)} /></div>
              <div className="set-meta small muted">{own.has(d.key) ? <Pill tone="n">กำหนดแล้ว</Pill> : 'ค่าตามคู่มือ'}{d.from && <div className="mono">{d.from.split(':')[0]}</div>}</div>
            </div>
          ))}
        </fieldset>
      </div>
      <KeyHints keys={[['Alt+E', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ยกเลิก / กลับ']]} />
    </div>
  );
}

/** แปลงค่าจากช่องกรอกเป็นค่าที่บันทึก (ตัวเลขเป็น number, ตารางตัดแถวว่าง) */
function clean(d: SettingDef, v: unknown): unknown {
  switch (d.type.t) {
    case 'int': case 'decimal': return v === '' || v === null ? v : Number(v);
    case 'level': return v === '' || v === null || v === undefined ? null : Number(v);
    case 'days': return (v as unknown[]).map((x) => Number(x));
    case 'tiers': return (v as Tier[]).filter((t) => Number(t.amount) > 0).map((t) => ({ amount: Number(t.amount), level: Number(t.level) }));
    case 'petty': return (v as Petty).filter((p) => p.th?.trim() || p.account).map((p) => ({ th: p.th.trim(), en: p.en?.trim() ?? '', account: p.account ?? null }));
    default: return v;
  }
}

function Input({ d, v, onChange }: { d: SettingDef; v: unknown; onChange: (v: unknown) => void }) {
  const accts = useAccounts();
  const ty = d.type;
  switch (ty.t) {
    case 'bool': return <label className="inline chk"><input type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} /> {v ? 'ใช่' : 'ไม่ใช่'}</label>;
    case 'int': case 'decimal': return <input className="num" inputMode="decimal" style={{ width: 140 }} value={v === null || v === undefined ? '' : String(v)} onChange={(e) => onChange(e.target.value)} />;
    case 'select': return <select value={String(v ?? '')} onChange={(e) => onChange(e.target.value)}>{ty.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
    case 'text': case 'mask': return <input className={cx(ty.t === 'mask' && 'mono')} maxLength={ty.max} style={{ width: ty.t === 'mask' ? 220 : 260 }} value={String(v ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'level': return <select value={v === null || v === undefined ? '' : String(v)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}><option value="">— ไม่ต้องขออนุมัติ —</option>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>ระดับ {i}</option>)}</select>;
    case 'days': {
      const a = (v as number[]) ?? [];
      return <span className="days">{Array.from({ length: ty.n }, (_, i) => <label key={i} className="inline">ช่วงที่ {i + 1} <input className="num" inputMode="numeric" style={{ width: 70 }} value={a[i] ?? ''} onChange={(e) => onChange(Array.from({ length: ty.n }, (_, k) => (k === i ? e.target.value : a[k] ?? '')))} /></label>)}</span>;
    }
    case 'tiers': {
      const rows: Tier[] = [...((v as Tier[]) ?? [])]; while (rows.length < 5) rows.push({ amount: 0, level: 0 });
      const up = (i: number, p: Partial<Tier>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
      return (
        <table className="grid mini"><thead><tr><th>วงเงินระดับ</th><th className="r">จำนวนเงินไม่เกิน</th><th>ระดับที่อนุมัติได้</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{i + 1}</td><td><MoneyInput value={r.amount ? String(r.amount) : ''} onChange={(x) => up(i, { amount: Number(x || 0) })} /></td><td><select value={r.level} onChange={(e) => up(i, { level: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, k) => <option key={k} value={k}>{k}</option>)}</select></td></tr>)}</tbody></table>
      );
    }
    case 'udf': {
      const u = (v as Udf) ?? {};
      const up = (k: string, p: Partial<Udf[string]>) => onChange({ ...u, [k]: { ...u[k], ...p } });
      return (
        <table className="grid mini"><thead><tr><th>ฟิลด์</th><th>ใช้?</th><th>ชื่อภาษาไทย</th><th>ชื่อภาษาอังกฤษ</th></tr></thead>
          <tbody>{Object.entries(UDF_LABELS).map(([k, l]) => <tr key={k}><td className="small">{l}</td><td className="c"><input type="checkbox" checked={!!u[k]?.use} onChange={(e) => up(k, { use: e.target.checked })} /></td><td><input value={u[k]?.th ?? ''} onChange={(e) => up(k, { th: e.target.value })} /></td><td><input value={u[k]?.en ?? ''} onChange={(e) => up(k, { en: e.target.value })} /></td></tr>)}</tbody></table>
      );
    }
    case 'petty': {
      const rows: Petty = [...((v as Petty) ?? [])]; while (rows.length < 5) rows.push({ th: '', en: '', account: null });
      const up = (i: number, p: Partial<Petty[number]>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
      return (
        <table className="grid mini"><thead><tr><th>ข้อความ</th><th>ชื่อไทย</th><th>ชื่ออังกฤษ</th><th>เลขที่บัญชี</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td>{i + 1}</td><td><input value={r.th} onChange={(e) => up(i, { th: e.target.value })} /></td><td><input value={r.en ?? ''} onChange={(e) => up(i, { en: e.target.value })} /></td>
            <td><AccountCell value={accts.data?.find((a) => a.account_no === r.account)?.id ?? null} onChange={(a) => up(i, { account: a?.account_no ?? null })} /></td></tr>)}</tbody></table>
      );
    }
  }
}
