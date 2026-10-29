import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt, type BillDraft } from '@buddy/core';
import { api } from '../api';
import { ErrorBox, Modal, Pill } from '../ui';

export interface AiBillResult {
  bill: BillDraft;
  supplier: { id: string; code: string; name: string; tax_branch_no: string | null } | null;
  lines: Array<BillDraft['lines'][number] & { item: { id: string; code: string; name_th: string; base_unit_id: string | null } | null }>;
  usage: { model: string; cost_usd: string; month_cost_usd: string; monthly_limit_usd: number | null };
}
const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const PT: Record<string, string> = { '0': 'ไม่มี VAT', '1': 'รวม VAT', '2': 'แยก VAT' };

const toBase64 = (f: File) => new Promise<string>((ok, bad) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => bad(new Error('อ่านแฟ้มไม่ได้'));
  r.readAsDataURL(f);
});

/**
 * ปุ่ม 📷 อ่านบิลด้วย AI (T7.7) — แสดงเมื่อบริษัทตั้งค่ากุญแจ API แล้ว
 * อ่านรูป/PDF ของบิลผู้จำหน่ายด้วย Claude → แสดงผลให้ตรวจ → "ใส่ลงเอกสาร" เติมเป็นร่าง (ยังไม่บันทึก)
 */
export function AiBillButton({ target, disabled, onApply }: { target: string; disabled?: boolean; onApply: (r: AiBillResult) => void }) {
  const st = useQuery({ queryKey: ['ai-status'], queryFn: () => api.get<{ available: boolean; has_key: boolean; monthly_limit_usd: number | null; month_cost_usd: string }>('/api/v1/ai/status'), staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  if (!st.data?.has_key) return null;
  return <>
    <button type="button" disabled={disabled || !st.data.available} onClick={() => setOpen(true)}
      title={st.data.available ? 'อ่านรูปหรือ PDF ของบิลผู้จำหน่ายด้วย AI แล้วเติมเป็นร่าง — ตรวจก่อนบันทึก' : `ใช้ AI เดือนนี้ครบเพดาน ${st.data.monthly_limit_usd} ดอลลาร์แล้ว`}>📷 อ่านบิลด้วย AI</button>
    {open && <AiBillDialog target={target} onClose={() => setOpen(false)} onApply={(r) => { setOpen(false); onApply(r); }} />}
  </>;
}

function AiBillDialog({ target, onClose, onApply }: { target: string; onClose: () => void; onApply: (r: AiBillResult) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<AiBillResult | null>(null);
  const pick = (f: File | null) => {
    setRes(null); setErr(null);
    if (url) URL.revokeObjectURL(url);
    if (f && !MEDIA.includes(f.type)) { setFile(null); setUrl(null); setErr(new Error('รองรับรูป JPG PNG WEBP GIF หรือ PDF เท่านั้น')); return; }
    if (f && f.size > 10 * 1024 * 1024) { setFile(null); setUrl(null); setErr(new Error('แฟ้มใหญ่เกิน 10 MB — ย่อรูปหรือสแกนใหม่ที่ความละเอียดต่ำลง')); return; }
    setFile(f); setUrl(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };
  const read = async () => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      setRes(await api.post<AiBillResult>('/api/v1/ai/read-bill', { target, file_name: file.name, media_type: file.type, data: await toBase64(file) }));
    } catch (e) { setErr(e); } finally { setBusy(false); qc.invalidateQueries({ queryKey: ['ai-status'] }); }
  };
  const b = res?.bill;
  return (
    <Modal title="อ่านบิลด้วย AI (Claude)" size="wide" onClose={onClose} footer={<>
      <button onClick={onClose}>ปิด</button>
      {!res ? <button className="primary" disabled={!file || busy} onClick={read}>{busy ? 'กำลังอ่าน… (ประมาณ 10–60 วินาที)' : 'อ่านบิล'}</button>
        : <button className="primary" autoFocus onClick={() => onApply(res)}>ใส่ลงเอกสาร (ร่าง)</button>}</>}>
      <div className="ai-bill">
        <div className="ai-bill-file">
          <input type="file" accept={MEDIA.join(',')} disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label="แฟ้มบิล" />
          {url ? <img src={url} alt="บิลที่เลือก" style={{ maxWidth: '100%', maxHeight: 420, marginTop: 8, border: '1px solid var(--line, #ccc)' }} /> : file && <p className="muted">📄 {file.name} ({Math.ceil(file.size / 1024)} KB)</p>}
          <p className="hint">ส่งแฟ้มไปให้ Claude (Anthropic) อ่าน — ใช้เฉพาะบิลของกิจการ · ค่าใช้จ่ายคิดตามจริงประมาณ 1–3 บาทต่อใบ</p>
        </div>
        <ErrorBox error={err} />
        {b && res && <div className="ai-bill-result">
          {b.warnings.length > 0 && <ul className="bad small">{b.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          <table className="grid info-table"><tbody>
            <tr><th>ผู้จำหน่าย</th><td>{b.supplier.name} {b.supplier.tax_id && <span className="mono small">{b.supplier.tax_id}{b.supplier.branch_no ? ` สาขา ${b.supplier.branch_no}` : ''}</span>}
              {' '}{res.supplier ? <Pill tone="n">พบ {res.supplier.code}</Pill> : <Pill tone="c">ไม่พบในแฟ้มผู้จำหน่าย — ใส่เป็นชื่อหรือเลือกเอง</Pill>}</td></tr>
            <tr><th>เลขที่ / วันที่</th><td>{b.doc_no || '—'} · {b.doc_date ?? '—'}</td></tr>
            <tr><th>ประเภทราคา</th><td>{PT[b.price_type]}{b.price_type !== '0' ? ` ${b.vat_rate}%` : ''}</td></tr>
            <tr><th>ยอด</th><td>ก่อน VAT {b.subtotal ? fmt(b.subtotal) : '—'} · VAT {b.vat_amount ? fmt(b.vat_amount) : '—'} · รวม <b>{b.total ? fmt(b.total) : '—'}</b></td></tr>
          </tbody></table>
          <table className="grid" style={{ marginTop: 8 }}>
            <thead><tr><th>#</th><th>รายการตามบิล</th><th>รหัสในโปรแกรม</th><th className="r">จำนวน</th><th className="r">ราคา</th><th className="r">ยอด</th></tr></thead>
            <tbody>{res.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.description}</td><td>{l.item ? <span className="mono">{l.item.code}</span> : <span className="muted small">เลือกเองในเอกสาร</span>}</td>
              <td className="r">{d(l.qty).toString()} {l.unit}</td><td className="r">{l.unit_price ? fmt(l.unit_price, { places: 2 }) : ''}</td><td className="r">{l.amount ? fmt(l.amount) : ''}</td></tr>)}</tbody>
          </table>
          <p className="muted small">ค่าใช้จ่ายครั้งนี้ ${res.usage.cost_usd} · เดือนนี้ ${d(res.usage.month_cost_usd).toFixed(2)}{res.usage.monthly_limit_usd !== null ? ` / เพดาน $${res.usage.monthly_limit_usd}` : ''} · {res.usage.model}</p>
        </div>}
      </div>
    </Modal>
  );
}
