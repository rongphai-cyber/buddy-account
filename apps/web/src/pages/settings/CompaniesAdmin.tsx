import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { DateInput, DateText, ErrorBox, Field, Modal, PageHead, Pill, toast, toastError, useHotkeys } from '../../ui';
import { ALL_COPY_GROUPS, CopyGroupsPicker, type CopyGroup } from '../../components/CopyChoices';

type Row = { id: string; code: string; name_th: string; tenant_code: string | null; deleted_at: string | null; deleted_by: string | null; doc_count: number; journal_count: number; last_date: string | null; current: boolean; next_start: string | null };

/**
 * บริษัททั้งหมดของลูกค้า — ลบ/กู้คืนบริษัท (HANDOFF 175 — เจ้าของ 23/11/2569 "กรณีสร้างบริษัทผิด หรือต้องการลบบริษัทที่ไม่ใช้แล้ว … (Admin เท่านั้นที่ทำได้)")
 * ผู้ดูแลระบบของลูกค้า/เจ้าหน้าที่ผู้ให้บริการ · ลบ = ซ่อนจากตัวเลือกบริษัท (ไม่ลบข้อมูลจริง) กู้คืนได้ · ก่อนลบแสดงจำนวนเอกสาร/วันที่ล่าสุด สำรองข้อมูลก่อนได้
 * ยืนยันด้วยรหัสบริษัท + รหัสยืนยันตัวตน (ถ้าเปิดสองขั้น) · บริษัทที่เลือกอยู่และบริษัทสุดท้ายลบไม่ได้
 */
/** เริ่มระบบ › บริษัททั้งหมด / ลบบริษัท (SET.COS · HANDOFF 201) — เฉพาะผู้ดูแลระบบของลูกค้าและเจ้าหน้าที่ผู้ให้บริการ */
export function CompaniesPage() {
  const nav = useNavigate();
  useHotkeys({ Escape: () => nav(-1) }, []);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ" title="บริษัททั้งหมด / ลบบริษัท" lead="บริษัททั้งหมดของกิจการ — แก้รหัส คัดลอกบริษัท สำรองข้อมูลก่อนลบ ลบ/กู้คืนบริษัท · เฉพาะผู้ดูแลระบบ (กลุ่ม ADMIN) ให้สิทธิ์ผู้อื่นไม่ได้"
        actions={<button onClick={() => nav('/companies/new')}>+ กำหนดบริษัทใหม่</button>} />
      <MoveRequests />
      <CompaniesAdmin />
    </div>
  );
}

/**
 * คำขอย้ายบริษัทจากผู้ให้บริการ (HANDOFF 204 C2) — ผู้ดูแลระบบของกิจการยืนยัน (พิมพ์รหัสบริษัท + รหัส 2FA) หรือปฏิเสธ · ไม่ยืนยัน = ไม่ย้าย
 */
function MoveRequests() {
  const { me, refresh } = useSession();
  const qc = useQueryClient();
  type Target = { code: string; name: string; admins: string[]; contact_email: string | null; created_at: string };
  const q = useQuery({ enabled: !!me?.user.is_admin && !me.user.is_platform && !!me.user.tenant_id, queryKey: ['move-requests'], queryFn: () => api.get<Array<{ id: string; company_codes: string; target_code: string; target_name: string; expires_at: string; target: Target; blocked: string | null }>>('/api/v1/company-move-requests') });
  const [ask, setAsk] = useState<{ id: string; codes: string } | null>(null);
  const [typed, setTyped] = useState(''), [totp, setTotp] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const reload = async () => { await qc.invalidateQueries({ queryKey: ['move-requests'] }); await qc.invalidateQueries({ queryKey: ['companies-manage'] }); await refresh(); };
  if (!q.data?.length) return null;
  return (
    <div className="notebox warn move-requests" role="status">
      <b>มีคำขอย้ายบริษัทจากผู้ให้บริการ — รอท่านยืนยัน</b>
      {q.data.map((r) => (
        <div key={r.id} className="move-request">
          ย้าย <b className="mono">{r.company_codes}</b> ไปอยู่ในบัญชีลูกค้า <b>{r.target_code} {r.target_name}</b> · หมดอายุ <DateText v={r.expires_at.slice(0, 10)} />
          {/* HANDOFF 204 N3: ใครดูแลลูกค้าปลายทาง */}
          <div className="small">ผู้ดูแลระบบของลูกค้าปลายทาง: <b>{r.target.admins.join(', ') || '-'}</b> · อีเมลผู้ติดต่อ: {r.target.contact_email ?? '-'} · สร้างเมื่อ <DateText v={r.target.created_at.slice(0, 10)} /></div>
          <div className="small bad">บริษัทจะย้ายไปอยู่ภายใต้ลูกค้า {r.target_code} — ผู้ดูแลของลูกค้า {r.target_code} จะเห็นข้อมูลทั้งหมด</div>
          {r.blocked && <div className="small bad">{r.blocked}</div>}
          {' '}<button className="danger" disabled={!!r.blocked} onClick={() => { setAsk({ id: r.id, codes: r.company_codes }); setTyped(''); setTotp(''); setErr(null); }}>ยืนยันย้าย…</button>
          {' '}<button onClick={() => window.confirm('ปฏิเสธคำขอนี้? บริษัทไม่ย้าย') && api.post(`/api/v1/company-move-requests/${r.id}/reject`).then(() => { toast('ปฏิเสธคำขอแล้ว — บริษัทไม่ย้าย'); return reload(); }).catch(toastError)}>ปฏิเสธ</button>
        </div>
      ))}
      <p className="small">ย้ายแล้วบริษัทและข้อมูลทั้งหมดไปอยู่กับลูกค้าปลายทาง ผู้ใช้ของท่านที่เข้าได้เฉพาะบริษัทนั้นย้ายตาม — ถ้าท่านไม่ได้ขอ ให้กด "ปฏิเสธ" และแจ้งผู้ให้บริการ</p>
      {ask && <Modal title="ยืนยันย้ายบริษัท" size="confirm" onClose={() => setAsk(null)} footer={<><button onClick={() => setAsk(null)}>ยกเลิก</button>
        <button className="danger" onClick={() => api.post(`/api/v1/company-move-requests/${ask.id}/confirm`, { confirm: typed, totp_code: totp || null }).then(() => { toast(`ย้าย ${ask.codes} แล้ว`); setAsk(null); return reload(); }).catch(setErr)}>ยืนยันย้าย</button></>}>
        <ErrorBox error={err} />
        <Field label={`พิมพ์รหัสบริษัท ${ask.codes} เพื่อยืนยัน`}><input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
        <Field label="รหัสยืนยันตัวตนสองขั้น (ถ้าเปิดไว้)"><input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} /></Field>
      </Modal>}
    </div>
  );
}

export function CompaniesAdmin() {
  const { me, select, refresh } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const ys = me?.company?.year_system ?? 'B';
  const q = useQuery({ queryKey: ['companies-manage'], queryFn: () => api.get<{ rows: Row[] }>('/api/v1/companies/manage') });
  const [del, setDel] = useState<Row | null>(null);
  const [code, setCode] = useState('');
  const [totp, setTotp] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // แก้รหัสบริษัท / คัดลอกบริษัท (HANDOFF 181)
  const [recode, setRecode] = useState<Row | null>(null);
  const [newCode, setNewCode] = useState('');
  const [cp, setCp] = useState<{ row: Row; code: string; name: string; mode: 'full' | 'new'; groups: CopyGroup[]; start: string } | null>(null);
  const [done, setDone] = useState<{ id: string; code: string; seconds: number; full: boolean; journals?: number } | null>(null);
  const rows = q.data?.rows ?? [];
  const active = rows.filter((r) => !r.deleted_at), gone = rows.filter((r) => r.deleted_at);
  const reload = async () => { await qc.invalidateQueries({ queryKey: ['companies-manage'] }); await refresh(); };
  const doDelete = async () => {
    if (!del) return;
    setBusy(true); setErr(null);
    try { await api.post(`/api/v1/companies/${del.id}/delete`, { confirm_code: code, totp_code: totp || null }); toast(`ลบบริษัท ${del.code} แล้ว — กู้คืนได้ที่รายการบริษัทที่ลบแล้ว`); setDel(null); await reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const restore = async (r: Row) => {
    try { await api.post(`/api/v1/companies/${r.id}/restore`, {}); toast(`กู้คืนบริษัท ${r.code} แล้ว`); await reload(); } catch (e) { setErr(e); }
  };
  const saveCode = async () => {
    if (!recode) return;
    setBusy(true); setErr(null);
    try { await api.put(`/api/v1/companies/${recode.id}/code`, { code: newCode.trim() }); toast(`เปลี่ยนรหัสบริษัท ${recode.code} เป็น ${newCode.trim()} แล้ว`); setRecode(null); await reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const doCopy = async () => {
    if (!cp) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ id: string; code: string; seconds: number; check?: { totals: { copy: { j: number } } } | null }>(`/api/v1/companies/${cp.row.id}/copy`,
        { code: cp.code.trim(), name_th: cp.name.trim(), mode: cp.mode, groups: cp.mode === 'new' ? cp.groups : [], fiscal_start: cp.mode === 'new' ? cp.start : undefined });
      setDone({ id: r.id, code: r.code, seconds: r.seconds, full: cp.mode === 'full', journals: r.check?.totals.copy.j });
      setCp(null); await reload();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  /** สำรองข้อมูลก่อนลบ: เปิดบริษัทนั้นแล้วไปหน้าสำรองข้อมูล (กลับมาลบจากบริษัทอื่น) */
  const backup = (r: Row) => void select({ company_id: r.id }).then(() => nav('/tools/backup'));
  // ชื่อบริษัทกว้างพออ่านได้ · ปุ่มรายการเป็นกลุ่มที่ขึ้นบรรทัดใหม่เองเมื่อแคบ (ไม่บีบคอลัมน์ชื่อ)
  const head = <tr><th style={{ width: 150 }}>รหัสบริษัท</th><th className="co-name">ชื่อบริษัท</th>{me?.user.is_platform && <th style={{ width: 110 }}>ลูกค้า</th>}<th className="r" style={{ width: 110 }}>เอกสาร</th><th className="r" style={{ width: 110 }}>ใบสำคัญ</th><th style={{ width: 120 }}>เอกสารล่าสุด</th><th className="co-act-h"></th></tr>;
  return (
    <div className="card">
      <p className="hint">บริษัทที่สร้างผิดหรือไม่ใช้แล้ว: <b>ลบ</b> = ซ่อนจากตัวเลือกบริษัทและไม่นับในจำนวนบริษัทของลูกค้า — ข้อมูลยังอยู่ กู้คืนได้ที่ "บริษัทที่ลบแล้ว" · ลบบริษัทที่เลือกอยู่ไม่ได้ (เปลี่ยนบริษัทก่อน) · ลบบริษัทสุดท้ายไม่ได้ · แนะนำ <b>สำรองข้อมูลก่อน</b></p>
      <ErrorBox error={err ?? q.error} />
      <div className="table-wrap"><table className="grid">
        <thead>{head}</thead>
        <tbody>{active.map((r) => <tr key={r.id}>
          <td className="mono">{r.code} {r.current && <Pill tone="n">ใช้อยู่</Pill>}</td><td className="co-name">{r.name_th}</td>{me?.user.is_platform && <td className="mono small">{r.tenant_code}</td>}
          <td className="r num">{r.doc_count.toLocaleString()}</td><td className="r num">{r.journal_count.toLocaleString()}</td><td className="nowrap">{r.last_date ? formatDate(r.last_date, ys) : <span className="muted">ไม่มี</span>}</td>
          <td><div className="co-actions"><button type="button" onClick={() => { setRecode(r); setNewCode(r.code); setErr(null); }} title="แก้รหัสบริษัท (ข้อมูลทั้งหมดอ้างบริษัทด้วยรหัสภายใน ไม่กระทบเอกสาร)">แก้รหัส</button>{' '}
            <button type="button" onClick={() => { setErr(null); setCp({ row: r, code: '', name: `${r.name_th} (สำเนา)`, mode: 'new', groups: [...ALL_COPY_GROUPS], start: r.next_start ?? `${new Date().getFullYear() + 1}-01-01` }); }} title="สร้างบริษัทใหม่จากบริษัทนี้ — บริษัทเดิมไม่ถูกลบหรือแก้ไข">คัดลอกบริษัท</button>{' '}
            {!r.current && <><button type="button" onClick={() => backup(r)} title="เปิดบริษัทนี้แล้วไปหน้าสำรองข้อมูล">สำรองข้อมูลก่อน</button>{' '}
            <button type="button" className="danger" disabled={active.length < 2} title={active.length < 2 ? 'ลบบริษัทสุดท้ายไม่ได้' : undefined} onClick={() => { setDel(r); setCode(''); setTotp(''); setErr(null); }}>ลบบริษัท</button></>}</div></td>
        </tr>)}</tbody>
      </table></div>
      <h3 style={{ marginTop: 18 }}>บริษัทที่ลบแล้ว {gone.length > 0 && <span className="muted small">({gone.length})</span>}</h3>
      {gone.length === 0 ? <p className="muted">ไม่มี</p> : <div className="table-wrap"><table className="grid">
        <thead>{head}</thead>
        <tbody>{gone.map((r) => <tr key={r.id} className="muted-row">
          <td className="mono">{r.code}</td><td className="co-name">{r.name_th}<div className="muted small">ลบเมื่อ {formatDate(String(r.deleted_at).slice(0, 10), ys)}{r.deleted_by ? ` โดย ${r.deleted_by}` : ''}</div></td>{me?.user.is_platform && <td className="mono small">{r.tenant_code}</td>}
          <td className="r num">{r.doc_count.toLocaleString()}</td><td className="r num">{r.journal_count.toLocaleString()}</td><td className="nowrap">{r.last_date ? formatDate(r.last_date, ys) : <span className="muted">ไม่มี</span>}</td>
          <td><div className="co-actions"><button type="button" onClick={() => void restore(r)}>กู้คืน</button></div></td>
        </tr>)}</tbody>
      </table></div>}
      {del && <Modal title={`ลบบริษัท ${del.code}`} size="confirm" onClose={() => setDel(null)} footer={<><button onClick={() => setDel(null)}>ยกเลิก</button>
        <button className="danger" disabled={busy || code.trim().toUpperCase() !== del.code.toUpperCase()} onClick={() => void doDelete()}>ลบบริษัท</button></>}>
        <p><b>{del.code} · {del.name_th}</b></p>
        <p>มีเอกสาร <b>{del.doc_count.toLocaleString()}</b> ฉบับ · ใบสำคัญ <b>{del.journal_count.toLocaleString()}</b> ใบ · เอกสารล่าสุด <b>{del.last_date ? formatDate(del.last_date, ys) : 'ไม่มี'}</b></p>
        <p className="hint">ลบแล้วบริษัทจะหายจากตัวเลือกบริษัทของทุกคน — ข้อมูลไม่ถูกลบ กู้คืนได้ที่ "บริษัทที่ลบแล้ว" · ถ้ายังไม่ได้สำรองข้อมูล กด "สำรองข้อมูลก่อน" ในรายการ</p>
        <Field label={`พิมพ์รหัสบริษัท ${del.code} เพื่อยืนยัน`} req><input value={code} onChange={(e) => setCode(e.target.value)} autoFocus aria-label="รหัสบริษัทเพื่อยืนยัน" /></Field>
        <Field label="รหัสยืนยันตัวตน 6 หลัก" hint="เฉพาะบัญชีที่เปิดยืนยันสองขั้น (จากแอปยืนยันตัวตน)"><input value={totp} inputMode="numeric" maxLength={11} onChange={(e) => setTotp(e.target.value)} aria-label="รหัสยืนยันตัวตน" /></Field>
        <ErrorBox error={err} />
      </Modal>}
      {recode && <Modal title={`แก้รหัสบริษัท ${recode.code}`} size="confirm" onClose={() => setRecode(null)} footer={<><button onClick={() => setRecode(null)}>ยกเลิก</button>
        <button className="primary" disabled={busy || !newCode.trim() || newCode.trim() === recode.code} onClick={() => void saveCode()}>บันทึก</button></>}>
        <p><b>{recode.code} · {recode.name_th}</b></p>
        <Field label="รหัสบริษัทใหม่" req hint="ตัวอักษรอังกฤษ ตัวเลข _ - · ห้ามซ้ำกับบริษัทอื่น · เอกสาร ใบสำคัญ การเชื่อม POS/Living แฟ้มสำรอง อ้างบริษัทด้วยรหัสภายใน จึงไม่กระทบ">
          <input autoFocus className="mono" value={newCode} maxLength={20} onChange={(e) => setNewCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveCode()} aria-label="รหัสบริษัทใหม่" /></Field>
        <ErrorBox error={err} />
      </Modal>}
      {cp && <Modal title={`คัดลอกบริษัท ${cp.row.code}`} onClose={() => !busy && setCp(null)} footer={<><button disabled={busy} onClick={() => setCp(null)}>ยกเลิก</button>
        <button className="primary" disabled={busy || !cp.code.trim() || !cp.name.trim() || (cp.mode === 'new' && !cp.start)} onClick={() => void doCopy()}>{busy ? 'กำลังคัดลอก…' : 'คัดลอก'}</button></>}>
        <p className="notebox">สร้าง<b>บริษัทใหม่</b>จาก {cp.row.code} · {cp.row.name_th} — <b>บริษัทเดิมไม่ถูกลบหรือแก้ไข</b> ใช้งานต่อได้ตามเดิม</p>
        <div className="form-grid">
          <Field label="รหัสบริษัทใหม่" req hint="ตัวอักษรอังกฤษ ตัวเลข _ - ห้ามซ้ำ"><input autoFocus className="mono" value={cp.code} maxLength={20} onChange={(e) => setCp({ ...cp, code: e.target.value })} aria-label="รหัสบริษัทใหม่" /></Field>
          <Field label="ชื่อบริษัทใหม่" req><input value={cp.name} maxLength={120} onChange={(e) => setCp({ ...cp, name: e.target.value })} aria-label="ชื่อบริษัทใหม่" /></Field>
        </div>
        <div className="seg" role="radiogroup" aria-label="ข้อมูลที่คัดลอก" style={{ margin: '8px 0' }}>
          <button type="button" className={cp.mode === 'new' ? 'on' : ''} aria-pressed={cp.mode === 'new'} onClick={() => setCp({ ...cp, mode: 'new' })}>เปิดแฟ้มข้อมูลใหม่</button>
          <button type="button" className={cp.mode === 'full' ? 'on' : ''} aria-pressed={cp.mode === 'full'} onClick={() => setCp({ ...cp, mode: 'full' })}>ทั้งหมด</button>
        </div>
        {cp.mode === 'full'
          ? <p className="hint">คัดลอกทุกอย่าง: เอกสาร ใบสำคัญ ยอดยกมา ปีบัญชี/งวด (ที่ปิดแล้วยังปิด) ทรัพย์สิน ข้อมูลหลัก ค่าตั้งระบบ รูป แบบฟอร์ม · ตรวจจำนวนรายการและยอดเดบิต/เครดิตให้เท่าบริษัทเดิม ไม่เท่า = ยกเลิกทั้งหมด · สิทธิ์ผู้ใช้ให้ตามกลุ่มผู้ใช้เหมือนสร้างบริษัทใหม่ · บริษัทเดิมมีเอกสาร {cp.row.doc_count.toLocaleString()} ฉบับ ใบสำคัญ {cp.row.journal_count.toLocaleString()} ใบ</p>
          : <>
            <Field label="วันเริ่มปีบัญชีของบริษัทใหม่" req hint="ค่าแนะนำ = วันถัดจากสิ้นปีบัญชีที่ทำงานอยู่ของบริษัทเดิม"><DateInput value={cp.start} onChange={(v) => setCp({ ...cp, start: v })} /></Field>
            <CopyGroupsPicker value={cp.groups} onChange={(g) => setCp({ ...cp, groups: g })} />
          </>}
        <ErrorBox error={err} />
      </Modal>}
      {done && <Modal title="คัดลอกบริษัทแล้ว" size="confirm" onClose={() => setDone(null)} footer={<><button onClick={() => setDone(null)}>ปิด</button>
        <button className="primary" onClick={() => void select({ company_id: done.id }).then(() => { setDone(null); nav('/settings/company'); })}>เปิดบริษัท {done.code}</button></>}>
        <p>สร้างบริษัท <b>{done.code}</b> แล้ว ({done.seconds.toLocaleString()} วินาที){done.full && done.journals !== undefined ? <> · ตรวจแล้ว ใบสำคัญ {done.journals.toLocaleString()} ใบ ยอดเดบิต/เครดิตเท่าบริษัทเดิม</> : ''}</p>
        <p className="hint">บริษัทใหม่อยู่ในตัวเลือกบริษัทด้านบนแล้ว · บริษัทเดิมไม่เปลี่ยน</p>
      </Modal>}
    </div>
  );
}
