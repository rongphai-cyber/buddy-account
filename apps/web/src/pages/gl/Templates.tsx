import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api, type Department, type Template, type TemplateDetail } from '../../api';
import { AccountCell, useAccounts } from '../../components/AccountCell';
import { Confirm, cx, ErrorBox, Field, KeyHints, Modal, MoneyInput, navKey, PageHead, toast, toastError, useHotkeys } from '../../ui';

interface TLine { key: number; account_id: string | null; department_id: string | null; description: string; side: 'D' | 'C'; amount: string }
let seq = 0;
const blank = (side: 'D' | 'C' = 'D'): TLine => ({ key: ++seq, account_id: null, department_id: null, description: '', side, amount: '' });

export function useTemplates() {
  return useQuery({ queryKey: ['templates'], queryFn: () => api.get<Template[]>('/api/v1/gl/templates'), staleTime: 60_000 });
}

/** ต้นแบบวิธีการบันทึก — คู่มือบทที่ 15 S-GL-01 (ใช้ได้กับสมุดรายวันเท่านั้น รองรับหลายบัญชีเดบิต/เครดิต) */
export function TemplatesPage() {
  const qc = useQueryClient();
  const q = useTemplates();
  const [edit, setEdit] = useState<string | 'new' | null>(null);
  useHotkeys({ Insert: () => setEdit('new') }, []);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ต้นแบบวิธีการบันทึก" title="ต้นแบบวิธีการบันทึก"
        lead="รายการบัญชีที่บันทึกซ้ำบ่อย เช่น ค่าใช้จ่ายประจำเดือน ค่าเสื่อมราคา — เลือกใช้ในสมุดรายวันที่ช่องเลขที่ใบสำคัญ (🔍 / F4) หรือผูกกับสมุดให้ขึ้นอัตโนมัติ"
        actions={<button className="primary" onClick={() => setEdit('new')}>+ เพิ่มต้นแบบ <kbd>Ins</kbd></button>} />
      <ErrorBox error={q.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 120 }}>รหัส</th><th>รายละเอียด</th><th>รายละเอียด (อังกฤษ)</th><th className="r" style={{ width: 90 }}>บรรทัด</th><th style={{ width: 140 }}>ขึ้นอัตโนมัติในสมุด</th></tr></thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id} className="row-open" onClick={() => setEdit(t.id)}>
                <td className="mono">{t.code}</td><td>{t.name}</td><td className="muted">{t.name_en}</td><td className="r">{Number(t.line_count)}</td><td className="mono">{t.book_codes}</td>
              </tr>
            ))}
            {q.data && !q.data.length && <tr><td colSpan={5} className="empty">ยังไม่มีต้นแบบ — กด <kbd>Ins</kbd> เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มต้นแบบ'], ['คลิก/Enter', 'แก้ไข'], ['F9', 'บันทึก'], ['Esc', 'ปิด']]} />
      {edit && <TemplateForm id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['templates'] }); }} />}
    </div>
  );
}

/** หน้าจอเพิ่ม/แก้ไขต้นแบบ — เปิดได้จากหน้ารายการ และจากหน้าต่างเลือกต้นแบบในสมุดรายวัน (Insert) */
export function TemplateForm({ id, initialCode = '', onClose, onSaved }: { id: string | null; initialCode?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/api/v1/departments') });
  const accts = useAccounts();
  const cur = useQuery({ enabled: !!id, queryKey: ['template', id], queryFn: () => api.get<TemplateDetail>(`/api/v1/gl/templates/${id}`), staleTime: 0 });
  const [h, setH] = useState<{ code: string; name: string; name_en: string } | null>(id ? null : { code: initialCode.toUpperCase(), name: '', name_en: '' });
  const [lines, setLines] = useState<TLine[]>([blank('D'), blank('C')]);
  const [err, setErr] = useState<unknown>(null);
  const [delAsk, setDelAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  if (id && cur.data && !h) {
    setH({ code: cur.data.code, name: cur.data.name, name_en: cur.data.name_en ?? '' });
    setLines(cur.data.lines.map((l) => ({ key: ++seq, account_id: l.account_id, department_id: l.department_id, description: l.description ?? '', side: l.side, amount: l.amount && !d(l.amount).isZero() ? l.amount : '' })));
  }

  const setLine = (k: number, p: Partial<TLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const addLine = () => {
    const n = blank(lines.at(-1)?.side === 'D' ? 'C' : 'D');
    n.description = lines.at(-1)?.description ?? '';
    setLines((ls) => [...ls, n]);
    setTimeout(() => gridRef.current?.querySelector<HTMLInputElement>(`tr[data-k="${n.key}"] input`)?.focus(), 0);
  };
  const delLine = (k: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== k) : [blank()]));
  const totals = useMemo(() => {
    const dr = lines.filter((l) => l.side === 'D').reduce((s, l) => s.plus(d(l.amount)), d(0));
    const cr = lines.filter((l) => l.side === 'C').reduce((s, l) => s.plus(d(l.amount)), d(0));
    return { dr, cr, hasAmount: lines.some((l) => !d(l.amount).isZero()) };
  }, [lines]);

  const save = async () => {
    if (!h || busy) return;
    setErr(null); setBusy(true);
    const body = { code: h.code, name: h.name, name_en: h.name_en || null, lines: lines.filter((l) => l.account_id || l.description || l.amount).map((l) => ({ account_id: l.account_id, department_id: l.department_id, description: l.description || null, side: l.side, amount: l.amount || null })) };
    try {
      const r = id ? await api.put<{ id: string }>(`/api/v1/gl/templates/${id}`, body) : await api.post<{ id: string }>('/api/v1/gl/templates', body);
      toast(`บันทึกต้นแบบ ${h.code} แล้ว`);
      qc.invalidateQueries({ queryKey: ['templates'] }); qc.invalidateQueries({ queryKey: ['template', r.id] });
      onSaved(r.id);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const remove = () => api.del(`/api/v1/gl/templates/${id}`).then(() => { toast('ลบต้นแบบแล้ว'); setDelAsk(false); qc.invalidateQueries({ queryKey: ['templates'] }); onClose(); }).catch((e) => { setDelAsk(false); toastError(e); });
  useHotkeys({ F9: save, 'Ctrl+S': save, 'Ctrl+Insert': addLine }, [h, lines, busy]);

  const issueLines = new Set(((err as { issues?: Array<{ line?: number }> })?.issues ?? []).map((i) => i.line).filter((x) => x !== undefined));
  const acctOf = (aid: string | null) => accts.data?.find((a) => a.id === aid);
  return (
    <Modal title={id ? `แก้ไขต้นแบบ ${h?.code ?? ''}` : 'เพิ่มต้นแบบวิธีการบันทึก'} size="wide" onClose={onClose}
      footer={<>{id && <button className="danger" onClick={() => setDelAsk(true)}>ลบต้นแบบ</button>}<button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={!h || busy} onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? cur.error} />
      {h && (
        <div onKeyDown={navKey}>
          <div className="form-grid">
            <Field label="รหัส" req hint="ภาษาอังกฤษสื่อความหมาย เช่น EXPENSE DEPRE"><input autoFocus value={h.code} maxLength={10} className="mono" onChange={(e) => setH({ ...h, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="รายละเอียด" req><input value={h.name} maxLength={120} onChange={(e) => setH({ ...h, name: e.target.value })} placeholder="เช่น ต้นแบบ บันทึกค่าใช้จ่ายประจำเดือน" /></Field>
            <Field label="รายละเอียด (อังกฤษ)" wide><input value={h.name_en} maxLength={120} onChange={(e) => setH({ ...h, name_en: e.target.value })} /></Field>
          </div>
          <div className="table-wrap lines" ref={gridRef} onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).dataset.last != null && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); addLine(); } }}>
            <table className="grid">
              <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: 170 }}>เลขที่บัญชี</th><th>ชื่อบัญชี</th><th style={{ width: 100 }}>แผนก</th><th>คำอธิบาย</th><th style={{ width: 124 }}>Dr/Cr</th><th className="r" style={{ width: 140 }}>จำนวนเงิน</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const a = acctOf(l.account_id);
                  return (
                    <tr key={l.key} data-k={l.key} className={cx(issueLines.has(i) && 'has-err')}>
                      <td className="muted">{i + 1}</td>
                      <td><AccountCell value={l.account_id} invalid={issueLines.has(i) && !l.account_id} onChange={(acc) => setLine(l.key, { account_id: acc?.id ?? null })} /></td>
                      <td className="small">{a ? a.name_th : <span className="muted">—</span>}</td>
                      <td>
                        <select value={l.department_id ?? ''} onChange={(e) => setLine(l.key, { department_id: e.target.value || null })}>
                          <option value="">—</option>
                          {depts.data?.filter((x) => x.status === 'A' || x.id === l.department_id).map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
                        </select>
                      </td>
                      <td><input value={l.description} maxLength={120} onChange={(e) => setLine(l.key, { description: e.target.value })} /></td>
                      <td>
                        <select value={l.side} onChange={(e) => setLine(l.key, { side: e.target.value as 'D' | 'C' })} aria-label="เดบิต/เครดิต">
                          <option value="D">Dr. เดบิต</option><option value="C">Cr. เครดิต</option>
                        </select>
                      </td>
                      <td><MoneyInput value={l.amount} onChange={(v) => setLine(l.key, { amount: v })} placeholder="ป้อนตอนใช้" {...(i === lines.length - 1 ? { 'data-last': '' } : {})} /></td>
                      <td><button type="button" className="icon-btn" tabIndex={-1} onClick={() => delLine(l.key)} title="ลบบรรทัด">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td colSpan={6}><button type="button" onClick={addLine}>+ เพิ่มบรรทัด <kbd>Ctrl+Ins</kbd></button> <span className="hint">จำนวนเงินว่างไว้ได้ ผู้ใช้ป้อนตอนนำต้นแบบไปใช้</span></td>
                <td className="r small">{totals.hasAmount && <>Dr <b className="num">{fmt(totals.dr)}</b><br />Cr <b className="num">{fmt(totals.cr)}</b>{!totals.dr.eq(totals.cr) && <><br /><span className="bad">ยังไม่ดุล</span></>}</>}</td>
                <td />
              </tr></tfoot>
            </table>
          </div>
        </div>
      )}
      {delAsk && <Confirm danger title="ลบต้นแบบ" text={`ลบต้นแบบ ${h?.code}? ใบสำคัญที่เคยใช้ต้นแบบนี้ไม่เปลี่ยนแปลง`} okText="ลบต้นแบบ" onClose={() => setDelAsk(false)} onOk={remove} />}
    </Modal>
  );
}

/** แปลงต้นแบบเป็นบรรทัดใบสำคัญ: Dr/Cr ตามต้นแบบ จำนวนเงินที่ว่างให้ผู้ใช้ป้อน */
export function templateToLines(t: TemplateDetail) {
  return t.lines.map((l) => {
    const amt = l.amount && !d(l.amount).isZero() ? d(l.amount).toFixed(2) : '';
    return { account_id: l.account_id, department_id: l.department_id, description: l.description ?? '', debit: l.side === 'D' ? amt : '', credit: l.side === 'C' ? amt : '' };
  });
}
