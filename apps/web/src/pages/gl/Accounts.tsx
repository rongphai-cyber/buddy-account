import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, type Account } from '../../api';
import { useSession } from '../../session';
import { ChartTemplateDialog } from './ChartTemplate';
import { Confirm, cx, downloadCsv, ErrorBox, Field, GROUP_TH, Modal, Money, PageHead, Pill, toast, toastError, useHotkeys, KeyHints } from '../../ui';

/** ผังบัญชี — คู่มือบทที่ 7 หน้า 96 (S-GL-01) + เปลี่ยนเลขที่บัญชี (S-GL-02) */
export function AccountsPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [sort, setSort] = useState<'no' | 'name'>('no');
  const [edit, setEdit] = useState<Account | 'new' | null>(null);
  const [renum, setRenum] = useState<Account | null>(null);
  const [del, setDel] = useState<Account | null>(null);
  const [sel, setSel] = useState(0);
  const [tpl, setTpl] = useState(false);
  const asOf = me?.work_date ?? undefined;
  const accts = useQuery({ queryKey: ['accounts', 'bal', asOf], queryFn: () => api.get<Account[]>('/api/v1/gl/accounts', { with_balance: 1, as_of: asOf }) });
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = (accts.data ?? []).filter((a) => (!group || a.account_group === group) && (!s || a.account_no.toLowerCase().includes(s) || a.name_th.toLowerCase().includes(s) || (a.name_en ?? '').toLowerCase().includes(s)));
    if (sort === 'name') r = [...r].sort((x, y) => x.name_th.localeCompare(y.name_th, 'th'));
    return r;
  }, [accts.data, q, group, sort]);
  const cur = list[sel];
  useHotkeys({ Insert: () => setEdit('new'), 'Alt+A': () => setEdit('new'), 'Alt+E': () => cur && setEdit(cur), 'Ctrl+G': () => cur && setRenum(cur), 'Alt+D': () => cur && setDel(cur) }, [cur]);
  const reload = () => qc.invalidateQueries({ queryKey: ['accounts'] });
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ผังบัญชี" title="ผังบัญชี" lead="บัญชีคุมใช้รวมยอด บัญชีย่อยใช้ลงรายการ · ยอดคงเหลือ ณ วันทำการ (ตามด้านเดบิต)"
        actions={<>
          <button className="primary" onClick={() => setEdit('new')}>+ เพิ่มบัญชี <kbd>Ins</kbd></button>
          <button disabled={!cur} onClick={() => cur && setRenum(cur)}>เปลี่ยนเลขที่บัญชี <kbd>Ctrl+G</kbd></button>
          <button onClick={() => setTpl(true)} title="เพิ่มบัญชี/ชื่อภาษาอังกฤษจากผังบัญชีตัวอย่าง">ผังบัญชีตัวอย่าง</button>
          <button onClick={() => downloadCsv('ผังบัญชี', ['เลขที่บัญชี', 'ชื่อบัญชี', 'ชื่ออังกฤษ', 'บัญชีคุม', 'ระดับ', 'หมวด', 'ประเภท', 'แยกแผนก', 'ยอดคงเหลือ'], list.map((a) => [a.account_no, a.name_th, a.name_en, a.parent_no, a.level, a.account_group, a.is_control ? 'คุม' : 'ย่อย', a.use_department ? 'Y' : 'N', a.balance]))}>ส่งออก Excel</button>
        </>} />
      <div className="filters">
        <input className="search" placeholder="ค้นหาเลขที่หรือชื่อบัญชี (Alt+S)" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} accessKey="s"
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, list.length - 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } if (e.key === 'Enter' && cur) setEdit(cur); }} />
        <div className="seg">{['', '1', '2', '3', '4', '5'].map((g) => <button key={g} className={cx(group === g && 'on')} onClick={() => setGroup(g)}>{g ? `${g} ${GROUP_TH[g]}` : 'ทั้งหมด'}</button>)}</div>
        <label className="inline">เรียงตาม <select value={sort} onChange={(e) => setSort(e.target.value as 'no' | 'name')}><option value="no">เลขที่บัญชี</option><option value="name">ชื่อบัญชี</option></select></label>
        <span className="summary"><b>{list.length}</b> บัญชี</span>
      </div>
      <ErrorBox error={accts.error} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 120 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th>บัญชีคุม</th><th className="c">ระดับ</th><th>หมวด</th><th>ประเภท</th><th className="c">แผนก</th><th className="r">ยอดคงเหลือ</th><th className="r">รายการ</th></tr></thead>
          <tbody>
            {list.map((a, i) => (
              <tr key={a.id} className={cx('row-open', a.is_control && 'ctl', i === sel && 'sel', a.status === 'I' && 'void')} onClick={() => { setSel(i); setEdit(a); }} onMouseEnter={() => setSel(i)}>
                <td className="mono">{a.account_no}</td>
                <td style={{ paddingLeft: 10 + (sort === 'no' ? (a.level - 1) * 16 : 0) }}>{a.name_th}{a.name_en && <span className="muted small"> · {a.name_en}</span>}</td>
                <td className="mono muted">{a.parent_no}</td><td className="c">{a.level}</td><td>{GROUP_TH[a.account_group]}</td>
                <td>{a.is_control ? <Pill tone="n">บัญชีคุม</Pill> : 'บัญชีย่อย'}</td><td className="c">{a.use_department ? '✓' : ''}</td>
                <td className="r"><Money v={a.balance} blankZero paren /></td>
                <td className="r">{a.line_count ? <button className="linklike" onClick={(e) => { e.stopPropagation(); nav(`/reports/ledger?account_id=${a.id}`); }}>{a.line_count.toLocaleString()}</button> : ''}</td>
              </tr>
            ))}
            {!list.length && !accts.isLoading && <tr><td colSpan={9} className="empty">ไม่พบบัญชี</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['Enter', 'แก้ไข'], ['Ctrl+G', 'เปลี่ยนเลขที่บัญชี'], ['Alt+D', 'ลบ'], ['↑↓', 'เลือก']]} />
      {tpl && <ChartTemplateDialog onClose={() => setTpl(false)} />}
      {edit && <AccountForm acct={edit === 'new' ? null : edit} all={accts.data ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {renum && <RenumberDialog acct={renum} onClose={() => setRenum(null)} onDone={() => { setRenum(null); reload(); }} />}
      {del && <Confirm title="ลบบัญชี" danger okText="ลบ" text={`ลบบัญชี ${del.account_no} ${del.name_th} ?`} onClose={() => setDel(null)}
        onOk={() => api.del(`/api/v1/gl/accounts/${del.id}`).then(() => { toast('ลบบัญชีแล้ว'); setDel(null); reload(); }).catch((e) => { toastError(e); setDel(null); })} />}
    </div>
  );
}

export function AccountForm({ acct, all, onClose, onSaved, initialNo }: { acct: Account | null; all: Account[]; onClose: () => void; onSaved: (id: string) => void; initialNo?: string }) {
  const [f, setF] = useState({
    account_no: acct?.account_no ?? initialNo ?? '', name_th: acct?.name_th ?? '', name_en: acct?.name_en ?? '', parent_id: acct?.parent_id ?? '',
    level: acct?.level ?? 1, account_group: acct?.account_group ?? '1', is_control: acct?.is_control ?? false, use_department: acct?.use_department ?? false, status: acct?.status ?? 'A',
  });
  const [err, setErr] = useState<unknown>(null);
  const controls = all.filter((a) => a.is_control && a.id !== acct?.id);
  const setParent = (id: string) => {
    const p = all.find((x) => x.id === id);
    setF((x) => ({ ...x, parent_id: id, level: p ? p.level + 1 : 1, account_group: p ? p.account_group : x.account_group }));
  };
  const save = async () => {
    setErr(null);
    try {
      const body = { ...f, parent_id: f.parent_id || null, name_en: f.name_en || null };
      const r = acct ? await api.put<{ id: string }>(`/api/v1/gl/accounts/${acct.id}`, body) : await api.post<{ id: string }>('/api/v1/gl/accounts', body);
      toast(acct ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มบัญชี ${f.account_no} แล้ว`);
      onSaved(r.id);
    } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  const issue = (k: string) => (err as { issues?: Array<{ field?: string; message: string }> })?.issues?.find((i) => i.field === k)?.message;
  return (
    <Modal title={acct ? `แก้ไขบัญชี ${acct.account_no}` : 'เพิ่มบัญชี'} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="เลขที่บัญชี" req error={issue('account_no')} hint={acct ? 'เปลี่ยนเลขที่บัญชีใช้ Ctrl+G ที่หน้ารายการ' : undefined}><input value={f.account_no} readOnly={!!acct} onChange={(e) => setF({ ...f, account_no: e.target.value })} autoFocus={!acct} /></Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
        <Field label="ชื่อไทย" req wide><input value={f.name_th} onChange={(e) => setF({ ...f, name_th: e.target.value })} autoFocus={!!acct} /></Field>
        <Field label="ชื่ออังกฤษ" wide><input value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
        <Field label="บัญชีคุม" error={issue('parent_id')} hint="บังคับถ้าระดับมากกว่า 1 — ระดับและหมวดจะตั้งตามบัญชีคุม" wide>
          <select value={f.parent_id} onChange={(e) => setParent(e.target.value)}>
            <option value="">— ไม่มี (ระดับ 1) —</option>
            {controls.map((c) => <option key={c.id} value={c.id}>{c.account_no} {c.name_th}</option>)}
          </select>
        </Field>
        <Field label="ระดับบัญชี" error={issue('level')}><input type="number" min={1} max={9} value={f.level} onChange={(e) => setF({ ...f, level: Number(e.target.value) })} /></Field>
        <Field label="หมวดบัญชี" req error={issue('account_group')}>
          <select value={f.account_group} onChange={(e) => setF({ ...f, account_group: e.target.value })} disabled={!!f.parent_id}>
            {Object.entries(GROUP_TH).map(([k, v]) => <option key={k} value={k}>{k} - {v}</option>)}
          </select>
        </Field>
        <Field label="ประเภท" req><select value={f.is_control ? '1' : '2'} onChange={(e) => setF({ ...f, is_control: e.target.value === '1' })}><option value="1">1 - บัญชีคุม</option><option value="2">2 - บัญชีย่อย</option></select></Field>
        <label className="inline chk"><input type="checkbox" checked={f.use_department} onChange={(e) => setF({ ...f, use_department: e.target.checked })} /> แยกแผนก (ต้องระบุแผนกเมื่อลงรายการ)</label>
      </div>
    </Modal>
  );
}

function RenumberDialog({ acct, onClose, onDone }: { acct: Account; onClose: () => void; onDone: () => void }) {
  const [no, setNo] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const go = () => api.post(`/api/v1/gl/accounts/${acct.id}/renumber`, { account_no: no }).then(() => { toast(`เปลี่ยนเป็น ${no} แล้ว — รายการเดิมทั้งหมดย้ายตามไปด้วย`); onDone(); }).catch(setErr);
  useHotkeys({ F5: go }, [no]);
  return (
    <Modal title="เปลี่ยนเลขที่บัญชี" size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={go}>ตกลง <kbd>F5</kbd></button></>}>
      <ErrorBox error={err} />
      <Field label="เลขที่บัญชีเดิม"><input readOnly value={`${acct.account_no} ${acct.name_th}`} /></Field>
      <Field label="เปลี่ยนเป็น" req><input autoFocus value={no} onChange={(e) => setNo(e.target.value)} data-noenter onKeyDown={(e) => e.key === 'Enter' && go()} /></Field>
    </Modal>
  );
}
