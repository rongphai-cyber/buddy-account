import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt, thisMonthTh } from '@buddy/core';
import { api } from '../../api';
import { useSession } from '../../session';
import { cx, downloadCsv, ErrorBox, Field, Modal, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';
import { gbText, usePackages, type Pkg } from '../../components/PackageFields';
import { LEVEL, mbText, MonthSelect, UsageView, type UsageReport } from './Usage';

/**
 * แพ็กเกจและการใช้งานลูกค้า (ผู้ให้บริการ · HANDOFF 185): แค็ตตาล็อกแพ็กเกจ · การใช้งานทุกลูกค้า · ค่าใช้ส่วนเกินรายเดือน
 * ราคาต่อปี ไม่รวม VAT · เงินเป็นข้อความทศนิยม (Decimal) · ลูกค้าไม่เห็นหน้านี้
 */
type Tab = 'pkg' | 'usage' | 'over';
export function PackagesPage() {
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('buddy.pkgTab') as Tab) || 'pkg'; } catch { return 'pkg'; } });
  const pick = (k: string) => { setTab(k as Tab); try { localStorage.setItem('buddy.pkgTab', k); } catch { /* ignore */ } };
  if (!me?.user.is_platform) return <div className="page"><div className="notebox">เฉพาะเจ้าหน้าที่ผู้ให้บริการโปรแกรม</div></div>;
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ผู้ให้บริการ" title="แพ็กเกจและการใช้งานลูกค้า" lead="แพ็กเกจต่อปี (ไม่รวม VAT) จำกัดบริษัท ผู้ใช้ เอกสาร/เดือน พื้นที่ไฟล์ และอ่านบิลด้วย AI/เดือน · การใช้งานคำนวณสดจากข้อมูล · เอกสารไม่หยุดเด็ดขาด เกินแล้วคิดส่วนเกิน" />
      <Tabs tabs={[{ key: 'pkg', label: 'แพ็กเกจ' }, { key: 'usage', label: 'การใช้งานลูกค้า' }, { key: 'over', label: 'ค่าใช้ส่วนเกินรายเดือน' }]} active={tab} onChange={pick} />
      {tab === 'pkg' && <Catalog />}
      {tab === 'usage' && <TenantUsage />}
      {tab === 'over' && <Overage />}
    </div>
  );
}

/* ---------------------------------------------------------------- แค็ตตาล็อก */
function Catalog() {
  const pk = usePackages();
  const [edit, setEdit] = useState<Pkg | 'new' | null>(null);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  const lim = (n: number | null) => (n === null ? 'ไม่จำกัด' : n.toLocaleString());
  return (
    <div className="tab-body">
      <div className="toolbar"><button className="primary" onClick={() => setEdit('new')}>+ เพิ่มแพ็กเกจ <kbd>Ins</kbd></button></div>
      <ErrorBox error={pk.error} />
      <div className="table-wrap"><table className="grid">
        <thead><tr><th>รหัส</th><th>ชื่อแพ็กเกจ</th><th className="r">ราคา/ปี</th><th className="r">บริษัท</th><th className="r">ผู้ใช้</th><th className="r">เอกสาร/เดือน</th><th className="r">ไฟล์</th><th className="r">AI/เดือน</th><th>อัตราส่วนเกิน</th><th className="r">ลูกค้า</th><th>สถานะ</th></tr></thead>
        <tbody>
          {pk.data?.map((p) => (
            <tr key={p.id} className="row-open" onClick={() => setEdit(p)}>
              <td className="mono">{p.code}</td><td><b>{p.name_th}</b></td><td className="r num">{fmt(p.price_year)}</td><td className="r num">{lim(p.max_companies)}</td><td className="r num">{lim(p.max_users)}</td>
              <td className="r num">{lim(p.docs_per_month)}</td><td className="r num">{gbText(p.file_quota_mb)}</td><td className="r num">{lim(p.ai_per_month)}</td>
              <td className="small">บริษัท {fmt(p.over_company_year)}/ปี · ผู้ใช้ {fmt(p.over_user_year)}/ปี · เอกสาร {fmt(p.over_doc)}/ใบ · ไฟล์ {fmt(p.over_file_gb_month)}/GB/เดือน · AI {fmt(p.over_ai)}/บิล</td>
              <td className="r num">{p.tenants ?? 0}</td><td>{p.status === 'A' ? <Pill tone="n">ขายอยู่</Pill> : <Pill tone="x">เลิกขาย</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="small muted">ราคาไม่รวม VAT · ไฟล์ 1 GB = 1,024 MB · แก้แพ็กเกจแล้วมีผลกับลูกค้าที่ใช้แพ็กเกจนี้ทันที (ยกเว้นค่าที่ตั้งเฉพาะลูกค้า) · เลิกขาย = ลูกค้าเดิมใช้ต่อได้ เลือกให้ลูกค้าใหม่ไม่ได้</p>
      {edit && <PackageForm p={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PackageForm({ p, onClose }: { p: Pkg | null; onClose: () => void }) {
  const qc = useQueryClient();
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({ code: s(p?.code), name_th: s(p?.name_th), price_year: s(p?.price_year ?? '0'), max_companies: s(p?.max_companies), max_users: s(p?.max_users), docs_per_month: s(p?.docs_per_month),
    file_quota_mb: s(p?.file_quota_mb), ai_per_month: s(p?.ai_per_month), over_company_year: s(p?.over_company_year ?? '900'), over_user_year: s(p?.over_user_year ?? '600'), over_doc: s(p?.over_doc ?? '0.50'),
    over_file_gb_month: s(p?.over_file_gb_month ?? '20'), over_ai: s(p?.over_ai ?? '2.00'), status: p?.status ?? 'A', sort_order: s(p?.sort_order ?? 0), remark: s(p?.remark) });
  const [err, setErr] = useState<unknown>(null);
  const save = () => { setErr(null); (p ? api.put(`/api/v1/packages/${p.id}`, f) : api.post('/api/v1/packages', f)).then(() => { toast('บันทึกแพ็กเกจแล้ว'); qc.invalidateQueries({ queryKey: ['packages'] }); onClose(); }).catch(setErr); };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  const num = (k: keyof typeof f, int = true) => ({ className: 'num', inputMode: (int ? 'numeric' : 'decimal') as 'numeric' | 'decimal', value: f[k] as string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: int ? e.target.value.replace(/\D/g, '') : e.target.value.replace(/[^\d.,]/g, '') }) });
  return (
    <Modal title={p ? `แก้ไขแพ็กเกจ ${p.code}` : 'เพิ่มแพ็กเกจ'} onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="รหัสแพ็กเกจ" req><input className="mono" autoFocus maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="ชื่อแพ็กเกจ" req><input maxLength={120} value={f.name_th} onChange={(e) => setF({ ...f, name_th: e.target.value })} /></Field>
        <Field label="ราคาต่อปี (บาท ไม่รวม VAT)" req><input {...num('price_year', false)} /></Field>
        <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'A' | 'I' })}><option value="A">ขายอยู่</option><option value="I">เลิกขาย (ลูกค้าเดิมใช้ต่อ)</option></select></Field>
        <fieldset className="wide box"><legend>ขีดจำกัด (ว่าง = ไม่จำกัด)</legend><div className="form-grid">
          <Field label="บริษัท"><input {...num('max_companies')} /></Field>
          <Field label="ผู้ใช้"><input {...num('max_users')} /></Field>
          <Field label="เอกสารต่อเดือน" hint="เกินแล้วไม่หยุด — คิดส่วนเกิน"><input {...num('docs_per_month')} /></Field>
          <Field label="พื้นที่ไฟล์ (MB)" hint="2 GB = 2048 · 5 GB = 5120"><input {...num('file_quota_mb')} /></Field>
          <Field label="อ่านบิลด้วย AI ต่อเดือน"><input {...num('ai_per_month')} /></Field>
        </div></fieldset>
        <fieldset className="wide box"><legend>อัตราส่วนเกิน (บาท ไม่รวม VAT)</legend><div className="form-grid">
          <Field label="บริษัทเพิ่ม ต่อปี"><input {...num('over_company_year', false)} /></Field>
          <Field label="ผู้ใช้เพิ่ม ต่อปี"><input {...num('over_user_year', false)} /></Field>
          <Field label="ต่อเอกสารที่เกิน"><input {...num('over_doc', false)} /></Field>
          <Field label="ต่อ GB ต่อเดือน (ไฟล์ที่เกิน)"><input {...num('over_file_gb_month', false)} /></Field>
          <Field label="ต่อบิลที่อ่านด้วย AI เกิน"><input {...num('over_ai', false)} /></Field>
        </div></fieldset>
        <Field label="ลำดับแสดง"><input {...num('sort_order')} /></Field>
        <Field label="หมายเหตุ"><input maxLength={200} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- การใช้งานทุกลูกค้า */
const useAllUsage = (month: string) => useQuery({ queryKey: ['admin-usage', month], queryFn: () => api.get<{ month: string; rows: UsageReport[] }>(`/api/v1/admin/usage?month=${month}`) });
type SortKey = 'code' | 'docs' | 'files' | 'ai' | 'pct' | 'db';
function TenantUsage() {
  const [month, setMonth] = useState(thisMonthTh());
  const [overOnly, setOverOnly] = useState(false);
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: 'pct', desc: true });
  const [open, setOpen] = useState<UsageReport | null>(null);
  const q = useAllUsage(month);
  const maxPct = (r: UsageReport) => Math.max(-1, ...r.rows.map((x) => x.pct ?? -1));
  const db = (r: UsageReport) => r.companies.reduce((s, c) => s + (c.db_bytes ?? 0), 0);
  const rows = useMemo(() => {
    const val = (r: UsageReport): number | string => ({ code: r.tenant.code, docs: r.usage.docs, files: r.usage.file_bytes, ai: r.usage.ai, pct: maxPct(r), db: db(r) })[sort.k];
    return (q.data?.rows ?? []).filter((r) => !overOnly || r.level === 'over').sort((a, b) => { const x = val(a), y = val(b); const c = x < y ? -1 : x > y ? 1 : 0; return sort.desc ? -c : c; });
  }, [q.data, overOnly, sort]);
  const th = (k: SortKey, label: string, r = true) => <th className={cx(r && 'r', 'sortable')} onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : k !== 'code' })} aria-sort={sort.k === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}>{label}{sort.k === k ? (sort.desc ? ' ▼' : ' ▲') : ''}</th>;
  const cell = (r: UsageReport, k: 'companies' | 'users' | 'docs' | 'ai') => { const x = r.rows.find((y) => y.key === k)!; return <td className={cx('r num', `lv-${x.level}`)}>{x.used.toLocaleString()}{x.limit !== null ? ` / ${x.limit.toLocaleString()}` : ''}</td>; };
  return (
    <div className="tab-body">
      <div className="toolbar"><MonthSelect value={month} onChange={setMonth} /><label className="inline chk"><input type="checkbox" checked={overOnly} onChange={(e) => setOverOnly(e.target.checked)} /> เฉพาะที่เกินโควตา</label>
        <button onClick={() => downloadCsv(`usage-${month}.csv`, ['รหัสลูกค้า', 'ชื่อลูกค้า', 'แพ็กเกจ', 'บริษัท', 'ผู้ใช้', 'เอกสาร', 'ไฟล์ MB', 'AI', 'สูงสุด %', 'ขนาดข้อมูลโดยประมาณ MB'],
          rows.map((r) => [r.tenant.code, r.tenant.name, r.package?.code ?? '', r.usage.companies, r.usage.users, r.usage.docs, (r.usage.file_bytes / 1048576).toFixed(1), r.usage.ai, maxPct(r) < 0 ? '' : maxPct(r), (db(r) / 1048576).toFixed(1)]))}>CSV</button></div>
      <ErrorBox error={q.error} />
      <div className="table-wrap"><table className="grid">
        <thead><tr>{th('code', 'ลูกค้า', false)}<th>แพ็กเกจ</th><th className="r">บริษัท</th><th className="r">ผู้ใช้</th>{th('docs', 'เอกสาร/เดือน')}{th('files', 'ไฟล์')}{th('ai', 'AI/เดือน')}{th('pct', 'สูงสุด')}{th('db', 'ขนาดข้อมูล (ประมาณ)')}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const f = r.rows.find((y) => y.key === 'files')!;
            return (
              <tr key={r.tenant.id} className="row-open" onClick={() => setOpen(r)}>
                <td><span className="mono">{r.tenant.code}</span> {r.tenant.name}{r.tenant.status !== 'A' && <> <Pill tone="x">{r.tenant.status === 'S' ? 'ระงับ' : 'เลิกใช้'}</Pill></>}</td>
                <td>{r.package?.name_th ?? <span className="muted">ไม่มี</span>}{r.over_action === 'S' && <span className="small muted"> · หยุด</span>}</td>
                {cell(r, 'companies')}{cell(r, 'users')}{cell(r, 'docs')}
                <td className={cx('r num', `lv-${f.level}`)}>{mbText(r.usage.file_bytes)}{f.limit !== null ? ` / ${gbText(f.limit)}` : ''}</td>
                {cell(r, 'ai')}
                <td className="r"><Pill tone={LEVEL[r.level][1]}>{maxPct(r) >= 0 ? `${maxPct(r)}%` : LEVEL[r.level][0]}</Pill></td>
                <td className="r num muted">{mbText(db(r))}</td>
              </tr>
            );
          })}
          {q.data && !rows.length && <tr><td colSpan={9} className="empty">{overOnly ? 'ไม่มีลูกค้าที่เกินโควตา ✓' : 'ยังไม่มีลูกค้า'}</td></tr>}
        </tbody>
      </table></div>
      <p className="small muted">คลิกแถวดูรายละเอียดแยกบริษัท · ขนาดข้อมูล (ประมาณ) ใช้ดูต้นทุนเท่านั้น ไม่ใช้คิดเงิน · ลูกค้าไม่มีแพ็กเกจ = ไม่จำกัด</p>
      {open && <Modal size="wide" title={`การใช้งาน ${open.tenant.code} ${open.tenant.name}`} onClose={() => setOpen(null)} footer={<button onClick={() => setOpen(null)}>ปิด</button>}><UsageView r={open} provider /></Modal>}
    </div>
  );
}

/* ---------------------------------------------------------------- ค่าใช้ส่วนเกินรายเดือน */
function Overage() {
  const [month, setMonth] = useState(thisMonthTh());
  const q = useAllUsage(month);
  const rows = (q.data?.rows ?? []).filter((r) => r.overage && r.overage.lines.length);
  const total = rows.reduce((s, r) => s.plus(r.overage!.total), d(0)).toFixed(2);
  const csv = () => downloadCsv(`overage-${month}.csv`, ['เดือน', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'แพ็กเกจ', 'รายการ', 'เกิน', 'หน่วย', 'อัตรา', 'หมายเหตุ', 'จำนวนเงิน (ไม่รวม VAT)'],
    [...rows.flatMap((r) => r.overage!.lines.map((x) => [month, r.tenant.code, r.tenant.name, r.package?.code ?? '', x.label, x.over, x.unit, x.rate, x.note, x.amount])), ['', '', '', '', '', '', '', '', 'รวม', total]]);
  return (
    <div className="tab-body">
      <div className="toolbar"><MonthSelect value={month} onChange={setMonth} /><button onClick={csv} disabled={!rows.length}>CSV / Excel</button></div>
      <ErrorBox error={q.error} />
      <div className="table-wrap"><table className="grid">
        <thead><tr><th>ลูกค้า</th><th>แพ็กเกจ</th><th>รายการ</th><th className="r">เกิน</th><th className="r">อัตรา</th><th>หมายเหตุ</th><th className="r">จำนวนเงิน</th></tr></thead>
        <tbody>
          {rows.map((r) => r.overage!.lines.map((x, i) => (
            <tr key={`${r.tenant.id}-${x.key}`}>
              {i === 0 && <td rowSpan={r.overage!.lines.length + 1}><span className="mono">{r.tenant.code}</span> {r.tenant.name}</td>}
              {i === 0 && <td rowSpan={r.overage!.lines.length + 1}>{r.package?.name_th}</td>}
              <td>{x.label}</td><td className="r num">{Number(x.over).toLocaleString('en-US', { maximumFractionDigits: 2 })} {x.unit}</td><td className="r num">{fmt(x.rate)}</td><td className="small muted">{x.note}</td><td className="r num">{fmt(x.amount)}</td>
            </tr>
          )).concat(<tr key={`${r.tenant.id}-sum`} className="subtotal"><td colSpan={4} className="r">รวม {r.tenant.code}</td><td className="r num"><b>{fmt(r.overage!.total)}</b></td></tr>))}
          {q.data && !rows.length && <tr><td colSpan={7} className="empty">เดือนนี้ไม่มีลูกค้าใช้เกินแพ็กเกจ ✓</td></tr>}
        </tbody>
        {rows.length > 0 && <tfoot><tr><td colSpan={6}>รวมทุกลูกค้า (ไม่รวม VAT)</td><td className="r num"><b>{fmt(total)}</b></td></tr></tfoot>}
      </table></div>
      <p className="small muted">บริษัท/ผู้ใช้: ที่ใช้จริงเกินจำนวนในแพ็กเกจ × อัตราต่อปี ÷ 12 · เอกสาร/AI: เกินขีดจำกัดของเดือน × อัตรา · ไฟล์: ส่วนที่เกิน (GB) × อัตราต่อ GB ต่อเดือน · ไฟล์ บริษัท ผู้ใช้ = ณ ตอนนี้ (ไม่ย้อนหลัง) · ใช้ทำใบแจ้งหนี้เอง ระบบไม่ออกใบแจ้งหนี้</p>
    </div>
  );
}
