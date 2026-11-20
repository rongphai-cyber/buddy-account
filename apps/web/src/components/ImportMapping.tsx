import { useEffect, useRef, useState } from 'react';
import { aiCost, aiModelLabel, guessMapping, importKindOf, mapColumns, unmappedRequired, type ImportMapping, type ImportMapTarget } from '@buddy/core';
import { api } from '../api';
import { cx, ErrorBox, Pill, toast } from '../ui';

/**
 * ให้ AI จัดรูปแบบ Excel (เจ้าของ 20/11/2569 "ทำทาง ก" · HANDOFF 168) — ใช้ร่วมกันที่หน้านำเข้าขาย/ซื้อ/ค่าใช้จ่าย และนำเข้าใบสำคัญ
 * เลือกแฟ้ม → ตรงแบบฟอร์ม = ตรวจเลย · มีการจับคู่ที่บันทึกไว้ = ใช้เลย (ไม่เสียค่า AI) · ไม่ตรง = หน้าจับคู่ (เดาให้ก่อน · ปุ่มให้ AI จัดรูปแบบ)
 * ยืนยันการจับคู่ → จำไว้กับหัวตารางแบบนี้ → ขั้นตรวจเดิม · แถวที่มีคำอธิบายแต่ไม่มีรหัส → แนะนำรหัสให้ผู้ใช้เลือกยอมรับ
 */
export type Analysis = { target: ImportMapTarget; label: string; matches: boolean; width: number; total_rows: number; preview: string[][];
  saved: { mapping: ImportMapping; signature: string; saved_at: string } | null; ai: { available: boolean; has_key: boolean; model: string; monthly_limit_usd: number | null; month_cost_usd: string } };
type Usage = { model: string; cost_usd: string; month_cost_usd: string; monthly_limit_usd: number | null };
type FileIn = { name: string; data: string };
export type CheckFn = (mapping: ImportMapping | null, codes: Record<string, string>) => Promise<void>;

const colName = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
const ORDER: Record<ImportMapping['date_order'], string> = { dmy: 'วว/ดด/ปปปป', mdy: 'ดด/วว/ปปปป', ymd: 'ปปปป/ดด/วว' };
const YEAR: Record<ImportMapping['year'], string> = { auto: 'ดูจากตัวเลข (2569 = พ.ศ.)', be: 'พ.ศ.', ce: 'ค.ศ.' };
const GROUPS: Record<ImportMapping['group'], string> = { column: 'เลขที่เดียวกัน = เอกสารเดียวกัน', continue: 'แถวที่เลขที่ (หรือวันที่) ว่าง = รายการต่อของเอกสารด้านบน', row: 'แถวละหนึ่งเอกสาร' };

/** สถานะการจัดรูปแบบของแฟ้มที่เลือก */
export function useImportMap(path: string, target: ImportMapTarget) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [review, setReview] = useState<ImportMapping | null>(null);
  const [source, setSource] = useState<'saved' | 'ai' | 'manual' | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const file = useRef<FileIn | null>(null);
  const check = useRef<CheckFn | null>(null);
  const reset = () => { setAnalysis(null); setMapping(null); setReview(null); setSource(null); setCodes({}); setUsage(null); setErr(null); };
  /** แฟ้มใหม่: ตรวจรูปแบบ แล้วตรวจแฟ้ม (หรือเปิดหน้าจับคู่) */
  const start = async (f: FileIn, fn: CheckFn) => {
    reset(); file.current = f; check.current = fn;
    const a = await api.post<Analysis>('/api/v1/import-map/analyze', { target: path, file_name: f.name, data: f.data });
    setAnalysis(a);
    if (a.matches) return fn(null, {});
    if (a.saved) { setMapping(a.saved.mapping); setSource('saved'); return fn(a.saved.mapping, {}); }
    setReview(guessMapping(a.preview, target));
  };
  const runAi = async () => {
    if (!file.current || aiBusy) return;
    setAiBusy(true); setErr(null);
    try {
      const r = await api.post<{ mapping: ImportMapping; usage: Usage }>('/api/v1/import-map/ai', { target: path, file_name: file.current.name, data: file.current.data });
      setReview(r.mapping); setUsage(r.usage); setSource('ai');
      toast(`AI จับคู่คอลัมน์แล้ว — ตรวจแล้วกด "ใช้การจับคู่นี้" · ค่าใช้ AI $${r.usage.cost_usd}`);
    } catch (e) { setErr(e); } finally { setAiBusy(false); }
  };
  /** ยืนยันการจับคู่ → จำไว้ (แฟ้มที่มีหัวตาราง) → ขั้นตรวจ */
  const use = async () => {
    if (!review || !analysis) return;
    setErr(null);
    try {
      if (review.header_row >= 0) await api.post('/api/v1/import-map/save', { target: path, header: analysis.preview[review.header_row] ?? [], mapping: review });
      setMapping(review); setSource((s) => (s === 'ai' ? 'ai' : 'manual')); setReview(null); setCodes({});
      await check.current?.(review, {});
    } catch (e) { setErr(e); }
  };
  /** ตัวตรวจแฟ้มล่าสุดของหน้า (ค่าบนหน้าจอเปลี่ยนได้หลังเลือกแฟ้ม) */
  const bind = (fn: CheckFn) => { check.current = fn; };
  const edit = () => setReview(mapping ?? (analysis ? guessMapping(analysis.preview, target) : null));
  const cancelReview = () => setReview(null);
  /** ยอมรับรหัสที่แนะนำ → ตรวจใหม่พร้อมรหัสเหล่านั้น */
  const acceptCodes = async (next: Record<string, string>) => { const all = { ...codes, ...next }; setCodes(all); await check.current?.(mapping, all); };
  return { analysis, mapping, review, setReview, source, codes, aiBusy, usage, err, start, bind, runAi, use, edit, cancelReview, acceptCodes, reset, path, target };
}
export type ImportMap = ReturnType<typeof useImportMap>;

/** แถบสถานะ + หน้าจับคู่คอลัมน์ */
export function ImportMapPanel({ im, busy }: { im: ImportMap; busy?: boolean }) {
  const a = im.analysis;
  if (!a) return null;
  const est = aiCost({ input_tokens: 5000, output_tokens: 900 }, a.ai.model).toFixed(4);
  const aiNote = a.ai.available ? null : a.ai.has_key ? `ใช้ AI เดือนนี้ครบเพดานแล้ว ($${a.ai.month_cost_usd}) — ผู้ดูแลเพิ่มเพดานได้ที่ เริ่มระบบ › AI อ่านบิล หรือจับคู่เองด้านล่าง` : 'ยังไม่ได้เปิดใช้ AI — ผู้ดูแลเปิดได้ที่ เริ่มระบบ › AI อ่านบิล (ใส่กุญแจ API) หรือจับคู่เองด้านล่าง';
  if (!im.review) {
    if (a.matches && !im.mapping) return <div className="im-bar muted small">แฟ้มตรงแบบฟอร์มของโปรแกรม <button type="button" className="link" onClick={im.edit}>จับคู่คอลัมน์เอง / ให้ AI จัดรูปแบบ</button></div>;
    if (!im.mapping) return null;
    return (
      <div className="im-bar card">
        {im.source === 'saved' ? <><Pill tone="n">✓ ใช้การจับคู่ที่บันทึกไว้ (ไม่เสียค่า AI)</Pill> <span className="muted small">แฟ้มหัวตารางแบบเดียวกับที่เคยจับคู่</span></>
          : <><Pill tone="n">✓ จัดรูปแบบแล้ว{im.source === 'ai' ? ' ด้วย AI' : ''}</Pill> <span className="muted small">{im.mapping.header_row >= 0 ? 'จำการจับคู่ไว้ใช้กับแฟ้มรูปแบบนี้ครั้งต่อไป' : 'แฟ้มไม่มีหัวตาราง — ใช้กับแฟ้มนี้เท่านั้น'}</span></>}
        {im.usage && <span className="muted small"> · ค่าใช้ AI ครั้งนี้ ${im.usage.cost_usd}</span>}
        <span className="im-bar-actions">
          <button type="button" disabled={busy} onClick={im.edit}>แก้การจับคู่</button>
          {a.ai.available && <button type="button" disabled={busy || im.aiBusy} onClick={() => { im.edit(); void im.runAi(); }}>✨ ให้ AI จับคู่ใหม่</button>}
        </span>
        <ErrorBox error={im.err} />
      </div>
    );
  }
  const m = im.review;
  const kind = importKindOf(im.path);
  const cols = mapColumns(im.target, kind);
  const missing = unmappedRequired(m, im.target, kind);
  const miss = new Set(missing.map((c) => c.key));
  const set = (p: Partial<ImportMapping>) => im.setReview({ ...m, ...p });
  const colOf = (key: string) => m.columns.find((c) => c.target === key);
  const setCol = (key: string, v: { source?: number; constant?: string } | null) => {
    const rest = m.columns.filter((c) => c.target !== key);
    set({ columns: v ? [...rest, { target: key, source: v.source ?? -1, constant: v.constant ?? '' }] : rest });
  };
  const head = m.header_row >= 0 ? a.preview[m.header_row] ?? [] : [];
  const data = a.preview.slice(m.header_row + 1).filter((r) => r.some((c) => String(c ?? '').trim()));
  const samples = (src: number) => data.map((r) => String(r[src] ?? '').trim()).filter(Boolean).slice(0, 3);
  const width = Math.max(a.width, head.length);
  const ordered = [...cols.filter((c) => c.required || colOf(c.key)), ...cols.filter((c) => !c.required && !colOf(c.key))];
  return (
    <div className="card im-review">
      <h3>จับคู่คอลัมน์ของแฟ้มกับแบบฟอร์ม{a.label ? ` ${a.label}` : ''}</h3>
      <p className="muted small">{a.matches ? 'แฟ้มนี้ตรงแบบฟอร์มอยู่แล้ว — จับคู่เองได้ถ้าต้องการ' : 'หัวตารางของแฟ้มไม่ตรงแบบฟอร์มของโปรแกรม'} · เลือกว่าคอลัมน์ในแฟ้มคือข้อมูลอะไร แล้วกด "ใช้การจับคู่นี้" — ระบบแปลงทุกแถวตามนี้แล้วตรวจก่อนนำเข้าเหมือนเดิม (ยังไม่บันทึก)</p>
      <div className="im-ai">
        {a.ai.available
          ? <><button type="button" className="soft" disabled={im.aiBusy} onClick={() => void im.runAi()}>{im.aiBusy ? 'AI กำลังจับคู่…' : '✨ ให้ AI จัดรูปแบบ'}</button>
            <span className="muted small">ส่งเฉพาะหัวตารางและตัวอย่างต้นแฟ้มไม่เกิน 25 แถว (ช่องละไม่เกิน 60 ตัว) ไปให้ Claude (Anthropic) จับคู่ — ไม่ส่งทั้งแฟ้ม · ข้อมูลถูกส่งไปให้ Anthropic ประมวลผลเพื่อจับคู่เท่านั้น · รุ่น {aiModelLabel(a.ai.model)} ประมาณ ${est} ต่อครั้ง (รวมในเพดานรายเดือนของ AI อ่านบิล)</span></>
          : <span className="warn-text small">{aiNote}</span>}
        {im.usage && <span className="muted small"> · ค่าใช้ AI ครั้งนี้ ${im.usage.cost_usd} · เดือนนี้ ${im.usage.month_cost_usd}</span>}
      </div>
      {m.notes && <p className="warn-text small">AI: {m.notes}</p>}
      <div className="form-grid im-opts">
        <label>แถวหัวตาราง<select value={m.header_row} onChange={(e) => set({ header_row: Number(e.target.value) })}>
          <option value={-1}>ไม่มีหัวตาราง (ข้อมูลเริ่มแถวแรก)</option>
          {a.preview.slice(0, 20).map((r, i) => <option key={i} value={i}>{`แถว ${i + 1}: ${r.filter((c) => String(c ?? '').trim()).join(' | ').slice(0, 70)}`}</option>)}
        </select></label>
        <label>รูปแบบวันที่<select value={m.date_order} onChange={(e) => set({ date_order: e.target.value as ImportMapping['date_order'] })}>{Object.entries(ORDER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>ปีในแฟ้ม<select value={m.year} onChange={(e) => set({ year: e.target.value as ImportMapping['year'] })}>{Object.entries(YEAR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>ตัวเลข<select value={m.decimal} onChange={(e) => set({ decimal: e.target.value as ImportMapping['decimal'] })}><option value="dot">1,234.50</option><option value="comma">1.234,50</option></select></label>
        <label>รวมแถวเป็นเอกสาร<select value={m.group} onChange={(e) => set({ group: e.target.value as ImportMapping['group'] })}>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>ไม่นำเข้าแถวที่มีคำ<input value={m.skip_words.join(', ')} placeholder="เช่น รวม, ยอดยกไป" onChange={(e) => set({ skip_words: e.target.value.split(',').map((w) => w.trim()).filter(Boolean).slice(0, 10) })} /></label>
      </div>
      <div className="table-wrap">
        <table className="grid im-cols">
          <thead><tr><th>คอลัมน์ในแบบฟอร์ม</th><th style={{ width: 260 }}>คอลัมน์ในแฟ้ม</th><th>ตัวอย่างข้อมูล</th></tr></thead>
          <tbody>{ordered.map((c) => {
            const cur = colOf(c.key);
            const val = !cur ? '' : cur.source >= 0 ? String(cur.source) : 'const';
            return <tr key={c.key} className={cx(miss.has(c.key) && 'im-miss')}>
              <td title={c.hint}>{c.th}{c.required && <span className={miss.has(c.key) ? 'req-mark' : 'muted'}> *</span>}{c.alt && <span className="muted small"> (หรือ {cols.find((x) => x.key === c.alt)?.th})</span>}</td>
              <td>
                <select aria-label={`คอลัมน์ในแฟ้มของ ${c.th}`} value={val} onChange={(e) => setCol(c.key, e.target.value === '' ? null : e.target.value === 'const' ? { constant: cur?.constant || '' } : { source: Number(e.target.value) })}>
                  <option value="">— ไม่มี/ไม่ใช้ —</option>
                  {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{`${colName(i)} · ${String(head[i] ?? '').trim().slice(0, 30) || '(ไม่มีชื่อ)'}`}</option>)}
                  <option value="const">ค่าเดียวกันทุกแถว…</option>
                </select>
                {val === 'const' && <input aria-label={`ค่าของ ${c.th}`} value={cur?.constant ?? ''} maxLength={60} placeholder="เช่น JV" onChange={(e) => setCol(c.key, { constant: e.target.value })} />}
              </td>
              <td className="small">{cur ? (cur.source >= 0 ? samples(cur.source).join(' · ') || <span className="muted">(ว่าง)</span> : cur.constant) : ''}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {missing.length > 0 && <p className="err-text small">ยังไม่ได้จับคู่คอลัมน์ที่ต้องมี: {missing.map((c) => c.th).join(', ')}</p>}
      <div className="im-actions">
        <button type="button" className="primary" disabled={!!missing.length || busy} title={missing.length ? `จับคู่ ${missing.map((c) => c.th).join(', ')} ก่อน` : undefined} onClick={() => void im.use()}>ใช้การจับคู่นี้</button>
        <button type="button" onClick={im.cancelReview}>ยกเลิก</button>
        <span className="muted small">ระบบจำการจับคู่นี้ไว้กับหัวตารางแบบนี้ — แฟ้มรูปแบบเดิมครั้งต่อไปใช้ได้เลยโดยไม่เรียก AI</span>
      </div>
      <ErrorBox error={im.err} />
    </div>
  );
}

type Sug = { row: number; text: string; amount: string; suggestion: { code: string; name: string; source: 'history' | 'name' | 'ai'; confidence: 'high' | 'medium' | 'low'; reason: string } | null; alternatives: Array<{ code: string; name: string }> };
type SugRes = { kind: 'item' | 'expense' | 'account'; rows: Sug[]; usage: Usage | null; note: string | null; ai_left: number };
const SRC: Record<string, string> = { history: 'ประวัติ', name: 'ชื่อรหัส', ai: 'AI' };
const CONF: Record<string, string> = { high: 'มั่นใจ', medium: 'น่าจะใช่', low: 'ไม่แน่ใจ' };
const WHAT: Record<SugRes['kind'], string> = { item: 'รหัสสินค้า', expense: 'รหัสค่าใช้จ่าย', account: 'เลขที่บัญชี' };

/** แถวที่มีคำอธิบายแต่ไม่มีรหัส → รหัสที่แนะนำ (ประวัติ/ชื่อรหัสก่อน · AI เมื่อกด) — ผู้ใช้ติ๊กเลือกแล้วกดใช้เอง ไม่เติมเงียบ */
export function CodeSuggestPanel({ im, need, fileName, aiAvailable, busy }: { im: ImportMap; need: Array<{ row: number; text: string; amount: string }>; fileName: string; aiAvailable: boolean; busy?: boolean }) {
  const [res, setRes] = useState<SugRes | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [on, setOn] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const key = need.map((n) => `${n.row}:${n.text}`).join('|');
  const load = async (useAi: boolean) => {
    if (!need.length) return;
    setLoading(true); setErr(null);
    try {
      const r = await api.post<SugRes>('/api/v1/import-map/suggest', { target: im.path, use_ai: useAi, file_name: fileName, items: need.slice(0, 500) });
      setRes(r);
      setPick((p) => { const n = { ...p }; for (const x of r.rows) if (x.suggestion && !n[x.row]) n[x.row] = x.suggestion.code; return n; });
      setOn((o) => { const n = { ...o }; for (const x of r.rows) if (x.suggestion && n[x.row] === undefined) n[x.row] = true; return n; });
      if (useAi && r.usage) toast(`AI แนะนำรหัสแล้ว · ค่าใช้ AI $${r.usage.cost_usd}`);
    } catch (e) { setErr(e); } finally { setLoading(false); }
  };
  useEffect(() => { setRes(null); setPick({}); setOn({}); void load(false); }, [key]);
  if (!need.length) return null;
  const chosen = Object.fromEntries((res?.rows ?? []).filter((x) => on[x.row] && pick[x.row]).map((x) => [String(x.row), pick[x.row]!]));
  const n = Object.keys(chosen).length;
  const left = (res?.rows ?? []).filter((x) => !x.suggestion).length;
  const what = WHAT[res?.kind ?? (im.target === 'journal' ? 'account' : im.target === 'expense' ? 'expense' : 'item')];
  return (
    <div className="card im-suggest">
      <h3>แนะนำ{what} — {need.length} แถวมีคำอธิบายแต่ไม่มี{what}</h3>
      <p className="muted small">แนะนำจากประวัติการลงบัญชีและชื่อรหัสของกิจการนี้ — ตรวจ เลือก แล้วกด "ใช้{what}ที่เลือก" (ระบบไม่เติมให้เอง){res?.note ? ` · ${res.note}` : ''}</p>
      {aiAvailable && left > 0 && <p><button type="button" className="soft" disabled={loading || busy} onClick={() => void load(true)}>✨ ให้ AI แนะนำที่เหลือ ({left} แถว)</button>
        <span className="muted small"> ส่งเฉพาะคำอธิบาย ยอด และรายชื่อรหัสที่เกี่ยวข้องไปให้ Claude (Anthropic) — เรียกครั้งเดียวทุกแถว{res?.usage ? ` · ครั้งล่าสุด $${res.usage.cost_usd}` : ''}</span></p>}
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 50 }}>ใช้</th><th style={{ width: 60 }}>แถว</th><th>คำอธิบายในแฟ้ม</th><th className="r" style={{ width: 110 }}>ยอด</th><th style={{ width: 300 }}>{what}</th><th style={{ width: 170 }}>ที่มา</th></tr></thead>
          <tbody>{(res?.rows ?? need.map((x) => ({ ...x, suggestion: null, alternatives: [] }))).map((x) => {
            const opts = [...(x.suggestion ? [{ code: x.suggestion.code, name: x.suggestion.name }] : []), ...x.alternatives].filter((o, i, arr) => arr.findIndex((y) => y.code === o.code) === i);
            return <tr key={x.row}>
              <td><input type="checkbox" aria-label={`ใช้รหัสของแถว ${x.row}`} checked={!!on[x.row]} disabled={!pick[x.row]} onChange={(e) => setOn({ ...on, [x.row]: e.target.checked })} /></td>
              <td className="r num muted">{x.row}</td><td>{x.text}</td><td className="r num">{x.amount}</td>
              <td>{opts.length ? <select aria-label={`${what}ของแถว ${x.row}`} value={pick[x.row] ?? ''} onChange={(e) => { setPick({ ...pick, [x.row]: e.target.value }); setOn({ ...on, [x.row]: !!e.target.value }); }}>
                <option value="">— ไม่ใช้ —</option>{opts.map((o) => <option key={o.code} value={o.code}>{o.code} {o.name}</option>)}</select> : <span className="muted small">{loading ? 'กำลังหา…' : 'ไม่พบรหัสที่ใกล้เคียง — ใส่ในแฟ้มเอง'}</span>}</td>
              <td className="small">{x.suggestion ? <><Pill tone={x.suggestion.source === 'ai' ? 'm' : 'n'}>{SRC[x.suggestion.source]}</Pill> {CONF[x.suggestion.confidence]}<div className="muted">{x.suggestion.reason}</div></> : ''}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="im-actions">
        <button type="button" className="primary" disabled={!n || busy || loading} onClick={() => void im.acceptCodes(chosen)}>ใช้{what}ที่เลือก ({n} แถว) แล้วตรวจใหม่</button>
        {Object.keys(im.codes).length > 0 && <span className="muted small">ใช้รหัสที่เลือกไว้แล้ว {Object.keys(im.codes).length} แถว</span>}
      </div>
      <ErrorBox error={err} />
    </div>
  );
}
