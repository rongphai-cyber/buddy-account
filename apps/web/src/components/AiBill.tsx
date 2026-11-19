import { lazy, Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { checkTaxId, d, fmt, supplierFromBill, type BillDraft } from '@buddy/core';
import { api } from '../api';
import { ErrorBox, Modal, Pill } from '../ui';
const SupplierForm = lazy(() => import('../pages/parties/Parties').then((m) => ({ default: m.SupplierForm })));
import { checkOllama, localOcrOn, readBillLocally, type LocalRead } from '../localOcr';

type Pick = { id: string; code: string; name_th: string; item_type?: string; base_unit_id: string | null };
type Sup = { id: string; code: string; name: string; tax_id?: string | null; tax_branch_no: string | null };
type SupRow = Sup & { status: string };
export interface AiBillResult {
  bill: BillDraft;
  supplier: Sup | null;
  supplier_check?: { status: string; message: string; candidate: Sup | null };
  duplicate?: { doc_no: string; doc_class: string; doc_date: string } | null;
  suggest_note?: string | null;
  lines: Array<BillDraft['lines'][number] & {
    item: Pick | null;
    suggestion?: { item: Pick; kind: 'item' | 'expense'; account: string | null; confidence: 'high' | 'medium' | 'low'; reason: string; source: 'ai' | 'history' | 'name' } | null;
    alternatives?: Array<Pick & { kind: string; account: string | null }>;
    note?: string | null;
  }>;
  usage: { model: string; cost_usd: string; month_cost_usd: string; monthly_limit_usd: number | null };
  /** ผู้ซื้อในบิลเทียบกับบริษัทนี้ (same/misread = แสดงเลขบริษัท · other/unclear = เตือน) */
  buyer_check?: { status: 'none' | 'same' | 'misread' | 'other' | 'unclear'; shown: string | null; message: string | null; company_name: string | null; company_tax_id: string | null };
  /** local_ocr = อ่านภาพในเครื่องนี้ (Typhoon-OCR) แล้ว Claude จัดร่างจากข้อความ · claude_image = Claude อ่านภาพ */
  read_by?: 'local_ocr' | 'claude_image';
}
const CONF: Record<string, [string, 'n' | 'm' | 'c']> = { high: ['มั่นใจ', 'n'], medium: ['น่าจะใช่', 'm'], low: ['ไม่แน่ใจ', 'c'] };
const SRC: Record<string, string> = { ai: 'AI', history: 'ประวัติ', name: 'ชื่อรหัส' };
const SUPOK = new Set(['match']);
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
  /** อ่านบิลแบบผสม: ขั้นที่กำลังทำ · ผลอ่านในเครื่อง · เหตุที่กลับไปให้ Claude อ่านภาพ */
  const [step, setStep] = useState<string | null>(null);
  const [local, setLocal] = useState<LocalRead | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const localMode = localOcrOn();
  /** รหัสที่พนักงานบัญชีเลือกต่อบรรทัด ('' = ไม่ใส่รหัส) · ใช้ผู้จำหน่ายที่ชื่อคล้าย */
  const [choice, setChoice] = useState<string[]>([]);
  const [useCand, setUseCand] = useState(false);
  /** เพิ่มผู้จำหน่ายจากบิล (เจ้าของ 19/11/2569): ตรวจเลขผู้เสียภาษีซ้ำก่อน — เลข+สาขาเดียวกันมีแล้ว = ให้เลือกรายเดิม ไม่เพิ่มซ้ำ · คนละสาขา = เตือนให้ตัดสินใจ */
  const [add, setAdd] = useState<{ init: Record<string, string | boolean>; same: SupRow[]; other: SupRow[]; form: boolean; badTax: string | null } | null>(null);
  const startAdd = async () => {
    if (!res) return;
    setErr(null);
    try {
      const init = supplierFromBill(res.bill);
      const tax = init.tax_id.replace(/\D/g, '');
      const ck = tax ? checkTaxId(tax) : null;
      let same: SupRow[] = [], other: SupRow[] = [];
      if (ck?.ok) {
        const r = await api.get<{ rows: SupRow[] }>('/api/v1/suppliers', { q: tax, status: 'all', limit: 50 });
        const hit = r.rows.filter((x) => (x.tax_id ?? '').replace(/\D/g, '') === tax);
        // สาขาเดียวกัน = สาขาตามแฟ้ม หรือมีในแท็บสาขาของรายนั้น (เจ้าของ 19/11/2569)
        const det = await Promise.all(hit.map((x) => api.get<{ branches?: Array<{ branch_no: string }> }>(`/api/v1/suppliers/${x.id}`)));
        const hasBr = (x: SupRow, i: number) => (x.tax_branch_no ?? '00000') === init.tax_branch_no || (det[i]!.branches ?? []).some((b) => b.branch_no === init.tax_branch_no);
        same = hit.filter(hasBr);
        other = hit.filter((x, i) => !hasBr(x, i));
      }
      const code = (await api.get<{ code: string }>('/api/v1/suppliers/next-code')).code;
      const badTax = !tax ? 'บิลนี้อ่านเลขผู้เสียภาษีไม่ได้ — ใส่เลขในแท็บ ภาษีและบัญชี (ตรวจซ้ำได้เมื่อมีเลข)' : ck && !ck.ok ? `เลขผู้เสียภาษีที่อ่านได้ ${tax} ${ck.error} — แก้ในแท็บ ภาษีและบัญชี ก่อนบันทึก (อาจอ่านผิด)` : null;
      setAdd({ init: { ...init, code, from_bill: true }, same, other, form: !same.length && !other.length, badTax });
    } catch (e) { setErr(e); }
  };
  /** เลขผู้เสียภาษีเดียวกันคนละสาขา = เพิ่มสาขาให้ผู้จำหน่ายรายเดิม ไม่สร้างเจ้าหนี้ซ้ำ (เจ้าของ 19/11/2569) */
  const addBranch = async (sid: string) => {
    if (!res) return;
    const init = supplierFromBill(res.bill);
    try {
      await api.post(`/api/v1/suppliers/${sid}/branches`, { branch_no: init.tax_branch_no, name: `สาขา ${init.tax_branch_no}`, address_1: init.address_1 || null, address_2: init.address_2 || null, address_3: init.address_3 || null, zip_code: init.zip_code || null, phone: init.phone || null });
      await chooseSupplier(sid, `เพิ่มสาขา ${init.tax_branch_no} ให้ผู้จำหน่ายแล้ว:`);
    } catch (e) { setErr(e); }
  };
  /** บิลไม่มีชื่อผู้ขาย (ใบเสร็จไม่สมบูรณ์ หาบเร่ แท็กซี่ ฯลฯ) → เจ้าหนี้กลาง + ในเอกสารเลือกผู้จ่ายเงิน (พนักงาน) แล้วพิมพ์ใบรับรองแทนใบเสร็จ (เจ้าของ 19/11/2569) */
  const pickCentral = async () => {
    try {
      const c = await api.post<{ id: string }>('/api/v1/ai/central-supplier', { target });
      qc.invalidateQueries({ queryKey: ['trade-defaults'] });
      await chooseSupplier(c.id, 'ใช้เจ้าหนี้กลาง (ไม่มีชื่อผู้ขาย):');
      setRes((r) => r && { ...r, supplier_check: { ...r.supplier_check!, message: `${r.supplier_check!.message} — ในเอกสารเลือกผู้จ่ายเงิน (พนักงาน) แล้วพิมพ์ใบรับรองแทนใบเสร็จรับเงิน · ไม่มีภาษีซื้อ ไม่หัก ณ ที่จ่าย` } });
    } catch (e) { setErr(e); }
  };
  /** ใช้ผู้จำหน่ายรายนี้ในร่าง (เพิ่มใหม่หรือรายเดิมที่เลขตรงกัน) */
  const chooseSupplier = async (sid: string, msg: string) => {
    const x = await api.get<Sup & { status: string }>(`/api/v1/suppliers/${sid}`);
    setRes((r) => r && { ...r, supplier: { id: x.id, code: x.code, name: x.name, tax_id: x.tax_id, tax_branch_no: x.tax_branch_no }, supplier_check: { status: 'match', message: `${msg} ${x.code} ${x.name}`, candidate: null } });
    setAdd(null); setUseCand(false);
  };
  const pick = (f: File | null) => {
    setRes(null); setErr(null);
    if (url) URL.revokeObjectURL(url);
    if (f && !MEDIA.includes(f.type)) { setFile(null); setUrl(null); setErr(new Error('รองรับรูป JPG PNG WEBP GIF หรือ PDF เท่านั้น')); return; }
    if (f && f.size > 10 * 1024 * 1024) { setFile(null); setUrl(null); setErr(new Error('แฟ้มใหญ่เกิน 10 MB — ย่อรูปหรือสแกนใหม่ที่ความละเอียดต่ำลง')); return; }
    setFile(f); setUrl(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  };
  const read = async () => {
    if (!file) return;
    setBusy(true); setErr(null); setLocal(null); setFallback(null);
    try {
      // อ่านในเครื่องนี้ก่อน (เปิดที่ เริ่มระบบ › AI อ่านบิล) — ใช้ไม่ได้ก็ให้ Claude อ่านภาพ พร้อมบอกเหตุ
      let lr: LocalRead | null = null;
      if (localMode) {
        setStep('กำลังตรวจ Ollama ในเครื่องนี้…');
        const ck = await checkOllama();
        if (!ck.ok || !ck.model) setFallback(ck.message);
        else try { lr = await readBillLocally(file, setStep); } catch (e) { setFallback(`อ่านในเครื่องไม่สำเร็จ: ${(e as Error).message.slice(0, 160)}`); }
      }
      setLocal(lr);
      setStep(lr ? 'Claude กำลังจัดร่างจากข้อความ…' : 'Claude กำลังอ่านภาพ…');
      const r = lr ? await api.post<AiBillResult>('/api/v1/ai/read-bill-text', { target, file_name: file.name, file_size: file.size, text: lr.text, pages: lr.pages, ocr_ms: lr.ms })
        : await api.post<AiBillResult>('/api/v1/ai/read-bill', { target, file_name: file.name, media_type: file.type, data: await toBase64(file) });
      setRes(r); setUseCand(false);
      // ค่าเริ่มต้น: ใช้คำแนะนำที่ไม่ใช่ "ไม่แน่ใจ" — พนักงานบัญชีเปลี่ยนได้ก่อนใส่ลงเอกสาร
      setChoice(r.lines.map((l) => (l.suggestion && l.suggestion.confidence !== 'low' ? l.suggestion.item.id : '')));
    } catch (e) { setErr(e); } finally { setBusy(false); setStep(null); qc.invalidateQueries({ queryKey: ['ai-status'] }); }
  };
  const b = res?.bill;
  return (
    <Modal title="อ่านบิลด้วย AI (Claude)" size="wide" onClose={onClose} footer={<>
      <button onClick={onClose}>ปิด</button>
      {!res ? <button className="primary" disabled={!file || busy} onClick={read}>{busy ? step ?? 'กำลังอ่าน… (ประมาณ 10–60 วินาที)' : 'อ่านบิล'}</button>
        : <button className="primary" autoFocus onClick={() => onApply({ ...res, supplier: res.supplier ?? (useCand ? res.supplier_check?.candidate ?? null : null),
            lines: res.lines.map((l, i) => ({ ...l, item: [l.suggestion?.item, ...(l.alternatives ?? [])].find((x) => x && x.id === choice[i]) ?? null })) })}>ใส่ลงเอกสาร (ร่าง)</button>}</>}>
      <div className="ai-bill">
        <div className="ai-bill-file">
          <input type="file" accept={MEDIA.join(',')} disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} aria-label="แฟ้มบิล" />
          {url ? <img src={url} alt="บิลที่เลือก" style={{ maxWidth: '100%', maxHeight: 420, marginTop: 8, border: '1px solid var(--line, #ccc)' }} /> : file && <p className="muted">📄 {file.name} ({Math.ceil(file.size / 1024)} KB)</p>}
          {localMode ? <p className="hint">โหมดอ่านในเครื่องนี้ก่อน: Typhoon-OCR อ่านภาพในเครื่องนี้ แล้วส่ง<b>เฉพาะข้อความ</b>ให้ Claude (Anthropic) จัดร่าง — ภาพไม่ออกจากเครื่อง · ถ้าอ่านในเครื่องไม่ได้ จะส่งภาพให้ Claude อ่านแทน (เปลี่ยนได้ที่ เริ่มระบบ › AI อ่านบิล)</p>
            : <p className="hint">ส่งแฟ้มไปให้ Claude (Anthropic) อ่าน — ใช้เฉพาะบิลของกิจการ · ค่าใช้จ่ายคิดตามจริงประมาณ 1–3 บาทต่อใบ</p>}
        </div>
        {fallback && !res && <p className="muted small">ไม่ได้อ่านในเครื่อง: {fallback} — ส่งภาพให้ Claude อ่านแทน</p>}
        <ErrorBox error={err} />
        {b && res && <div className="ai-bill-result">
          <p className="small"><Pill tone={res.read_by === 'local_ocr' ? 'n' : 'm'}>{res.read_by === 'local_ocr' ? 'อ่านในเครื่องนี้ + Claude จัดร่าง' : 'Claude อ่านภาพ'}</Pill>
            {local && <span className="muted"> Typhoon-OCR {local.pages} หน้า {(local.ms / 1000).toFixed(1)} วินาที</span>}
            {fallback && <span className="muted"> · ไม่ได้อ่านในเครื่อง: {fallback}</span>}</p>
          {local && <details className="small"><summary>ข้อความที่อ่านได้ในเครื่อง (ส่งให้ Claude)</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{local.text}</pre></details>}
          {res.duplicate && <p className="bad"><b>บิลซ้ำ:</b> เลขที่ {b.doc_no} ของผู้จำหน่ายนี้บันทึกแล้วใน {res.duplicate.doc_no} ({res.duplicate.doc_date}) — ตรวจก่อนบันทึกซ้ำ</p>}
          {res.supplier_check && <p className={SUPOK.has(res.supplier_check.status) ? 'small' : 'bad small'}>{SUPOK.has(res.supplier_check.status) ? '✓ ' : '⚠ '}{res.supplier_check.message}
            {res.supplier_check.candidate && !res.supplier && <label className="check" style={{ marginLeft: 8 }}><input type="checkbox" checked={useCand} onChange={(e) => setUseCand(e.target.checked)} /> ใช้ {res.supplier_check.candidate.code}</label>}
            {!res.supplier && !useCand && <button type="button" className="primary" style={{ marginLeft: 8 }} onClick={() => void startAdd()}>＋ เพิ่มผู้จำหน่ายใหม่จากบิลนี้</button>}
            {!res.supplier && !useCand && <button type="button" style={{ marginLeft: 8 }} onClick={() => void pickCentral()} title="บิลไม่สมบูรณ์ ไม่มีชื่อ/เลขผู้เสียภาษีของผู้ขาย — บันทึกกับเจ้าหนี้กลาง ผู้จ่ายเงิน (พนักงาน) ลงชื่อในใบรับรองแทนใบเสร็จรับเงิน">ไม่มีชื่อผู้ขาย — ใช้เจ้าหนี้กลาง</button>}
            {res.supplier && res.supplier_check.status === 'branch_new' && b.supplier.branch_no && <button type="button" className="primary" style={{ marginLeft: 8 }} onClick={() => void addBranch(res.supplier!.id)}>＋ เพิ่มสาขา {b.supplier.branch_no} ให้ {res.supplier.code}</button>}</p>}
          {add && !add.form && <div className="box small" role="alert" style={{ margin: '6px 0', padding: 8, border: '1px solid var(--line, #ccc)', borderRadius: 6 }}>
            {add.same.length > 0 ? <p className="bad"><b>ไม่เพิ่มซ้ำ:</b> เลขผู้เสียภาษี {String(add.init.tax_id)} สาขา {String(add.init.tax_branch_no)} มีในแฟ้มผู้จำหน่ายแล้ว — ใช้รายเดิม</p>
              : <p className="bad">เลขผู้เสียภาษี {String(add.init.tax_id)} เป็นของผู้จำหน่ายในแฟ้มแล้ว แต่ยังไม่มีสาขา {String(add.init.tax_branch_no)} — <b>เพิ่มสาขาให้รายเดิม</b> (ไม่สร้างเจ้าหนี้ซ้ำ) หรือเลือกรายเดิมถ้าบิลมาจากสาขาที่มีอยู่</p>}
            <table className="grid"><tbody>{[...add.same, ...add.other].map((x) => <tr key={x.id}><td className="mono">{x.code}</td><td>{x.name}</td><td className="mono">{x.tax_id} สาขา {x.tax_branch_no ?? '00000'}</td>
              <td>{x.status === 'I' ? <span className="muted">เลิกใช้แล้ว — เปิดใช้ที่ ซื้อ › รายละเอียดผู้จำหน่าย</span> : <>{add.other.includes(x) && <button type="button" className="primary" onClick={() => void addBranch(x.id)}>＋ เพิ่มสาขา {String(add.init.tax_branch_no)} ให้รายนี้</button>} <button type="button" onClick={() => void chooseSupplier(x.id, 'ใช้ผู้จำหน่ายเดิม').catch(setErr)}>ใช้รายนี้</button></>}</td></tr>)}</tbody></table>
            <div className="toolbar"><button type="button" onClick={() => setAdd(null)}>ปิด</button></div>
          </div>}
          {add?.form && <Suspense fallback={null}><SupplierForm id={null} initial={add.init} startTab={add.badTax ? 'tax' : 'main'} onClose={() => setAdd(null)}
            onSaved={(sv) => { if (!sv) { setAdd(null); return; } void chooseSupplier(sv.id, 'เพิ่มผู้จำหน่ายใหม่แล้ว:').catch(setErr); }} /></Suspense>}
          {add?.form && add.badTax && <p className="bad small">{add.badTax}</p>}
          {b.warnings.length > 0 && <ul className="bad small">{b.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {res.suggest_note && <p className="muted small">{res.suggest_note}</p>}
          <table className="grid info-table"><tbody>
            <tr><th>ผู้จำหน่าย</th><td>{b.supplier.name} {b.supplier.tax_id && <span className="mono small">{b.supplier.tax_id}{b.supplier.branch_no ? ` สาขา ${b.supplier.branch_no}` : ''}</span>}
              {' '}{res.supplier ? <Pill tone="n">พบ {res.supplier.code}</Pill> : <Pill tone="c">ไม่พบในแฟ้มผู้จำหน่าย — ใส่เป็นชื่อหรือเลือกเอง</Pill>}</td></tr>
            {res.buyer_check && res.buyer_check.status !== 'none' && <tr><th>ผู้ซื้อ</th><td>{res.buyer_check.status === 'same' || res.buyer_check.status === 'misread'
              ? <>{res.buyer_check.company_name} <span className="mono small">{res.buyer_check.company_tax_id}</span> <Pill tone="n">บริษัทนี้</Pill>{res.buyer_check.status === 'misread' && <span className="muted small"> (อ่านเลขในบิลเพี้ยนเล็กน้อย — ใช้เลขของบริษัท)</span>}</>
              : <><span className="mono small">{res.buyer_check.shown}</span> <Pill tone="x">{res.buyer_check.status === 'other' ? 'บิลนี้ออกในนามผู้อื่น' : 'ตรวจเลขผู้ซื้อ'}</Pill></>}</td></tr>}
            <tr><th>เลขที่ / วันที่</th><td>{b.doc_no || '—'} · {b.doc_date ?? '—'}</td></tr>
            <tr><th>ประเภทราคา</th><td>{PT[b.price_type]}{b.price_type !== '0' ? ` ${b.vat_rate}%` : ''}</td></tr>
            <tr><th>ยอด</th><td>ก่อน VAT {b.subtotal ? fmt(b.subtotal) : '—'} · VAT {b.vat_amount ? fmt(b.vat_amount) : '—'} · รวม <b>{b.total ? fmt(b.total) : '—'}</b></td></tr>
          </tbody></table>
          <table className="grid" style={{ marginTop: 8 }}>
            <thead><tr><th>#</th><th>รายการตามบิล</th><th style={{ minWidth: 260 }}>แนะนำลงบัญชี (ตรวจ/เลือก)</th><th className="r">จำนวน</th><th className="r">ราคา</th><th className="r">ยอด</th></tr></thead>
            <tbody>{res.lines.map((l, i) => {
              const opts = [...(l.suggestion ? [{ ...l.suggestion.item, kind: l.suggestion.kind, account: l.suggestion.account }] : []), ...(l.alternatives ?? [])];
              const chosen = opts.find((o) => o.id === choice[i]);
              return <tr key={i}><td>{i + 1}</td><td>{l.description}</td>
                <td>
                  <select value={choice[i] ?? ''} onChange={(e) => setChoice((c) => c.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`รหัสบรรทัด ${i + 1}`} style={{ width: '100%' }}>
                    <option value="">— ไม่ใส่รหัส (เลือกเองในเอกสาร) —</option>
                    {opts.map((o, k) => <option key={o.id} value={o.id}>{k === 0 && l.suggestion ? '★ ' : ''}{o.code} {o.name_th}{o.kind === 'expense' ? ' (ค่าใช้จ่าย)' : ''}</option>)}
                  </select>
                  {chosen?.account && <div className="small muted">บัญชี {chosen.account}</div>}
                  {l.suggestion && <div className="small">{(() => { const [t, tone] = CONF[l.suggestion.confidence]!; return <Pill tone={tone}>{t}</Pill>; })()} <span className="muted">{SRC[l.suggestion.source]}: {l.suggestion.reason}</span></div>}
                  {l.note && <div className="small bad">{l.note}</div>}
                </td>
                <td className="r">{d(l.qty).toString()} {l.unit}</td><td className="r">{l.unit_price ? fmt(l.unit_price, { places: 2 }) : ''}</td><td className="r">{l.amount ? fmt(l.amount) : ''}</td></tr>;
            })}</tbody>
          </table>
          <p className="hint">คำแนะนำมาจากประวัติการลงบัญชีของกิจการนี้ แฟ้มรหัส และแนวทางที่ตั้งไว้ (เริ่มระบบ › AI อ่านบิล) — พนักงานบัญชีตรวจและยืนยันทุกบรรทัด · เมื่อบันทึกเอกสารแล้ว ครั้งต่อไปจะแนะนำตามที่บันทึกนี้</p>
          <p className="muted small">ค่าใช้จ่ายครั้งนี้ ${res.usage.cost_usd} · เดือนนี้ ${d(res.usage.month_cost_usd).toFixed(2)}{res.usage.monthly_limit_usd !== null ? ` / เพดาน $${res.usage.monthly_limit_usd}` : ''} · {res.usage.model}</p>
        </div>}
      </div>
    </Modal>
  );
}
