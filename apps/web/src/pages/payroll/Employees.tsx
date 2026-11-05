import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { checkTaxId, fmt, TAX_BEARER_TH, WAGE_TYPE_TH, type AllowanceRule, type PayrollTaxRules } from '@buddy/core';
import { api, type Department } from '../../api';
import { useCan, useSession } from '../../session';
import { LkSelect, useLookups } from '../../components/LkSelect';
import { AddressFields } from '../../components/AddressFields';
import { MasterBar, useRowSelect } from '../../components/MasterBar';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, Tabs, toast, toastError, useHotkeys } from '../../ui';
import { RecNav, usePayItems, type PayItem } from './common';
import { ImportModal } from './Filing';
import { AddWrap } from '../../components/AddWrap';

interface Row { id: string; code: string; name: string; nickname: string | null; position: string | null; employee_type: string | null; hire_date: string; end_date: string | null; wage_type: string; status: string;
  tax_id_masked: string | null; department_code: string | null; branch_code: string | null; rate: string | null }
interface Salary { id: string; effective_from: string; wage_type: 'M' | 'D' | 'H'; rate: string; reason: string | null }
interface Recur { id: string; item_id: string; item_code: string; item_name: string; kind: string; amount: string; from_month: string; to_month: string | null; note: string | null }
interface Ytd { tax_year: number; through_month: number; regular: string; special: string; tax: string; special_tax: string; sso: string; pvd: string; note: string | null }
type Detail = Record<string, unknown> & { id: string; code: string; name: string; tax_id_masked: string | null; has_tax_id: boolean; bank_account_masked: string | null; has_bank_account: boolean;
  salary: Salary[]; recurring: Recur[]; allowance_years: number[]; ytd: Ytd[]; used: boolean };

export const useEmployees = (status = 'all', q = '') => useQuery({ queryKey: ['pay-employees', status, q], queryFn: () => api.get<Row[]>('/api/v1/pay/employees', { status, q }) });

/** ทะเบียนพนักงาน (ระบบเงินเดือน) */
export function EmployeesPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('PAY.EMP');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'A' | 'I' | 'all'>('A');
  const list = useEmployees(status, q);
  const rs = useRowSelect(list.data);
  const [imp, setImp] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: ['pay-employees'] });
  const rows = list.data ?? [];
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เงินเดือน" title="ทะเบียนพนักงาน" lead="ข้อมูลพนักงาน อัตราค่าจ้าง ภาษี ประกันสังคม กองทุนสำรองเลี้ยงชีพ ค่าลดหย่อน — เลขประจำตัวประชาชนแสดงเฉพาะ 4 ตัวท้าย (ดูเลขเต็มบันทึกในแฟ้มบันทึกเหตุการณ์)" />
      <MasterBar rs={rs} word="พนักงาน" label={(r) => `${r.code} ${r.name}`} onAdd={() => nav('/pay/employees/new')} onEdit={(r) => nav(`/pay/employees/${r.id}`)} canAdd={can('add')} canEdit={can('edit')}
        onDelete={(r) => api.del(`/api/v1/pay/employees/${r.id}`).then(reload)} canDelete={can('delete')}
        deleteText={(r) => `ลบพนักงาน ${r.code} ${r.name}? ลบได้เฉพาะพนักงานที่ยังไม่มีรอบเงินเดือน — ถ้ามีแล้วให้ใส่วันที่ออก`} />
      <div className="toolbar">
        <span className="search-box"><input type="search" autoFocus placeholder="ค้นหารหัส ชื่อ นามสกุล ชื่อเล่น" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" /><button title="ค้นหา" onClick={() => list.refetch()}>🔍</button></span>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'A')} aria-label="สถานะ"><option value="A">ใช้งานอยู่</option><option value="I">เลิกใช้</option><option value="all">ทั้งหมด</option></select>
        <span className="muted small">{rows.length.toLocaleString()} คน</span>
        <button disabled={!can('add')} onClick={() => setImp(true)}>⬆ นำเข้าจาก Excel</button>
      </div>
      <ErrorBox error={list.error} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 90 }}>รหัส</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th style={{ width: 70 }}>แผนก</th><th style={{ width: 70 }}>สาขา</th><th style={{ width: 100 }}>เริ่มงาน</th>
            <th style={{ width: 80 }}>ค่าจ้าง</th><th className="r" style={{ width: 120 }}>อัตรา</th><th style={{ width: 110 }}>เลขประชาชน</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {rows.map((r, i) => <tr key={r.id} className={cx('row-open', rs.cls(i))} onMouseEnter={rs.hover(i)} tabIndex={0} onClick={() => nav(`/pay/employees/${r.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/pay/employees/${r.id}`)}>
              <td className="mono">{r.code}</td><td>{r.name}{r.nickname ? <span className="muted"> ({r.nickname})</span> : null}</td><td>{r.position}</td><td className="mono">{r.department_code}</td><td className="mono">{r.branch_code}</td>
              <td><DateText v={r.hire_date} /></td><td>{WAGE_TYPE_TH[r.wage_type as 'M']}</td><td className="r"><Money v={r.rate} /></td><td className="mono muted">{r.tax_id_masked}</td>
              <td>{r.end_date ? <Pill tone="x">ออก <DateText v={r.end_date} /></Pill> : r.status === 'I' ? <Pill tone="d">เลิกใช้</Pill> : null}</td></tr>)}
            {list.data && !rows.length && <tr><td colSpan={10} className="empty">ยังไม่มีพนักงาน — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['↑↓', 'เลือก'], ['คลิก/Enter', 'เปิด'], ['Del', 'ลบ']]} />
      {imp && <ImportModal<{ row: number; code: string; action: string; name: string | null }> title="นำเข้าพนักงานจาก Excel"
        intro="หนึ่งแถว = พนักงานหนึ่งคน · รหัสใหม่ = เพิ่มพนักงาน (ต้องมีชื่อ วันเริ่มงาน อัตราค่าจ้าง) · รหัสเดิม = แก้เฉพาะช่องที่กรอก · ตรวจทั้งแฟ้มก่อนบันทึก"
        templateUrl="/api/v1/pay/employees/import/template" templateName="นำเข้าพนักงาน.xlsx" postUrl="/api/v1/pay/employees/import"
        cols={[['ทำรายการ', (x) => x.action], ['ชื่อ', (x) => x.name]]} onClose={() => setImp(false)} onDone={() => { setImp(false); reload(); }} />}
    </div>
  );
}

type Form = Record<string, string | boolean>;
const EMPTY: Form = { code: '', title: '', first_name: '', last_name: '', first_name_en: '', last_name_en: '', nickname: '', tax_id: '', gender: '', birth_date: '', nationality: 'ไทย',
  reg_house_no: '', reg_moo: '', reg_village: '', reg_building: '', reg_soi: '', reg_road: '', reg_subdistrict: '', reg_district: '', reg_province: '', reg_postcode: '', reg_geo_code: '', current_address: '', phone: '', email: '',
  department_id: '', branch_id: '', position: '', employee_type: 'ประจำ', hire_date: '', end_date: '', end_reason: '', pay_method: 'B', bank_id: '', bank_account_no: '', bank_account_name: '',
  tax_bearer: 'W', sso_insured: true, sso_hospital: '', pvd_member: false, pvd_join_date: '', pvd_employee_rate: '0', pvd_employer_rate: '0', note: '', status: 'A', wage_type: 'M', rate: '' };
const TEXT: Array<[string, string, number, boolean?]> = [['title', 'คำนำหน้า', 30], ['first_name', 'ชื่อ', 100, true], ['last_name', 'นามสกุล', 100], ['nickname', 'ชื่อเล่น', 60], ['first_name_en', 'ชื่ออังกฤษ', 100], ['last_name_en', 'นามสกุลอังกฤษ', 100]];

/** รายละเอียดพนักงาน: ข้อมูลส่วนตัว · การจ้างและค่าจ้าง · ภาษีและกองทุน · ค่าลดหย่อน · ยอดยกมาต้นปี · รายการประจำ */
export function EmployeeFormPage() {
  const { id: rid } = useParams();
  const id = rid === 'new' ? undefined : rid;
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useCan('PAY.EMP');
  const { me } = useSession();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const lk = useLookups('BANK,70,71,73,74,76');
  const all = useEmployees('all');
  const cur = useQuery({ enabled: !!id, queryKey: ['pay-employee', id], queryFn: () => api.get<Detail>(`/api/v1/pay/employees/${id}`), staleTime: 0 });
  const [f, setF] = useState<Form | null>(id ? null : { ...EMPTY });
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState('person');
  const [err, setErr] = useState<unknown>(null);
  const [revealed, setRevealed] = useState<{ tax_id: string | null; bank_account_no: string | null } | null>(null);
  const [askDel, setAskDel] = useState(false);
  const x = cur.data;
  useEffect(() => {
    if (!x) return;
    setF(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, k === 'tax_id' || k === 'bank_account_no' || k === 'rate' ? '' : typeof EMPTY[k] === 'boolean' ? !!x[k] : x[k] == null ? '' : String(x[k])])) as Form);
    setRevealed(null); setDirty(false);
  }, [x]);
  const set = (p: Form) => { setF((v) => ({ ...v!, ...p })); setDirty(true); };
  const s = (k: string) => String(f?.[k] ?? '');
  const readOnly = !!id && !can('edit');
  const taxIdWarn = s('tax_id') && /^\d{13}$/.test(s('tax_id').replace(/\D/g, '')) && !checkTaxId(s('tax_id')).ok ? 'เลขไม่ถูกต้อง (หลักสุดท้ายไม่ตรง)' : undefined;
  const reveal = async () => {
    try { const r = await api.post<{ tax_id: string | null; bank_account_no: string | null }>(`/api/v1/pay/employees/${id}/reveal`); setRevealed(r); setF((v) => ({ ...v!, tax_id: r.tax_id ?? '', bank_account_no: r.bank_account_no ?? '' })); }
    catch (e) { toastError(e); }
  };
  const save = async () => {
    if (!f || readOnly || !can(id ? 'edit' : 'add')) return;
    setErr(null);
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' && v === '' ? null : v]));
    body.pvd_employee_rate = s('pvd_employee_rate') || '0'; body.pvd_employer_rate = s('pvd_employer_rate') || '0';
    // เลขบัตร/เลขบัญชีที่ยังไม่ได้แสดง = คงค่าเดิม
    if (id && !revealed) { if (!s('tax_id')) delete body.tax_id; if (!s('bank_account_no')) delete body.bank_account_no; }
    if (id) { delete body.rate; delete body.wage_type; }
    try {
      const r = id ? await api.put<{ id: string }>(`/api/v1/pay/employees/${id}`, body) : await api.post<{ id: string }>('/api/v1/pay/employees', body);
      toast(`บันทึกพนักงาน ${s('code')} แล้ว`); setDirty(false);
      qc.invalidateQueries({ queryKey: ['pay-employees'] }); qc.invalidateQueries({ queryKey: ['pay-employee', r.id] });
      if (!id) nav(`/pay/employees/${r.id}`, { replace: true });
    } catch (e) { setErr(e); }
  };
  const back = () => { if (!dirty || window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ออกโดยไม่บันทึก?')) nav('/pay/employees'); };
  useHotkeys({ F9: save, 'Ctrl+S': save, Escape: back }, []);
  const reload = () => qc.invalidateQueries({ queryKey: ['pay-employee', id] });
  const branches = me?.branches ?? [];
  return (
    <div className="page" data-tone="setup">
      <div className="doc-title"><p className="eyebrow">เงินเดือน › ทะเบียนพนักงาน</p><h1>{id ? `${x?.code ?? ''} ${x?.name ?? ''}` : 'พนักงานใหม่'}</h1>
        <span className="doc-state">{!id ? <Pill tone="m">ใหม่ — ยังไม่บันทึก</Pill> : x?.end_date ? <Pill tone="x">ออกแล้ว <DateText v={String(x.end_date)} /></Pill> : x?.status === 'I' ? <Pill tone="d">เลิกใช้</Pill> : <Pill tone="n">ทำงานอยู่</Pill>}
          {dirty && <Pill tone="c">มีการแก้ไขที่ยังไม่บันทึก</Pill>}</span></div>
      <div className="toolbar">
        <button onClick={() => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) { setF({ ...EMPTY }); nav('/pay/employees/new'); } }}>+ ใหม่</button>
        <button className="primary" disabled={readOnly || !f} onClick={save}>บันทึก <kbd>F9</kbd></button>
        <button disabled={!id || !can('delete') || x?.used} title={x?.used ? 'มีรอบเงินเดือนแล้ว — ใส่วันที่ออกแทน' : undefined} onClick={() => setAskDel(true)}>ลบ</button>
        <RecNav ids={(all.data ?? []).map((r) => r.id)} cur={id} go={(to) => { if (!dirty || window.confirm('ทิ้งการแก้ไข?')) nav(`/pay/employees/${to}`); }} />
        <button onClick={back}>รายการ <kbd>Esc</kbd></button>
      </div>
      <ErrorBox error={err ?? cur.error} />
      {f && <div onKeyDown={(e) => navKey(e)}>
        <div className="form-grid">
          <Field label="รหัสพนักงาน" req><input className="mono" autoFocus={!id} value={s('code')} maxLength={20} disabled={readOnly} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
          <Field label="คำนำหน้า"><LkSelect byName table="70" rows={lk.data?.['70']} value={s('title')} disabled={readOnly} onChange={(v) => set({ title: v })} aria-label="คำนำหน้า" /></Field>
          {TEXT.slice(1, 3).map(([k, l, m, req]) => <Field key={k} label={l} req={req}><input value={s(k)} maxLength={m} disabled={readOnly} onChange={(e) => set({ [k]: e.target.value })} /></Field>)}
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[{ key: 'person', label: 'ข้อมูลส่วนตัว' }, { key: 'job', label: 'การจ้างและค่าจ้าง' }, { key: 'tax', label: 'ภาษีและกองทุน' },
          ...(id ? [{ key: 'allow', label: 'ค่าลดหย่อน' }, { key: 'ytd', label: 'ยอดยกมาต้นปี' }, { key: 'recur', label: 'รายการประจำ', badge: x?.recurring.length || undefined }] : [])]} />
        {tab === 'person' && <div className="fa-grid">
          <fieldset className="box"><legend>บุคคล</legend>
            {TEXT.slice(3).map(([k, l, m]) => <Field key={k} label={l}><input value={s(k)} maxLength={m} disabled={readOnly} onChange={(e) => set({ [k]: e.target.value })} /></Field>)}
            <Field label="เลขประจำตัวประชาชน" hint={id && x?.has_tax_id && !revealed ? <>ปัจจุบัน {x.tax_id_masked} · <button type="button" className="link" onClick={reveal}>แสดงเลขเต็ม</button> (บันทึกในแฟ้มเหตุการณ์) · ป้อนใหม่ = เปลี่ยน</> : '13 หลัก (คนต่างชาติ: เลขหนังสือเดินทาง) — ใช้ยื่น ภ.ง.ด.1 และประกันสังคม'} error={taxIdWarn}>
              <input className="mono" value={s('tax_id')} maxLength={20} disabled={readOnly} placeholder={id && x?.has_tax_id && !revealed ? x.tax_id_masked ?? '' : '0-0000-00000-00-0'} onChange={(e) => set({ tax_id: e.target.value })} /></Field>
            <Field label="เพศ"><select value={s('gender')} disabled={readOnly} onChange={(e) => set({ gender: e.target.value })}><option value="">—</option><option value="M">ชาย</option><option value="F">หญิง</option></select></Field>
            <Field label="วันเกิด" hint="เช่น 15/03/2530"><DateInput value={s('birth_date')} disabled={readOnly} onChange={(v) => set({ birth_date: v })} /></Field>
            <Field label="สัญชาติ"><LkSelect byName table="76" rows={lk.data?.['76']} value={s('nationality')} disabled={readOnly} onChange={(v) => set({ nationality: v })} /></Field>
            <Field label="โทรศัพท์"><input value={s('phone')} maxLength={60} disabled={readOnly} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="อีเมล" hint="ใช้ส่งสลิปเงินเดือน"><input type="email" value={s('email')} maxLength={120} disabled={readOnly} onChange={(e) => set({ email: e.target.value })} /></Field>
          </fieldset>
          <fieldset className="box"><legend>ที่อยู่ตามทะเบียนบ้าน (ใช้ใน ภ.ง.ด.1ก และ 50 ทวิ)</legend>
            <AddressFields value={f ?? {}} onChange={(p) => set(p)} target={{ kind: 'employee' }} title="ที่อยู่ตามทะเบียนบ้าน" disabled={readOnly} />
            <Field label="ที่อยู่ปัจจุบัน" hint="ว่าง = ตามทะเบียนบ้าน" wide><textarea rows={2} value={s('current_address')} maxLength={2000} disabled={readOnly} onChange={(e) => set({ current_address: e.target.value })} /></Field>
          </fieldset>
        </div>}
        {tab === 'job' && <div className="fa-grid">
          <fieldset className="box"><legend>การจ้าง</legend>
            <Field label="แผนก" hint="ค่าใช้จ่ายเงินเดือนลงบัญชีตามแผนก"><AddWrap kind="dept"><select value={s('department_id')} disabled={readOnly} onChange={(e) => set({ department_id: e.target.value })}><option value="">—</option>{depts.data?.map((x2) => <option key={x2.id} value={x2.id}>{x2.code} {x2.name_th}</option>)}</select></AddWrap></Field>
            <Field label="สาขา" hint="ว่าง = สำนักงานใหญ่ · รอบเงินเดือนทำแยกตามสาขา"><select value={s('branch_id')} disabled={readOnly} onChange={(e) => set({ branch_id: e.target.value })}><option value="">— สำนักงานใหญ่</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.code} {b.name}</option>)}</select></Field>
            <Field label="ตำแหน่ง"><LkSelect byName table="71" rows={lk.data?.['71']} value={s('position')} disabled={readOnly} onChange={(v) => set({ position: v })} /></Field>
            <Field label="ประเภทพนักงาน"><LkSelect byName table="73" rows={lk.data?.['73']} value={s('employee_type')} disabled={readOnly} onChange={(v) => set({ employee_type: v })} /></Field>
            <Field label="วันเริ่มงาน" req hint="เช่น 01/01/2569"><DateInput value={s('hire_date')} disabled={readOnly} onChange={(v) => set({ hire_date: v })} /></Field>
            <Field label="วันที่ออก" hint="วันทำงานวันสุดท้าย — เดือนที่ออกภาษีทั้งปีคิดจบ"><DateInput value={s('end_date')} disabled={readOnly} onChange={(v) => set({ end_date: v })} /></Field>
            {s('end_date') && <Field label="สาเหตุที่ออก" req><LkSelect byName table="74" rows={lk.data?.['74']} value={s('end_reason')} disabled={readOnly} onChange={(v) => set({ end_reason: v })} /></Field>}
            <Field label="สถานะ"><select value={s('status')} disabled={readOnly} onChange={(e) => set({ status: e.target.value })}><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></Field>
          </fieldset>
          <fieldset className="box"><legend>ค่าจ้างและการรับเงิน</legend>
            {!id && <>
              <Field label="ประเภทค่าจ้าง" req><select value={s('wage_type')} onChange={(e) => set({ wage_type: e.target.value })}>{Object.entries(WAGE_TYPE_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label={`อัตราค่าจ้าง (บาทต่อ${s('wage_type') === 'M' ? 'เดือน' : s('wage_type') === 'D' ? 'วัน' : 'ชั่วโมง'})`} req><MoneyInput value={s('rate')} onChange={(v) => set({ rate: v })} /></Field>
            </>}
            <Field label="รับเงินเดือน"><select value={s('pay_method')} disabled={readOnly} onChange={(e) => set({ pay_method: e.target.value })}><option value="B">โอนเข้าบัญชี</option><option value="C">เงินสด</option></select></Field>
            {s('pay_method') === 'B' && <>
              <Field label="ธนาคาร"><LkSelect table="01" rows={lk.data?.BANK} byId value={s('bank_id')} disabled={readOnly} onChange={(v) => set({ bank_id: v })} /></Field>
              <Field label="เลขที่บัญชี" hint={id && x?.has_bank_account && !revealed ? <>ปัจจุบัน {x.bank_account_masked} · <button type="button" className="link" onClick={reveal}>แสดงเลขเต็ม</button></> : 'ตัวเลข 10–15 หลัก'}>
                <input className="mono" value={s('bank_account_no')} maxLength={20} disabled={readOnly} placeholder={id && x?.has_bank_account && !revealed ? x.bank_account_masked ?? '' : ''} onChange={(e) => set({ bank_account_no: e.target.value })} /></Field>
              <Field label="ชื่อบัญชี"><input value={s('bank_account_name')} maxLength={120} disabled={readOnly} onChange={(e) => set({ bank_account_name: e.target.value })} /></Field>
            </>}
            <Field label="หมายเหตุ" wide><textarea rows={2} value={s('note')} maxLength={2000} disabled={readOnly} onChange={(e) => set({ note: e.target.value })} /></Field>
          </fieldset>
          {id && x && <SalaryBox id={id} rows={x.salary} canEdit={can('edit')} onChanged={reload} />}
        </div>}
        {tab === 'tax' && <div className="fa-grid">
          <fieldset className="box"><legend>ภาษีเงินได้ (ภ.ง.ด.1)</legend>
            <Field label="ผู้รับภาระภาษี" hint="บริษัทออกให้: ภาษีที่ออกให้นับเป็นเงินได้ด้วย (ไม่หักจากเงินเดือน)"><select value={s('tax_bearer')} disabled={readOnly} onChange={(e) => set({ tax_bearer: e.target.value })}>{Object.entries(TAX_BEARER_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </fieldset>
          <fieldset className="box"><legend>ประกันสังคม</legend>
            <label className="check"><input type="checkbox" checked={!!f.sso_insured} disabled={readOnly} onChange={(e) => set({ sso_insured: e.target.checked })} /> เป็นผู้ประกันตน มาตรา 33 (หัก 5% ของค่าจ้าง 1,650–17,500 บาท)</label>
            <Field label="สถานพยาบาล"><input value={s('sso_hospital')} maxLength={120} disabled={readOnly} onChange={(e) => set({ sso_hospital: e.target.value })} /></Field>
          </fieldset>
          <fieldset className="box"><legend>กองทุนสำรองเลี้ยงชีพ</legend>
            <label className="check"><input type="checkbox" checked={!!f.pvd_member} disabled={readOnly} onChange={(e) => set({ pvd_member: e.target.checked })} /> เป็นสมาชิก (เปิดใช้ที่ ตั้งค่าระบบเงินเดือน ข้อ 3 ด้วย)</label>
            {f.pvd_member && <>
              <Field label="วันที่เข้ากองทุน"><DateInput value={s('pvd_join_date')} disabled={readOnly} onChange={(v) => set({ pvd_join_date: v })} /></Field>
              <Field label="อัตราเงินสะสม (ลูกจ้าง) %" req hint="2–15%"><MoneyInput value={s('pvd_employee_rate')} disabled={readOnly} onChange={(v) => set({ pvd_employee_rate: v })} /></Field>
              <Field label="อัตราเงินสมทบ (นายจ้าง) %" hint="ไม่น้อยกว่าอัตราสะสม"><MoneyInput value={s('pvd_employer_rate')} disabled={readOnly} onChange={(v) => set({ pvd_employer_rate: v })} /></Field>
            </>}
          </fieldset>
        </div>}
        {tab === 'allow' && id && <AllowanceBox id={id} canEdit={can('edit')} />}
        {tab === 'ytd' && id && x && <YtdBox id={id} rows={x.ytd} canEdit={can('edit')} onChanged={reload} />}
        {tab === 'recur' && id && x && <RecurBox id={id} rows={x.recurring} canEdit={can('edit')} onChanged={reload} />}
      </div>}
      <KeyHints keys={[['Enter', 'ช่องถัดไป'], ['F9', 'บันทึก'], ['Esc', 'กลับรายการ']]} />
      {askDel && <Confirm danger title="ลบพนักงาน" text={`ลบพนักงาน ${x?.code}? ลบได้เฉพาะพนักงานที่ยังไม่มีรอบเงินเดือน`} okText="ลบ" onClose={() => setAskDel(false)}
        onOk={() => api.del(`/api/v1/pay/employees/${id}`).then(() => { toast('ลบพนักงานแล้ว'); qc.invalidateQueries({ queryKey: ['pay-employees'] }); nav('/pay/employees'); }).catch((e) => { setAskDel(false); toastError(e); })} />}
    </div>
  );
}

/** ประวัติค่าจ้าง: เพิ่มอัตราใหม่ (มีผลตั้งแต่วันที่) · ลบรายการที่ป้อนผิด (ต้องเหลืออย่างน้อย 1) */
function SalaryBox({ id, rows, canEdit, onChanged }: { id: string; rows: Salary[]; canEdit: boolean; onChanged: () => void }) {
  const [add, setAdd] = useState<{ effective_from: string; wage_type: string; rate: string; reason: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    if (!add) return;
    try { await api.post(`/api/v1/pay/employees/${id}/salary`, add); toast('บันทึกอัตราค่าจ้างแล้ว'); setAdd(null); onChanged(); } catch (e) { setErr(e); }
  };
  const last = rows.at(-1);
  return (
    <fieldset className="box"><legend>ประวัติค่าจ้าง</legend>
      <table className="grid compact">
        <thead><tr><th>มีผลตั้งแต่</th><th>ประเภท</th><th className="r">อัตรา</th><th>เหตุผล</th><th /></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td><DateText v={r.effective_from} /></td><td>{WAGE_TYPE_TH[r.wage_type]}</td><td className="r"><Money v={r.rate} /></td><td className="small">{r.reason}</td>
          <td>{canEdit && rows.length > 1 && <button className="link" title="ลบรายการนี้ (ป้อนผิด)" onClick={() => window.confirm('ลบอัตราค่าจ้างรายการนี้?') && api.del(`/api/v1/pay/employees/${id}/salary/${r.id}`).then(onChanged).catch(toastError)}>ลบ</button>}</td></tr>)}</tbody>
      </table>
      <button disabled={!canEdit} onClick={() => setAdd({ effective_from: '', wage_type: last?.wage_type ?? 'M', rate: '', reason: '' })}>+ ปรับอัตราค่าจ้าง</button>
      {add && <Modal title="ปรับอัตราค่าจ้าง" size="confirm" onClose={() => setAdd(null)} footer={<><button onClick={() => setAdd(null)}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก</button></>}>
        <ErrorBox error={err} />
        <div className="form-grid" onKeyDown={(e) => navKey(e)}>
          <Field label="มีผลตั้งแต่" req hint="กลางเดือน = คิดตามวันแต่ละช่วง"><DateInput autoFocus value={add.effective_from} onChange={(v) => setAdd({ ...add, effective_from: v })} /></Field>
          <Field label="ประเภทค่าจ้าง"><select value={add.wage_type} onChange={(e) => setAdd({ ...add, wage_type: e.target.value })}>{Object.entries(WAGE_TYPE_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="อัตราใหม่" req><MoneyInput value={add.rate} onChange={(v) => setAdd({ ...add, rate: v })} /></Field>
          <Field label="เหตุผล"><input value={add.reason} maxLength={200} onChange={(e) => setAdd({ ...add, reason: e.target.value })} placeholder="ปรับประจำปี" /></Field>
        </div>
      </Modal>}
    </fieldset>
  );
}

/** ค่าลดหย่อนรายปี — ปีใหม่ไม่ยกมาเอง: กด "คัดลอกจากปี…" แล้วตรวจแก้ก่อนบันทึก */
function AllowanceBox({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ['pay-allow', id, year], queryFn: () => api.get<{ values: Record<string, unknown>; saved: boolean; previous: { year: number; values: Record<string, unknown> } | null; rules: PayrollTaxRules }>(`/api/v1/pay/employees/${id}/allowances/${year}`) });
  const [v, setV] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { if (q.data) setV(q.data.values); }, [q.data]);
  const save = async () => { setErr(null); try { await api.put(`/api/v1/pay/employees/${id}/allowances/${year}`, { values: v }); toast(`บันทึกค่าลดหย่อนปี ${year + 543} แล้ว — คำนวณรอบเงินเดือนใหม่เพื่อใช้ค่านี้`); q.refetch(); } catch (e) { setErr(e); } };
  const rule = (a: AllowanceRule) => a.input === 'check' ? `${fmt(a.per_unit, { places: 0 })} บาท` : a.input === 'count' ? `คนละ ${fmt(a.per_unit, { places: 0 })} (ไม่เกิน ${a.max_count} คน)`
    : [a.cap ? `ไม่เกิน ${fmt(a.cap, { places: 0 })}` : '', a.pct ? `${a.pct}% ของเงินได้` : '', a.stage === 'donation_double' ? 'หักได้ 2 เท่า' : ''].filter(Boolean).join(' · ');
  return (
    <div>
      <div className="toolbar">
        <label>ปีภาษี <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-1, 0, 1].map((k) => { const y = new Date().getFullYear() + k; return <option key={y} value={y}>{y + 543}</option>; })}</select></label>
        {q.data && !q.data.saved && q.data.previous && <button onClick={() => setV(q.data!.previous!.values)} title="คัดลอกแล้วตรวจแก้ยอดเบี้ยประกัน/เงินบริจาคก่อนบันทึก">คัดลอกจากปี {q.data.previous.year + 543}</button>}
        <button className="primary" disabled={!canEdit} onClick={save}>บันทึกค่าลดหย่อน</button>
        {q.data && !q.data.saved && <Pill tone="c">ยังไม่ได้บันทึกค่าลดหย่อนปีนี้ — ใช้เฉพาะค่าใช้จ่าย ส่วนตัว และประกันสังคม</Pill>}
      </div>
      <ErrorBox error={err ?? q.error} />
      <p className="hint">หักค่าใช้จ่าย 50% ไม่เกิน 100,000 · ลดหย่อนส่วนตัว 60,000 · ประกันสังคมที่หักผ่านเงินเดือน และกองทุนสำรองเลี้ยงชีพที่หักผ่านเงินเดือน — โปรแกรมนับให้เอง</p>
      <table className="grid compact" style={{ maxWidth: 820 }}>
        <thead><tr><th>รายการ</th><th style={{ width: 170 }}>ป้อน</th><th>เกณฑ์</th></tr></thead>
        <tbody>{q.data?.rules.allowances.map((a) => <tr key={a.code}><td>{a.name_th}{a.hint && <div className="muted small">{a.hint}</div>}</td>
          <td>{a.input === 'check' ? <input type="checkbox" checked={!!v[a.code]} disabled={!canEdit} onChange={(e) => setV({ ...v, [a.code]: e.target.checked })} aria-label={a.name_th} />
            : a.input === 'count' ? <input type="number" min={0} max={a.max_count ?? 99} step={1} value={String(v[a.code] ?? '')} disabled={!canEdit} onChange={(e) => setV({ ...v, [a.code]: e.target.value })} aria-label={a.name_th} style={{ width: 80 }} />
            : <MoneyInput value={String(v[a.code] ?? '')} disabled={!canEdit} onChange={(x) => setV({ ...v, [a.code]: x })} aria-label={a.name_th} />}</td>
          <td className="small muted">{rule(a)}{a.group ? ` · กลุ่ม${a.group === 'life_health' ? 'ประกันชีวิต+สุขภาพ' : 'เกษียณ'} รวมไม่เกิน ${fmt(q.data!.rules.groups[a.group], { places: 0 })}` : ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** ยอดสะสมยกมา (เริ่มใช้โปรแกรมกลางปี): เงินได้ ภาษี ประกันสังคม ถึงสิ้นเดือนก่อนรอบแรก */
function YtdBox({ id, rows, canEdit, onChanged }: { id: string; rows: Ytd[]; canEdit: boolean; onChanged: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const cur = rows.find((r) => r.tax_year === year);
  const blank = { through_month: '', regular: '', special: '', tax: '', special_tax: '', sso: '', pvd: '', note: '' };
  const [f, setF] = useState<Record<string, string>>(blank);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { setF(cur ? Object.fromEntries(Object.entries({ ...blank, ...cur }).map(([k, x]) => [k, x == null ? '' : String(x)])) : blank); }, [year, rows]);   // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setErr(null);
    try { await api.put(`/api/v1/pay/employees/${id}/ytd/${year}`, { ...f, through_month: Number(f.through_month), note: f.note || null }); toast('บันทึกยอดยกมาแล้ว'); onChanged(); } catch (e) { setErr(e); }
  };
  const M: Array<[string, string]> = [['regular', 'เงินได้ประจำที่จ่ายแล้ว'], ['special', 'เงินได้ไม่ประจำ (โบนัส OT ฯลฯ)'], ['tax', 'ภาษีที่หักแล้วทั้งหมด'], ['special_tax', 'ภาษีของเงินได้ไม่ประจำ (ถ้าทราบ)'], ['sso', 'ประกันสังคมที่หักแล้ว'], ['pvd', 'กองทุนสำรองฯ ที่หักแล้ว']];
  return (
    <div>
      <p className="hint">ใช้เมื่อเริ่มใช้โปรแกรมระหว่างปี — ยอดตั้งแต่ ม.ค. ถึงสิ้นเดือนที่ระบุ (ก่อนรอบเงินเดือนแรกในโปรแกรม) เพื่อให้ภาษีเดือนต่อไปคิดทั้งปีถูกต้อง</p>
      <div className="toolbar"><label>ปีภาษี <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-1, 0].map((k) => { const y = new Date().getFullYear() + k; return <option key={y} value={y}>{y + 543}</option>; })}</select></label></div>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={(e) => navKey(e)}>
        <Field label="ยอดถึงสิ้นเดือน" req><select value={f.through_month} disabled={!canEdit} onChange={(e) => setF({ ...f, through_month: e.target.value })}><option value="">—</option>
          {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][i]}</option>)}</select></Field>
        {M.map(([k, l]) => <Field key={k} label={l}><MoneyInput value={f[k] ?? ''} disabled={!canEdit} onChange={(v) => setF({ ...f, [k]: v })} /></Field>)}
        <Field label="หมายเหตุ" wide><input value={f.note ?? ''} maxLength={200} disabled={!canEdit} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="จากระบบเงินเดือนเดิม" /></Field>
      </div>
      <div className="toolbar"><button className="primary" disabled={!canEdit} onClick={save}>บันทึกยอดยกมา</button>
        {cur && <button disabled={!canEdit} onClick={() => window.confirm('ลบยอดยกมาปีนี้?') && api.del(`/api/v1/pay/employees/${id}/ytd/${year}`).then(onChanged).catch(toastError)}>ลบยอดยกมา</button>}</div>
    </div>
  );
}

/** รายการประจำ: เงินได้/เงินหักแบบจำนวนเงินที่เกิดทุกงวด (ค่าตำแหน่ง ผ่อนเบิกล่วงหน้า กยศ.) */
function RecurBox({ id, rows, canEdit, onChanged }: { id: string; rows: Recur[]; canEdit: boolean; onChanged: () => void }) {
  const items = usePayItems();
  const [edit, setEdit] = useState<(Partial<Recur> & { amount: string; from_month: string }) | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const opts = (items.data ?? []).filter((x: PayItem) => x.calc === 'AMOUNT' && x.status === 'A');
  const save = async () => {
    if (!edit) return;
    setErr(null);
    const body = { item_id: edit.item_id, amount: edit.amount, from_month: edit.from_month, to_month: edit.to_month || null, note: edit.note || null };
    try {
      if (edit.id) await api.put(`/api/v1/pay/employees/${id}/recurring/${edit.id}`, body); else await api.post(`/api/v1/pay/employees/${id}/recurring`, body);
      toast('บันทึกรายการประจำแล้ว'); setEdit(null); onChanged();
    } catch (e) { setErr(e); }
  };
  return (
    <div>
      <p className="hint">โปรแกรมใส่รายการเหล่านี้ให้ทุกรอบเงินเดือนปกติในช่วงเดือนที่กำหนด — แก้ยอดเฉพาะเดือนได้ที่หน้ารอบเงินเดือน</p>
      <div className="toolbar"><button className="primary" disabled={!canEdit} onClick={() => setEdit({ amount: '', from_month: '' })}>+ เพิ่มรายการประจำ</button></div>
      <table className="grid compact" style={{ maxWidth: 820 }}>
        <thead><tr><th>รายการ</th><th style={{ width: 70 }}>ประเภท</th><th className="r" style={{ width: 120 }}>จำนวนเงิน</th><th>ตั้งแต่</th><th>ถึง</th><th>หมายเหตุ</th><th /></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} className="row-open" onClick={() => canEdit && setEdit({ ...r, from_month: r.from_month, to_month: r.to_month })}>
          <td><span className="mono">{r.item_code}</span> {r.item_name}</td><td>{r.kind === 'E' ? 'เงินได้' : 'เงินหัก'}</td><td className="r"><Money v={r.amount} /></td><td><DateText v={r.from_month} /></td><td>{r.to_month ? <DateText v={r.to_month} /> : 'ไม่กำหนด'}</td><td className="small">{r.note}</td>
          <td>{canEdit && <button className="link" onClick={(e) => { e.stopPropagation(); if (window.confirm('ลบรายการประจำนี้?')) api.del(`/api/v1/pay/employees/${id}/recurring/${r.id}`).then(onChanged).catch(toastError); }}>ลบ</button>}</td></tr>)}
          {!rows.length && <tr><td colSpan={7} className="empty">ยังไม่มีรายการประจำ</td></tr>}</tbody>
      </table>
      {edit && <Modal title={edit.id ? 'แก้ไขรายการประจำ' : 'เพิ่มรายการประจำ'} size="confirm" onClose={() => setEdit(null)} footer={<><button onClick={() => setEdit(null)}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก</button></>}>
        <ErrorBox error={err} />
        <div className="form-grid" onKeyDown={(e) => navKey(e)}>
          <Field label="รายการ" req><select autoFocus value={edit.item_id ?? ''} onChange={(e) => setEdit({ ...edit, item_id: e.target.value })}><option value="">— เลือก —</option>
            {opts.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name_th} ({x.kind === 'E' ? 'เงินได้' : 'เงินหัก'})</option>)}</select></Field>
          <Field label="จำนวนเงินต่องวด" req><MoneyInput value={edit.amount} onChange={(v) => setEdit({ ...edit, amount: v })} /></Field>
          <Field label="ตั้งแต่เดือน" req hint="วันใดก็ได้ในเดือนนั้น"><DateInput value={edit.from_month} onChange={(v) => setEdit({ ...edit, from_month: v })} /></Field>
          <Field label="ถึงเดือน" hint="ว่าง = ไม่กำหนด"><DateInput value={edit.to_month ?? ''} onChange={(v) => setEdit({ ...edit, to_month: v })} /></Field>
          <Field label="หมายเหตุ"><input value={edit.note ?? ''} maxLength={200} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}
