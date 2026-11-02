import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { allowanceBreakdown, bracketTax, d, fmt, GL_ROLES, monthTax, PAY_BUCKET_TH, PAY_CALC_TH, ssoContribution, TAX_BEARER_TH, type PayrollTaxRules, type SsoRate, type TaxBearer } from '@buddy/core';
import { api } from '../../api';
import { useCan } from '../../session';
import { AccountCell } from '../../components/AccountCell';
import { MasterBar, useRowSelect } from '../../components/MasterBar';
import { cx, DateText, ErrorBox, Field, KeyHints, Modal, Money, MoneyInput, navKey, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { usePayItems, type PayItem } from './common';

const PAY_ROLES = GL_ROLES.filter((r) => r.section === 'เงินเดือน');

/** รายการเงินได้/เงินหัก */
export function PayItemsPage() {
  const qc = useQueryClient();
  const can = useCan('PAY.ITEM');
  const list = usePayItems();
  const rs = useRowSelect(list.data);
  const [edit, setEdit] = useState<PayItem | 'new' | null>(null);
  const reload = () => qc.invalidateQueries({ queryKey: ['pay-items'] });
  const save = (x: PayItem, p: Partial<PayItem>) => api.put(`/api/v1/pay/items/${x.id}`, { ...x, ...p }).then(reload);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เงินเดือน" title="รายการเงินได้/เงินหัก" lead="กำหนดว่าแต่ละรายการคิดภาษีแบบเงินได้ประจำ/ไม่ประจำ นับเป็นค่าจ้างประกันสังคมหรือไม่ และลงบัญชีอะไร — รายการของโปรแกรม (เงินเดือน OT ภาษี ประกันสังคม) แก้ชื่อ/บัญชีได้ แต่ลบไม่ได้" />
      <ErrorBox error={list.error} />
      <MasterBar rs={rs} word="รายการ" label={(x) => `${x.code} ${x.name_th}`} onAdd={() => setEdit('new')} onEdit={(x) => setEdit(x)} canAdd={can('add')} canEdit={can('edit')}
        onToggle={(x) => (x.system_code ? Promise.reject(new Error('รายการของโปรแกรมเลิกใช้ไม่ได้')) : save(x, { status: x.status === 'A' ? 'I' : 'A' }))} isActive={(x) => x.status === 'A'}
        onDelete={(x) => api.del(`/api/v1/pay/items/${x.id}`).then(reload)} canDelete={can('delete')} />
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 80 }}>รหัส</th><th>ชื่อรายการ</th><th style={{ width: 70 }}>ประเภท</th><th style={{ width: 120 }}>ภาษี</th><th style={{ width: 70 }}>ประกันสังคม</th><th style={{ width: 120 }}>วิธีคิด</th><th>บัญชี</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>{list.data?.map((x, i) => <tr key={x.id} className={cx('row-open', rs.cls(i), x.status !== 'A' && 'cancelled')} onMouseEnter={rs.hover(i)} tabIndex={0} onClick={() => setEdit(x)} onKeyDown={(e) => e.key === 'Enter' && setEdit(x)}>
            <td className="mono">{x.code}</td><td>{x.name_th}{x.sign < 0 && <span className="muted small"> (ลดค่าจ้าง)</span>}</td><td>{x.kind === 'E' ? 'เงินได้' : 'เงินหัก'}</td><td>{x.kind === 'E' ? PAY_BUCKET_TH[x.tax_bucket] : ''}</td>
            <td>{x.sso_base ? '✓' : ''}</td><td className="small">{PAY_CALC_TH[x.calc]}{x.multiplier ? ` × ${d(x.multiplier).toString()}` : ''}</td>
            <td className="small">{x.account_no ? <><span className="mono">{x.account_no}</span> {x.account_name}</> : <span className="muted">{PAY_ROLES.find((r) => r.role === x.gl_role)?.label ?? x.gl_role} (การเชื่อมต่อบัญชี)</span>}</td>
            <td>{x.system_code ? <Pill tone="d">ของโปรแกรม</Pill> : x.status !== 'A' ? <Pill tone="x">เลิกใช้</Pill> : null}</td></tr>)}</tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่ม'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก']]} />
      {edit && <PayItemForm x={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function PayItemForm({ x, onClose, onSaved }: { x: PayItem | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan('PAY.ITEM');
  const sys = !!x?.system_code;
  const [f, setF] = useState<Record<string, string | boolean | null>>(x ? { code: x.code, name_th: x.name_th, name_en: x.name_en, kind: x.kind, tax_bucket: x.tax_bucket, sso_base: x.sso_base, pvd_base: x.pvd_base, calc: x.calc, sign: String(x.sign), gl_role: x.gl_role, account_id: x.account_id, status: x.status,
      multiplier: x.multiplier ? d(x.multiplier).toString() : '', multiplier_daily: x.multiplier_daily ? d(x.multiplier_daily).toString() : '' }
    : { code: '', name_th: '', name_en: '', kind: 'E', tax_bucket: 'S', sso_base: false, pvd_base: false, calc: 'AMOUNT', multiplier: '', multiplier_daily: '', sign: '1', gl_role: 'PAY_BENEFIT', account_id: null, status: 'A' });
  const [err, setErr] = useState<unknown>(null);
  const s = (k: string) => String(f[k] ?? '');
  const save = async () => {
    setErr(null);
    const body = { ...f, name_en: s('name_en') || null, multiplier: s('multiplier') || null, multiplier_daily: s('multiplier_daily') || null, sign: Number(f.sign), account_id: f.account_id || null };
    try { if (x) await api.put(`/api/v1/pay/items/${x.id}`, body); else await api.post('/api/v1/pay/items', body); toast(`บันทึกรายการ ${s('code').toUpperCase()} แล้ว`); onSaved(); } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const isE = f.kind === 'E';
  const roles = PAY_ROLES.filter((r) => (isE ? !r.role.endsWith('PAYABLE') && r.role !== 'PAY_ACCRUED' && r.role !== 'PAY_EMPLOYEE_ADVANCE' : r.role === 'PAY_DEDUCTION_PAYABLE' || r.role === 'PAY_EMPLOYEE_ADVANCE'));
  return (
    <Modal title={x ? `แก้ไขรายการ ${x.code}` : 'เพิ่มรายการเงินได้/เงินหัก'} onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!can(x ? 'edit' : 'add')} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid" onKeyDown={(e) => navKey(e)}>
        <Field label="รหัส" req hint="เช่น IN020 ES020"><input className="mono" autoFocus={!x} value={s('code')} maxLength={20} disabled={sys} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="ชื่อไทย" req><input autoFocus={!!x} value={s('name_th')} maxLength={120} onChange={(e) => setF({ ...f, name_th: e.target.value })} /></Field>
        <Field label="ชื่ออังกฤษ" hint="แสดงในสลิปภาษาอังกฤษ"><input value={s('name_en')} maxLength={120} onChange={(e) => setF({ ...f, name_en: e.target.value })} /></Field>
        <Field label="ประเภท"><select value={s('kind')} disabled={sys || !!x?.used} onChange={(e) => setF({ ...f, kind: e.target.value, gl_role: e.target.value === 'E' ? 'PAY_BENEFIT' : 'PAY_DEDUCTION_PAYABLE', tax_bucket: e.target.value === 'E' ? 'S' : 'N', sso_base: false, pvd_base: false, calc: 'AMOUNT' })}>
          <option value="E">เงินได้</option><option value="D">เงินหัก</option></select></Field>
        {isE && <>
          <Field label="ภาษีเงินได้" hint="ประจำ = คิดเฉลี่ยทั้งปี (เงินเดือน ค่าตำแหน่ง) · ไม่ประจำ = คิดเต็มเดือนที่จ่าย (โบนัส OT)"><select value={s('tax_bucket')} disabled={sys && x?.system_code !== 'OT'} onChange={(e) => setF({ ...f, tax_bucket: e.target.value })}>
            {Object.entries(PAY_BUCKET_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <label className="check"><input type="checkbox" checked={!!f.sso_base} onChange={(e) => setF({ ...f, sso_base: e.target.checked })} /> นับเป็นค่าจ้างคิดประกันสังคม (ค่าตอบแทนการทำงานที่จ่ายประจำ)</label>
          <label className="check"><input type="checkbox" checked={!!f.pvd_base} onChange={(e) => setF({ ...f, pvd_base: e.target.checked })} /> นับเป็นค่าจ้างคิดกองทุนสำรองเลี้ยงชีพ</label>
          {!sys && <Field label="วิธีคิด"><select value={s('calc')} onChange={(e) => setF({ ...f, calc: e.target.value })}>{(['AMOUNT', 'HOURS', 'DAYS', 'MINUTES'] as const).map((k) => <option key={k} value={k}>{PAY_CALC_TH[k]}</option>)}</select></Field>}
          {f.calc === 'HOURS' && <>
            <Field label="ตัวคูณ (รายเดือน)" hint="เช่น OT 1.5 เท่า"><MoneyInput value={s('multiplier')} onChange={(v) => setF({ ...f, multiplier: v })} /></Field>
            <Field label="ตัวคูณ (รายวัน/ชั่วโมง)" hint="เช่น ทำงานวันหยุด 2 เท่า"><MoneyInput value={s('multiplier_daily')} onChange={(v) => setF({ ...f, multiplier_daily: v })} /></Field>
          </>}
          {!sys && f.calc !== 'AMOUNT' && <Field label="ทิศทาง"><select value={s('sign')} onChange={(e) => setF({ ...f, sign: e.target.value })}><option value="1">เพิ่มค่าจ้าง</option><option value="-1">ลดค่าจ้าง (เช่น หักขาดงาน)</option></select></Field>}
        </>}
        <Field label="ลงบัญชี (ตามการเชื่อมต่อบัญชี)" hint="บัญชีของบทบาทนี้กำหนดที่ เริ่มระบบ › การเชื่อมต่อบัญชี หมวดเงินเดือน"><select value={s('gl_role')} disabled={x?.system_code === 'TAX' || x?.system_code === 'SSO' || x?.system_code === 'PVD'} onChange={(e) => setF({ ...f, gl_role: e.target.value })}>
          {(roles.some((r) => r.role === f.gl_role) ? roles : [...PAY_ROLES.filter((r) => r.role === f.gl_role), ...roles]).map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select></Field>
        <Field label="หรือบัญชีเฉพาะรายการนี้" hint="ว่าง = ตามบทบาทด้านบน"><AccountCell value={(f.account_id as string | null) ?? null} onChange={(a) => setF((v) => ({ ...v, account_id: a?.id ?? null }))} /></Field>
      </div>
    </Modal>
  );
}

interface Law { year: number; rules: PayrollTaxRules; law_year: number | null; tax_override: boolean; tax_note: string | null; sso: Array<SsoRate & { source: 'LAW' | 'COMPANY'; note?: string }>; sso_now: SsoRate | null }
/** อัตราภาษีและประกันสังคม: ค่าตามกฎหมายในโปรแกรม · บริษัทกำหนดแทนได้เมื่อกฎหมายเปลี่ยนก่อนอัปเดตโปรแกรม */
export function PayLawPage() {
  const qc = useQueryClient();
  const can = useCan('PAY.LAW');
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ['pay-law', year], queryFn: () => api.get<Law>('/api/v1/pay/law', { year }) });
  const [edit, setEdit] = useState<PayrollTaxRules | null>(null);
  const [sso, setSso] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const L = q.data;
  const reload = () => qc.invalidateQueries({ queryKey: ['pay-law'] });
  const saveTax = async () => { if (!edit) return; setErr(null); try { await api.put(`/api/v1/pay/law/tax/${year}`, { rules: edit }); toast('บันทึกอัตราภาษีของบริษัทแล้ว — คำนวณรอบเงินเดือนใหม่เพื่อใช้ค่านี้'); setEdit(null); reload(); } catch (e) { setErr(e); } };
  const saveSso = async () => { if (!sso) return; setErr(null); try { await api.put('/api/v1/pay/law/sso', { ...sso, note: sso.note || null }); toast('บันทึกอัตราประกันสังคมแล้ว'); setSso(null); reload(); } catch (e) { setErr(e); } };
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เงินเดือน" title="อัตราภาษีและประกันสังคม" lead="ค่าตามกฎหมายที่โปรแกรมใช้คำนวณ — โปรแกรมอัปเดตให้เมื่อกฎหมายเปลี่ยน · ถ้าต้องใช้ก่อน (เช่น รัฐลดเงินสมทบชั่วคราว) กำหนดค่าของบริษัทแทนได้" />
      <div className="toolbar">
        <label>ปีภาษี <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-1, 0, 1].map((k) => { const y = new Date().getFullYear() + k; return <option key={y} value={y}>{y + 543}</option>; })}</select></label>
        <button disabled={!can('edit') || !L} onClick={() => L && setEdit(JSON.parse(JSON.stringify(L.rules)))}>แก้อัตราภาษีของบริษัท</button>
        {L?.tax_override && <button disabled={!can('delete')} onClick={() => window.confirm('กลับไปใช้อัตราตามกฎหมายในโปรแกรม?') && api.del(`/api/v1/pay/law/tax/${year}`).then(reload)}>กลับไปใช้ค่าตามกฎหมาย</button>}
      </div>
      <ErrorBox error={q.error ?? err} />
      {L && <div className="fa-grid">
        <fieldset className="box"><legend>ภาษีเงินได้ปี {year + 543} {L.tax_override ? <Pill tone="c">บริษัทกำหนดเอง</Pill> : L.law_year !== year ? <Pill tone="d">ยังไม่มีอัตราปีนี้ — ใช้ปี {(L.law_year ?? 0) + 543}</Pill> : <Pill tone="n">ตามกฎหมาย</Pill>}</legend>
          <p className="small">หักค่าใช้จ่าย {L.rules.expense_rate}% ไม่เกิน {fmt(L.rules.expense_cap, { places: 0 })} · ลดหย่อนส่วนตัว {fmt(L.rules.personal, { places: 0 })} · ประกันสังคมหักได้ไม่เกิน {fmt(L.rules.sso_yearly_cap, { places: 0 })} ต่อปี</p>
          <table className="grid compact"><thead><tr><th className="r">เงินได้สุทธิตั้งแต่</th><th className="r">ถึง</th><th className="r">อัตรา %</th></tr></thead>
            <tbody>{L.rules.brackets.map((b) => <tr key={b.from}><td className="r">{fmt(b.from, { places: 0 })}</td><td className="r">{b.to ? fmt(b.to, { places: 0 }) : 'ขึ้นไป'}</td><td className="r">{b.rate}</td></tr>)}</tbody></table>
        </fieldset>
        <fieldset className="box"><legend>ประกันสังคม มาตรา 33</legend>
          <table className="grid compact"><thead><tr><th>มีผลตั้งแต่</th><th className="r">ลูกจ้าง/นายจ้าง %</th><th className="r">ค่าจ้างที่คิด</th><th className="r">เงินสมทบต่อเดือน</th><th /></tr></thead>
            <tbody>{L.sso.map((r) => <tr key={r.effective_from + r.source} className={cx(L.sso_now?.effective_from === r.effective_from && 'sel')}><td><DateText v={r.effective_from} /></td><td className="r">{r.employee_rate}/{r.employer_rate}</td>
              <td className="r">{fmt(r.wage_min, { places: 0 })}–{fmt(r.wage_max, { places: 0 })}</td><td className="r">{fmt(r.monthly_min, { places: 0 })}–{fmt(r.monthly_max, { places: 0 })}</td>
              <td>{r.source === 'COMPANY' ? <>{can('delete') && <button className="link" onClick={() => window.confirm('ลบอัตราของบริษัทนี้?') && api.del(`/api/v1/pay/law/sso/${r.effective_from}`).then(reload)}>ลบ</button>} <Pill tone="c">บริษัท</Pill></> : <span className="muted small">กฎหมาย</span>}</td></tr>)}</tbody></table>
          <button disabled={!can('edit')} onClick={() => setSso({ effective_from: '', employee_rate: '5', employer_rate: '5', wage_min: '1650', wage_max: '17500', monthly_min: '83', monthly_max: '875', note: '' })}>+ อัตราของบริษัท (เช่น รัฐลดเงินสมทบ)</button>
        </fieldset>
      </div>}
      {edit && <Modal size="wide" title={`อัตราภาษีของบริษัท ปี ${year + 543}`} onClose={() => setEdit(null)} footer={<><button onClick={() => setEdit(null)}>ยกเลิก</button><button className="primary" onClick={saveTax}>บันทึก</button></>}>
        <ErrorBox error={err} />
        <div className="form-grid" onKeyDown={(e) => navKey(e)}>
          <Field label="หักค่าใช้จ่าย %"><MoneyInput value={edit.expense_rate} onChange={(v) => setEdit({ ...edit, expense_rate: v })} /></Field>
          <Field label="เพดานค่าใช้จ่าย"><MoneyInput value={edit.expense_cap} onChange={(v) => setEdit({ ...edit, expense_cap: v })} /></Field>
          <Field label="ลดหย่อนส่วนตัว"><MoneyInput value={edit.personal} onChange={(v) => setEdit({ ...edit, personal: v })} /></Field>
          <Field label="ประกันสังคมหักได้ต่อปี"><MoneyInput value={edit.sso_yearly_cap} onChange={(v) => setEdit({ ...edit, sso_yearly_cap: v })} /></Field>
        </div>
        <table className="grid compact"><thead><tr><th>ตั้งแต่</th><th>ถึง (ว่าง = ขึ้นไป)</th><th>อัตรา %</th></tr></thead>
          <tbody>{edit.brackets.map((b, i) => <tr key={i}><td><MoneyInput value={b.from} onChange={(v) => setEdit({ ...edit, brackets: edit.brackets.map((x, k) => (k === i ? { ...x, from: v } : x)) })} /></td>
            <td><MoneyInput value={b.to ?? ''} onChange={(v) => setEdit({ ...edit, brackets: edit.brackets.map((x, k) => (k === i ? { ...x, to: v || null } : x)) })} /></td>
            <td><MoneyInput value={b.rate} onChange={(v) => setEdit({ ...edit, brackets: edit.brackets.map((x, k) => (k === i ? { ...x, rate: v } : x)) })} /></td></tr>)}</tbody></table>
        <p className="hint">รายการค่าลดหย่อนและเพดานแต่ละรายการใช้ตามกฎหมายในโปรแกรม</p>
      </Modal>}
      {sso && <Modal title="อัตราประกันสังคมของบริษัท" size="confirm" onClose={() => setSso(null)} footer={<><button onClick={() => setSso(null)}>ยกเลิก</button><button className="primary" onClick={saveSso}>บันทึก</button></>}>
        <ErrorBox error={err} />
        <div className="form-grid" onKeyDown={(e) => navKey(e)}>
          <Field label="มีผลตั้งแต่" req hint="วันที่ 1 ของเดือน · ถึงวันที่ของอัตราถัดไป"><input type="date" value={sso.effective_from} onChange={(e) => setSso({ ...sso, effective_from: e.target.value })} /></Field>
          {([['employee_rate', 'ลูกจ้าง %'], ['employer_rate', 'นายจ้าง %'], ['wage_min', 'ค่าจ้างต่ำสุด'], ['wage_max', 'ค่าจ้างสูงสุด'], ['monthly_min', 'เงินสมทบต่ำสุด'], ['monthly_max', 'เงินสมทบสูงสุด']] as const).map(([k, l]) =>
            <Field key={k} label={l} req><MoneyInput value={sso[k]} onChange={(v) => setSso({ ...sso, [k]: v })} /></Field>)}
          <Field label="อ้างอิงประกาศ"><input value={sso.note} maxLength={200} onChange={(e) => setSso({ ...sso, note: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}

/** ทดลองคำนวณภาษี (ไม่บันทึก) — สูตรเดียวกับรอบเงินเดือน */
export function TaxCalculatorPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const q = useQuery({ queryKey: ['pay-law', year], queryFn: () => api.get<Law>('/api/v1/pay/law', { year }) });
  const [f, setF] = useState({ salary: '30000', bonus: '0', month: '1', start: '1', bearer: 'W' as TaxBearer, sso: true, pvd: '0' });
  const [allow, setAllow] = useState<Record<string, string | boolean>>({});
  const L = q.data;
  const [out, setOut] = useState<ReturnType<typeof monthTax> | null>(null);
  useEffect(() => {
    if (!L) return;
    const m = Number(f.month) || 1, start = Math.min(Number(f.start) || 1, m);
    const ssoM = f.sso && L.sso_now ? ssoContribution(f.salary, L.sso_now).employee : d(0);
    const pvdM = d(f.salary).times(d(f.pvd || 0)).div(100).toDecimalPlaces(2);
    const prior = Array.from({ length: m - start }, () => ({ regular: f.salary, special: '0', tax: '0', special_tax: '0', sso: ssoM.toFixed(2), pvd: pvdM.toFixed(2) }));
    // เดือนก่อนหน้าคิดภาษีตามสูตรเดียวกันไล่ทีละเดือน
    for (let k = 0; k < prior.length; k++) {
      const r = monthTax({ rules: L.rules, allowances: allow, bearer: f.bearer, start_month: start, end_month: 12, month: start + k, prior: prior.slice(0, k), regular: f.salary, special: 0, sso: ssoM, pvd: pvdM });
      prior[k]!.tax = r.tax.toFixed(2); prior[k]!.special_tax = r.special_tax.toFixed(2);
    }
    setOut(monthTax({ rules: L.rules, allowances: allow, bearer: f.bearer, start_month: start, end_month: 12, month: m, prior, regular: f.salary, special: f.bonus, sso: ssoM, pvd: pvdM }));
  }, [L, f, allow]);
  const net = out ? allowanceBreakdown(L!.rules, allow, out.annual_income, out.sso_annual, out.pvd_annual) : null;
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="เงินเดือน" title="ทดลองคำนวณภาษี" lead="ลองตัวเลขเงินเดือน โบนัส และค่าลดหย่อน — ไม่บันทึกอะไร · สูตรเดียวกับรอบเงินเดือน (คิดทั้งปีแล้วเฉลี่ย ตาม ป.96/2543)" />
      <div className="fa-grid">
        <fieldset className="box"><legend>ข้อมูล</legend>
          <div className="form-grid" onKeyDown={(e) => navKey(e)}>
            <Field label="ปีภาษี"><select value={year} onChange={(e) => setYear(Number(e.target.value))}>{[-1, 0, 1].map((k) => { const y = new Date().getFullYear() + k; return <option key={y} value={y}>{y + 543}</option>; })}</select></Field>
            <Field label="เงินเดือน (ต่อเดือน)"><MoneyInput autoFocus value={f.salary} onChange={(v) => setF({ ...f, salary: v })} /></Field>
            <Field label="โบนัส/เงินได้ไม่ประจำเดือนนี้"><MoneyInput value={f.bonus} onChange={(v) => setF({ ...f, bonus: v })} /></Field>
            <Field label="เดือนที่คำนวณ"><select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></Field>
            <Field label="เริ่มงานเดือนที่ (ปีนี้)"><select value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></Field>
            <Field label="ผู้รับภาระภาษี"><select value={f.bearer} onChange={(e) => setF({ ...f, bearer: e.target.value as TaxBearer })}>{Object.entries(TAX_BEARER_TH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <label className="check"><input type="checkbox" checked={f.sso} onChange={(e) => setF({ ...f, sso: e.target.checked })} /> หักประกันสังคม</label>
            <Field label="กองทุนสำรองเลี้ยงชีพ (% ของเงินเดือน)"><MoneyInput value={f.pvd} onChange={(v) => setF({ ...f, pvd: v })} /></Field>
          </div>
          <table className="grid compact"><tbody>{L?.rules.allowances.filter((a) => a.code !== 'pvd').map((a) => <tr key={a.code}><td className="small">{a.name_th}</td>
            <td>{a.input === 'check' ? <input type="checkbox" checked={!!allow[a.code]} onChange={(e) => setAllow({ ...allow, [a.code]: e.target.checked })} aria-label={a.name_th} />
              : <MoneyInput value={String(allow[a.code] ?? '')} onChange={(v) => setAllow({ ...allow, [a.code]: v })} aria-label={a.name_th} />}</td></tr>)}</tbody></table>
        </fieldset>
        {out && net && <fieldset className="box"><legend>ผล</legend>
          <table className="grid compact"><tbody>
            <tr><td>เงินได้ทั้งปี (ประมาณ)</td><td className="r"><Money v={out.annual_income.toFixed(2)} /></td></tr>
            {net.lines.map((l) => <tr key={l.code} className="muted"><td>หัก {l.name_th}</td><td className="r">(<Money v={l.amount.toFixed(2)} />)</td></tr>)}
            <tr><td>เงินได้สุทธิ</td><td className="r"><Money v={out.annual_net_income.toFixed(2)} /></td></tr>
            <tr><td>ภาษีทั้งปี (ประมาณ)</td><td className="r"><Money v={out.annual_tax_estimate.toFixed(2)} /></td></tr>
            <tr><td><b>ภาษีหัก ณ ที่จ่ายเดือนนี้</b></td><td className="r"><b><Money v={out.tax.toFixed(2)} /></b></td></tr>
            <tr className="muted"><td>ส่วนเงินได้ประจำ / ไม่ประจำ</td><td className="r"><Money v={out.regular_tax.toFixed(2)} /> / <Money v={out.special_tax.toFixed(2)} /></td></tr>
          </tbody></table>
          <table className="grid compact"><thead><tr><th>ขั้นเงินได้สุทธิ</th><th className="r">อัตรา</th><th className="r">ภาษี</th></tr></thead>
            <tbody>{bracketTax(out.annual_net_income, L!.rules.brackets).rows.filter((r) => r.taxable.gt(0)).map((r) => <tr key={r.from}><td>{fmt(r.from, { places: 0 })}–{r.to ? fmt(r.to, { places: 0 }) : 'ขึ้นไป'}</td><td className="r">{r.rate}%</td><td className="r"><Money v={r.tax.toFixed(2)} /></td></tr>)}</tbody></table>
        </fieldset>}
      </div>
      <KeyHints keys={[['Enter', 'ช่องถัดไป']]} />
    </div>
  );
}
