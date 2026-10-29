import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fmt } from '@buddy/core';
import { api, ApiError } from '../../api';
import { useSession } from '../../session';
import { ErrorBox, Field, PageHead, toast } from '../../ui';

type Job = { id: string; code: string; files: Record<string, number>; status: 'upload' | 'running' | 'done' | 'error'; step: string; pct: number; seconds: number | null; missing: string[]; error: string | null;
  report: null | { company_id: string; code: string; name_th: string; counts: Record<string, { rows: number; source: string }>; quality: Record<string, string[]>; validation?: Record<string, unknown> } };
type Picked = { name: string; file: File };
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
/** ชื่อสาเหตุในรายงานคุณภาพข้อมูล (คีย์จากผู้นำเข้า) — ที่ไม่รู้จักแสดงคีย์เดิม */
const QUALITY_TH: Record<string, string> = {
  missing_gl_account: 'เลขที่บัญชีที่อ้างถึงแต่ไม่มีในผังบัญชี (สร้างให้ สถานะเลิกใช้)', template_account_missing: 'ต้นแบบการบันทึกอ้างบัญชีที่ไม่มี (เว้นว่างไว้)',
  istab_duplicate_code_renamed: 'รหัสซ้ำในตารางข้อมูล (เปลี่ยนรหัส)', periods_created_for_old_years: 'สร้างรอบบัญชีให้ข้อมูลปีเก่า', doc_type_created_for_prefix: 'สร้างประเภทเอกสารให้คำนำหน้าที่ไม่มีในระบบ',
};

/** T0.12 นำข้อมูลจากโปรแกรม Express — เลือกโฟลเดอร์ข้อมูลบริษัท (.DBF) อัปโหลด แล้วย้ายเป็นบริษัทใหม่ */
export function ImportPage() {
  const { me, select } = useSession();
  const nav = useNavigate();
  const files = useQuery({ enabled: !!me?.user.is_admin, queryKey: ['express-files'], queryFn: () => api.get<{ required: string[]; files: string[] }>('/api/v1/express-import/files') });
  const tenants = useQuery({ enabled: !!me?.user.is_platform, queryKey: ['tenants'], queryFn: () => api.get<Array<{ id: string; code: string; name: string }>>('/api/v1/tenants') });
  const [picked, setPicked] = useState<Picked[]>([]);
  const [folder, setFolder] = useState('');
  const [code, setCode] = useState('');
  const [tenant, setTenant] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [upl, setUpl] = useState<{ done: number; total: number; name: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.setAttribute('webkitdirectory', ''); input.current?.setAttribute('directory', ''); }, []);
  // ระหว่างนำเข้า: ดูสถานะทุก 1.5 วินาที
  useEffect(() => {
    if (job?.status !== 'running') return;
    const t = setInterval(() => { api.get<Job>(`/api/v1/express-import/jobs/${job.id}`).then(setJob).catch(setErr); }, 1500);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);
  if (!me?.user.is_admin) return <div className="page"><div className="notebox">เฉพาะผู้ดูแลระบบ</div></div>;
  const known = new Set(files.data?.files ?? []);
  const need = files.data?.required ?? [];
  const missing = need.filter((n) => !picked.some((p) => p.name === n));
  const total = picked.reduce((s, p) => s + p.file.size, 0);
  const busy = !!upl || job?.status === 'running';

  const choose = (list: FileList | null) => {
    setErr(null); setJob(null);
    const all = Array.from(list ?? []);
    const top = (all[0] as File & { webkitRelativePath?: string })?.webkitRelativePath?.split('/')[0] ?? '';
    const m = new Map<string, File>();
    for (const f of all) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
      if (rel.split('/').length > 2) continue;   // เฉพาะแฟ้มในโฟลเดอร์ที่เลือก (ไม่เอาโฟลเดอร์ย่อย)
      const base = f.name.replace(/\.dbf$/i, '').toUpperCase();
      if (/\.dbf$/i.test(f.name) && known.has(base)) m.set(base, f);
    }
    setPicked([...m.entries()].map(([name, file]) => ({ name, file })).sort((a, b) => a.name.localeCompare(b.name)));
    setFolder(top);
    if (!code) setCode(top.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20));
  };
  const start = async () => {
    setErr(null);
    try {
      const j = await api.post<Job>('/api/v1/express-import/jobs', { code, ...(me.user.is_platform && tenant ? { tenant_id: tenant } : {}) });
      setJob(j);
      for (let i = 0; i < picked.length; i++) {
        const p = picked[i]!;
        setUpl({ done: i, total: picked.length, name: p.name });
        const r = await fetch(`/api/v1/express-import/jobs/${j.id}/files/${p.name}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: p.file });
        if (!r.ok) { const e = (await r.json().catch(() => null))?.error ?? {}; throw new ApiError(r.status, e.code ?? 'ERROR', e.message ?? `อัปโหลด ${p.name}.DBF ไม่สำเร็จ`); }
      }
      setUpl(null);
      setJob(await api.post<Job>(`/api/v1/express-import/jobs/${j.id}/run`));
    } catch (e) { setUpl(null); setErr(e); }
  };
  const openCompany = async () => {
    if (!job?.report) return;
    await select({ company_id: job.report.company_id });
    toast(`เปิดบริษัท ${job.report.code} แล้ว`); nav('/');
  };
  const v = job?.report?.validation as Record<string, unknown> | undefined;
  const tb = v?.trial_balance_debit_credit as [number, number] | undefined;
  return (
    <div className="page" data-tone="home">
      <PageHead eyebrow="อื่น ๆ › นำข้อมูลจาก Express" title="นำข้อมูลจากโปรแกรม Express"
        lead="อ่านแฟ้ม .DBF ของโปรแกรม Express โดยตรง (ไม่ต้องติดตั้ง FoxPro) แล้วสร้างเป็นบริษัทใหม่พร้อมข้อมูลทั้งหมด: ผังบัญชี แฟ้มหลัก เอกสาร ใบสำคัญ เช็ค ภาษี ทรัพย์สิน ยอดยกมา แบบงบการเงิน — ไม่แก้ไขแฟ้มของ Express" />
      <ErrorBox error={err} />
      {(!job || job.status === 'upload') && <section className="card">
        <h2>1. เลือกโฟลเดอร์ข้อมูลบริษัทของ Express</h2>
        <p className="hint">โฟลเดอร์ที่มีแฟ้ม ISINFO.DBF GLACC.DBF … ของบริษัทนั้น (เช่น <code>C:\ExpressI\TESTRice</code>) — ระบบเลือกเฉพาะแฟ้มที่ใช้ ({files.data?.files.length ?? '…'} แฟ้ม) แล้วส่งขึ้นเครื่องแม่ข่าย</p>
        <div className="toolbar">
          <button className="primary" disabled={busy} onClick={() => input.current?.click()}>📁 เลือกโฟลเดอร์…</button>
          <input ref={input} type="file" multiple hidden onChange={(e) => { choose(e.target.files); e.target.value = ''; }} />
          {folder && <span>โฟลเดอร์ <b>{folder}</b> · พบ {picked.length} แฟ้ม ({mb(total)})</span>}
        </div>
        {folder && missing.length > 0 && <div className="errbox">ไม่พบ {missing.map((m) => m + '.DBF').join(', ')} — ไม่ใช่โฟลเดอร์ข้อมูลบริษัทของ Express หรือเลือกผิดโฟลเดอร์ (ต้องเลือกโฟลเดอร์ของบริษัท ไม่ใช่โฟลเดอร์โปรแกรม)</div>}
        {picked.length > 0 && <details><summary>แฟ้มที่จะส่ง ({picked.length})</summary>
          <div className="file-chips">{picked.map((p) => <span key={p.name} className="chip">{p.name} <small className="muted">{mb(p.file.size)}</small></span>)}</div></details>}
        <h2>2. รหัสบริษัทในระบบใหม่</h2>
        <div className="form-grid">
          <Field label="รหัสบริษัท" req hint="ตัวอักษรอังกฤษ ตัวเลข _ - ไม่เกิน 20 ตัว (ห้ามซ้ำกับบริษัทที่มี)"><input value={code} maxLength={20} disabled={busy} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9_-]/g, ''))} /></Field>
          {me.user.is_platform && <Field label="ลูกค้าผู้ใช้บริการ" hint="ว่าง = ลูกค้าเริ่มต้น"><select value={tenant} disabled={busy} onChange={(e) => setTenant(e.target.value)}><option value="">— ลูกค้าเริ่มต้น —</option>{tenants.data?.map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select></Field>}
        </div>
        <div className="actions">
          <button className="primary" disabled={busy || !picked.length || missing.length > 0 || !code} onClick={start}>{upl ? `กำลังส่งแฟ้ม ${upl.done + 1}/${upl.total} (${upl.name})…` : '3. เริ่มนำเข้า'}</button>
        </div>
        {upl && <div className="progress"><div style={{ width: `${Math.round((upl.done / upl.total) * 100)}%` }} /></div>}
        <p className="hint">ใช้เวลาหลายนาทีสำหรับข้อมูลหลายปี · ระหว่างนำเข้าใช้งานอื่นได้ตามปกติ · ถ้าไม่สำเร็จจะไม่มีข้อมูลใดถูกบันทึก (ลองใหม่ได้)</p>
      </section>}
      {job && job.status !== 'upload' && <section className="card">
        <h2>{job.status === 'running' ? 'กำลังนำเข้า…' : job.status === 'done' ? '✅ นำเข้าเสร็จแล้ว' : '❌ นำเข้าไม่สำเร็จ'} — บริษัท {job.code}</h2>
        <p>{job.step}{job.seconds !== null ? ` · ${job.seconds} วินาที` : ''}</p>
        <div className="progress"><div style={{ width: `${job.pct}%` }} /></div>
        {job.status === 'error' && <div className="errbox">{job.error}</div>}
        {job.status === 'error' && <div className="actions"><button onClick={() => { setJob(null); }}>เริ่มใหม่</button></div>}
        {job.report && <>
          <div className="actions"><button className="primary" onClick={openCompany}>เปิดบริษัท {job.report.code} {job.report.name_th}</button></div>
          {v && <>
            <h3>ตรวจกระทบยอดกับ Express</h3>
            <table className="grid" style={{ maxWidth: 820 }}><tbody>
              {tb && <tr><td>งบทดลอง (ใบสำคัญทั้งหมด) เดบิต / เครดิต</td><td className="r num">{fmt(String(tb[0]))} / {fmt(String(tb[1]))}</td><td>{Math.abs(tb[0] - tb[1]) < 0.005 ? '✅ ดุล' : '❌ ไม่ดุล'}</td></tr>}
              {v.journals_unbalanced !== undefined && <tr><td>ใบสำคัญที่ไม่ดุล</td><td className="r">{String(v.journals_unbalanced)}</td><td>{v.journals_unbalanced === 0 ? '✅' : '❌'}</td></tr>}
              {v.stock_pairs_compared !== undefined && <tr><td>ยอดสินค้าคงเหลือรายคลัง ตรงกับ Express</td><td className="r">{String(v.stock_pairs_match)} / {String(v.stock_pairs_compared)}</td><td>{v.stock_pairs_match === v.stock_pairs_compared ? '✅' : 'ⓘ ดูรายละเอียด'}</td></tr>}
              {v.ar_outstanding_total_new !== undefined && <tr><td>ลูกหนี้คงค้าง Express / ระบบใหม่</td><td className="r num">{fmt(String(v.ar_outstanding_total_express_REMAMT ?? ''))} / {fmt(String(v.ar_outstanding_total_new))}</td><td /></tr>}
              {v.ap_outstanding_total_new !== undefined && <tr><td>เจ้าหนี้คงค้าง Express / ระบบใหม่</td><td className="r num">{fmt(String(v.ap_outstanding_total_express ?? ''))} / {fmt(String(v.ap_outstanding_total_new))}</td><td /></tr>}
            </tbody></table>
            <details><summary>ผลตรวจทั้งหมด (สำหรับผู้ดูแลระบบ)</summary><pre className="small">{JSON.stringify(v, null, 1)}</pre></details>
          </>}
          <h3>ข้อมูลที่นำเข้า</h3>
          <div className="table-wrap"><table className="grid" style={{ maxWidth: 820 }}>
            <thead><tr><th>ตาราง</th><th>จาก Express</th><th className="r">จำนวนแถว</th></tr></thead>
            <tbody>{Object.entries(job.report.counts).map(([t, c]) => <tr key={t}><td className="mono small">{t}</td><td className="small">{c.source}</td><td className="r">{c.rows.toLocaleString()}</td></tr>)}</tbody>
          </table></div>
          {Object.keys(job.report.quality).length > 0 && <>
            <h3>หมายเหตุคุณภาพข้อมูล</h3>
            <p className="hint">ข้อมูลใน Express ที่ไม่สมบูรณ์ — ระบบนำเข้าได้ แต่ควรตรวจ/แก้ภายหลัง</p>
            <ul>{Object.entries(job.report.quality).map(([k, list]) => <li key={k}><b>{QUALITY_TH[k] ?? k}</b> — {list.length} รายการ{list.length ? `: ${list.slice(0, 8).join(', ')}${list.length > 8 ? ' …' : ''}` : ''}</li>)}</ul>
          </>}
        </>}
      </section>}
    </div>
  );
}
