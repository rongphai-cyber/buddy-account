import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useSession } from '../../session';
import { DateInput, ErrorBox, Field, navKey, PageHead, toast } from '../../ui';

/** กำหนดบริษัทใหม่ — คู่มือบทที่ 4 S-CO-03 / เลือกแหล่งข้อมูล S-CO-04 */
export function NewCompanyPage() {
  const { me, select } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ code: '', name_th: '', tax_id: '', fiscal_start: `${new Date().getFullYear()}-01-01`, chart: 'express', copy_from_company_id: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.post<{ id: string }>('/api/v1/companies', { ...f, tax_id: f.tax_id || undefined, copy_from_company_id: f.copy_from_company_id || undefined });
      await select({ company_id: r.id });
      toast('สร้างบริษัทใหม่แล้ว');
      nav('/settings/company');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="page narrow" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › กำหนดบริษัทใหม่" title="กำหนดบริษัทใหม่" lead="ระบบจะสร้างสำนักงานใหญ่ รอบบัญชี 12 งวด สมุดรายวัน 00–04 และกฎการลงบัญชีอัตโนมัติให้" />
      <ErrorBox error={err} />
      <div className="card form-grid" onKeyDown={navKey}>
        <Field label="รหัสบริษัท" req hint="ตัวอักษรอังกฤษ/ตัวเลข ห้ามซ้ำ (เดิม Express ใช้ชื่อโฟลเดอร์ข้อมูล)"><input autoFocus value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="เลขประจำตัวผู้เสียภาษี"><input value={f.tax_id} onChange={(e) => setF({ ...f, tax_id: e.target.value })} /></Field>
        <Field label="ชื่อบริษัท" req wide><input value={f.name_th} onChange={(e) => setF({ ...f, name_th: e.target.value })} /></Field>
        <Field label="วันที่เริ่มรอบบัญชี" req><DateInput value={f.fiscal_start} onChange={(v) => setF({ ...f, fiscal_start: v })} /></Field>
        <Field label="ผังบัญชีเริ่มต้น" req>
          <select value={f.chart} onChange={(e) => setF({ ...f, chart: e.target.value })}>
            <option value="express">ผังบัญชีมาตรฐาน (แบบ Express 292 บัญชี)</option>
            <option value="th_en">ผังบัญชีตัวอย่าง ไทย–อังกฤษ (287 บัญชี)</option>
            <option value="copy">คัดลอกจากบริษัทที่มีอยู่</option>
            <option value="none">ไม่มี (สร้างเอง)</option>
          </select>
        </Field>
        {f.chart === 'copy' && <Field label="บริษัทต้นแบบ" req wide><select value={f.copy_from_company_id} onChange={(e) => setF({ ...f, copy_from_company_id: e.target.value })}><option value="">— เลือก —</option>{me?.companies.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name_th}</option>)}</select></Field>}
      </div>
      <div className="actions"><button className="primary" disabled={busy} onClick={go}>{busy ? 'กำลังสร้าง…' : 'สร้างบริษัท'}</button><button onClick={() => nav(-1)}>ยกเลิก</button></div>
    </div>
  );
}
