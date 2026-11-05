import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { checkTaxId } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { ErrorBox, Field, navKey, PageHead, Tabs, toast, useHotkeys } from '../../ui';
import { ThemePicker } from '../../components/ThemePicker';
import { AddressFields } from '../../components/AddressFields';
import { ModuleSwitches } from '../../components/ModuleSwitches';
import { WtsPosSetup } from '../../components/WtsConnect';

type Co = {
  name_th: string; name_en: string | null; address_th_1: string; address_th_2: string; address_en_1: string; address_en_2: string; phone: string | null; business_type: 'J' | 'P';
  tax_id: string | null; tax_branch_no: string; branch_short_name: string; allow_blank_party_tax_id: boolean; trade_reg_no: string | null; social_security_no: string | null;
  year_system: 'B' | 'C'; vat_rate: number; account_mask: string; voucher_numbering: '4' | 'M'; use_department: boolean; code: string;
  zip_code: string | null; [k: string]: unknown;
};

/** รายละเอียดกิจการ — คู่มือบทที่ 5 S-SET-01 (เริ่มระบบ 1.1) */
export function CompanyPage() {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const q = useQuery({ queryKey: ['company'], queryFn: () => api.get<Co>('/api/v1/company') });
  const [f, setF] = useState<Co | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState('info');
  useEffect(() => { if (q.data) setF({ ...q.data, tax_branch_no: String(Number(q.data.tax_branch_no)) }); }, [q.data]);
  const save = async () => {
    if (!f) return;
    setErr(null);
    try {
      const r = await api.put<{ warning?: string }>('/api/v1/company', { ...f, vat_rate: Number(f.vat_rate) });
      toast(r.warning ? `บันทึกแล้ว — ${r.warning}` : 'บันทึกรายละเอียดกิจการแล้ว', r.warning ? 'warn' : 'ok');
      setEdit(false); qc.invalidateQueries({ queryKey: ['company'] }); refresh();
    } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save, 'Alt+E': () => setEdit(true) }, [f]);
  if (!f) return <div className="page"><ErrorBox error={q.error} /></div>;
  const tax = f.tax_id ? checkTaxId(f.tax_id) : null;
  const set = <K extends keyof Co>(k: K, v: Co[K]) => setF({ ...f, [k]: v });
  const nextTab = () => { const order = ['info', 'tax', 'gen']; const i = order.indexOf(tab); if (i < 0 || i >= order.length - 1) return; setTab(order[i + 1]!); setTimeout(() => document.querySelector<HTMLElement>('.tab-flow input:not([disabled]), .tab-flow select:not([disabled])')?.focus(), 30); };
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › รายละเอียดกิจการ" title="รายละเอียดกิจการ" lead={`รหัสบริษัท ${f.code} — ชื่อและที่อยู่ใช้พิมพ์บนหัวรายงานและแบบฟอร์ม`}
        actions={edit ? <><button onClick={() => { setEdit(false); setF(q.data ? { ...q.data, tax_branch_no: String(Number(q.data.tax_branch_no)) } : null); }}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></> : <button className="primary" onClick={() => setEdit(true)}>แก้ไข <kbd>Alt+E</kbd></button>} />
      <ErrorBox error={err} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'info', label: 'ข้อมูลกิจการ' }, { key: 'tax', label: 'ภาษีและทะเบียน' }, { key: 'gen', label: 'เรื่องทั่วไป' }, { key: 'modules', label: 'ระบบที่ใช้งาน' }, { key: 'pos', label: 'เชื่อมต่อ WTS POS' }, { key: 'theme', label: 'ธีมและแบบอักษร' }]} />
      {['info', 'tax', 'gen'].includes(tab) && <fieldset disabled={!edit} onKeyDown={(e) => navKey(e, nextTab)}>
        {tab === 'info' && <div className="card form-grid three tab-flow">
          <Field label="1. ชื่อบริษัท" req wide><input value={f.name_th} onChange={(e) => set('name_th', e.target.value)} /></Field>
          <Field label="2. ชื่อภาษาอังกฤษ" wide><input value={f.name_en ?? ''} onChange={(e) => set('name_en', e.target.value)} /></Field>
          <AddressFields value={f} onChange={(p) => setF((x) => ({ ...x!, ...p }))} target={{ kind: 'company' }} title="ที่อยู่กิจการ" disabled={!edit} />
          <Field label="3. หมายเลขโทรศัพท์"><input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>}
        {tab === 'tax' && <div className="card form-grid three tab-flow">
          <Field label="4. ประเภทของกิจการ" req><select value={f.business_type} onChange={(e) => set('business_type', e.target.value as 'J' | 'P')}><option value="J">นิติบุคคล</option><option value="P">บุคคลธรรมดา</option></select></Field>
          <Field label="5. เลขประจำตัวผู้เสียภาษี" req error={tax && !tax.ok ? tax.error : undefined} hint={tax?.ok && tax.kind === 'LEGACY10' ? tax.warning : undefined}><input className="mono" value={f.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} maxLength={17} /></Field>
          <Field label="5.1 สาขา#" req hint="สำนักงานใหญ่ = 0"><input className="num" value={f.tax_branch_no} onChange={(e) => set('tax_branch_no', e.target.value.replace(/\D/g, ''))} maxLength={5} /></Field>
          <Field label="5.2 ชื่อย่อสาขา"><input value={f.branch_short_name} onChange={(e) => set('branch_short_name', e.target.value)} /></Field>
          <label className="inline chk wide"><input type="checkbox" checked={f.allow_blank_party_tax_id} onChange={(e) => set('allow_blank_party_tax_id', e.target.checked)} /> 5.3 ยอมให้เลขประจำตัวผู้เสียภาษีในทะเบียนผู้จำหน่าย/ลูกค้าว่างได้</label>
          <Field label="6. เลขทะเบียนการค้า / นิติบุคคล"><input value={f.trade_reg_no ?? ''} onChange={(e) => set('trade_reg_no', e.target.value)} /></Field>
          <Field label="เลขที่บัญชีนายจ้าง (ประกันสังคม)"><input value={f.social_security_no ?? ''} onChange={(e) => set('social_security_no', e.target.value)} /></Field>
        </div>}
        {tab === 'gen' && <div className="card form-grid three tab-flow">
          <Field label="ระบบปี"><select value={f.year_system} onChange={(e) => set('year_system', e.target.value as 'B' | 'C')}><option value="B">พ.ศ.</option><option value="C">ค.ศ.</option></select></Field>
          <Field label="อัตราภาษีมูลค่าเพิ่ม (%)"><input className="num" type="number" step="0.01" value={f.vat_rate} onChange={(e) => set('vat_rate', Number(e.target.value))} /></Field>
          <Field label="รูปแบบเลขที่บัญชี" hint="9 = ตัวเลข เช่น 9999-99"><input className="mono" value={f.account_mask} onChange={(e) => set('account_mask', e.target.value)} /></Field>
          <Field label="รูปแบบเลขที่ใบสำคัญ"><select value={f.voucher_numbering} onChange={(e) => set('voucher_numbering', e.target.value as '4' | 'M')}><option value="4">ตัวนำ+ปีเดือนวัน+ลำดับ (JV520101001)</option><option value="M">ตัวนำ+ปีเดือน+ลำดับ (JV52010001)</option></select></Field>
          <label className="inline chk"><input type="checkbox" checked={f.use_department} onChange={(e) => set('use_department', e.target.checked)} /> ใช้แผนก</label>
        </div>}
      </fieldset>}
      {tab === 'modules' && <ModuleSwitches />}
      {tab === 'pos' && <WtsPosSetup />}
      {tab === 'theme' && <ThemePicker />}
      <p className="hint">ค่าเริ่มต้นของระบบซื้อ ขาย สินค้า การเงิน และทรัพย์สิน (คู่มือบทที่ 5 ข้อ 1.2–1.12) อยู่ในแผนเฟส P2</p>
    </div>
  );
}
