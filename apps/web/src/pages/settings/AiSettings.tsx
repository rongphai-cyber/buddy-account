import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AI_BUSINESS_TYPES, AI_MODELS, aiBillEstimate, aiModelLabel, d, fmt, TYPHOON_MODEL } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { DateText, ErrorBox, Field, PageHead, PasswordInput, Pill, toast, useHotkeys } from '../../ui';
import { checkOllama, localOcrOn, setLocalOcrOn, type OllamaCheck } from '../../localOcr';
import { useUnsaved } from '../../unsaved';

type Config = { model: string; has_key: boolean; key_hint: string | null; key_broken: boolean; monthly_limit_usd: number | null; month_cost_usd: string; month_count: number; available: boolean; business_type: string | null; guidance: string | null };
const GUIDE_EXAMPLE = `ตัวอย่าง:
- ซื้อสินค้ามาขายต่อ (เสื้อผ้า รองเท้า) ลงเป็นรหัสสินค้า
- ค่าน้ำมันรถส่งของ ลงรหัส 95-5300-01 ค่าน้ำมัน
- ค่าไฟฟ้า ค่าน้ำประปา ค่าโทรศัพท์ ลงรหัสค่าสาธารณูปโภค
- อุปกรณ์สำนักงานราคาไม่เกิน 5,000 บาท ลงค่าใช้จ่ายวัสดุสิ้นเปลือง เกินกว่านั้นเป็นสินทรัพย์ (แจ้งให้ตรวจ)
- บริษัท ABC จำกัด เป็นผู้ให้เช่าอาคาร — ลงค่าเช่า`;
type Use = { created_at: string; status: string; model: string | null; input_tokens: number; output_tokens: number; cost_usd: string; file_name: string | null; message: string | null; username: string | null };

/**
 * ตั้งค่า AI อ่านบิล (T7.7) — กุญแจ API ของ Anthropic (Claude) ต่อบริษัท + เพดานค่าใช้จ่ายรายเดือน + การใช้งานเดือนนี้
 * กุญแจเข้ารหัสเก็บในฐานข้อมูล ไม่แสดงกลับ (เห็นเฉพาะ 4 ตัวท้าย) · ไม่อยู่ในแฟ้มสำรองข้อมูล
 */
export function AiSettingsPage() {
  const can = useCan('SET.AI');
  const { me } = useSession();
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['ai-config'], queryFn: () => api.get<Config>('/api/v1/ai/config') });
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => api.get<Use[]>('/api/v1/ai/usage') });
  const [key, setKey] = useState('');
  const [limit, setLimit] = useState<string | null>(null);
  const [biz, setBiz] = useState<string | null>(null);
  const [guide, setGuide] = useState<string | null>(null);
  const [mdl, setMdl] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const c = cfg.data;
  const lim = limit ?? (c ? (c.monthly_limit_usd === null ? '' : String(c.monthly_limit_usd)) : '');
  const bt = biz ?? c?.business_type ?? '';
  const gd = guide ?? c?.guidance ?? '';
  const md = mdl ?? c?.model ?? AI_MODELS[0].id;
  const save = async (body: { api_key?: string | null }) => {
    if (!c || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.put('/api/v1/ai/config', { ...body, monthly_limit_usd: lim.trim() === '' ? null : Number(lim), business_type: bt || null, guidance: gd.trim() || null, model: md });
      toast(body.api_key === null ? 'ลบกุญแจแล้ว' : body.api_key ? 'บันทึกกุญแจแล้ว' : 'บันทึกแล้ว');
      setKey(''); setLimit(null); setBiz(null); setGuide(null); setMdl(null);
      qc.invalidateQueries({ queryKey: ['ai-config'] }); qc.invalidateQueries({ queryKey: ['ai-status'] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: can('edit') ? () => save(key.trim() ? { api_key: key.trim() } : {}) : undefined }, [key, lim, bt, gd, md, c]);
  // ถามก่อนออกจากหน้าเมื่อยังไม่บันทึก (HANDOFF 149)
  useUnsaved(!!key.trim() || limit !== null || biz !== null || guide !== null || mdl !== null, { word: 'ค่าตั้ง AI อ่านบิล', save: () => void save(key.trim() ? { api_key: key.trim() } : {}) });
  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="เริ่มระบบ" title="AI อ่านบิล (Claude)"
        lead={<>ให้ AI ของ Anthropic (Claude) อ่านรูปหรือ PDF ของบิลผู้จำหน่าย แล้วเติมเป็นร่างในหน้าซื้อเงินเชื่อ/เงินสด และบันทึกค่าใช้จ่ายอื่น ๆ ของ <b>{me?.company?.name_th}</b> — ผู้ใช้ตรวจแล้วบันทึกเองทุกครั้ง</>} />
      <ErrorBox error={err ?? cfg.error} />
      {c && <>
        <fieldset className="box">
          <legend>สถานะ</legend>
          <p>{c.has_key ? <Pill tone="n">พร้อมใช้ · กุญแจ {c.key_hint}</Pill> : c.key_broken ? <Pill tone="x">กุญแจที่เก็บไว้ถอดรหัสไม่ได้ — ใส่ใหม่</Pill> : <Pill tone="c">ยังไม่ได้ใส่กุญแจ</Pill>}
            {' '}เดือนนี้อ่านแล้ว {c.month_count} ใบ · ค่าใช้จ่าย <b>${d(c.month_cost_usd).toFixed(2)}</b>{c.monthly_limit_usd !== null ? ` จากเพดาน $${c.monthly_limit_usd}` : ' (ไม่จำกัด)'} · รุ่น <b>{aiModelLabel(c.model)}</b></p>
        </fieldset>
        <fieldset className="box">
          <legend>กุญแจ API ของ Anthropic</legend>
          <Field label={c.has_key ? 'เปลี่ยนกุญแจ (ว่าง = ใช้กุญแจเดิม)' : 'กุญแจ API'} hint="สร้างที่ console.anthropic.com › API Keys (ขึ้นต้นด้วย sk-ant-) — ค่าใช้จ่ายเรียกเก็บกับบัญชี Anthropic ของคุณ">
            <PasswordInput autoComplete="off" value={key} disabled={!can('edit')} placeholder={c.has_key ? `ใช้อยู่ ${c.key_hint}` : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} style={{ width: '100%' }} />
          </Field>
          <Field label="รุ่น AI" hint="ใช้ทั้งอ่านบิลและแนะนำรหัส · ค่าใช้จ่ายต่อบิลเป็นค่าประมาณ (ขึ้นกับขนาดรูปและจำนวนรายการ) · รุ่นประหยัดอ่านบิลทั่วไปได้ดี ถ้าอ่านผิดบ่อยค่อยเปลี่ยนเป็นรุ่นที่แม่นกว่า">
            <select value={md} disabled={!can('edit')} onChange={(e) => setMdl(e.target.value)}>
              {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} · ประมาณ ${aiBillEstimate(m.id).toFixed(4)} ต่อบิล</option>)}
            </select>
          </Field>
          <Field label="เพดานค่าใช้จ่ายต่อเดือน (ดอลลาร์สหรัฐ)" hint="ครบเพดานแล้วปุ่มอ่านบิลใช้ไม่ได้จนถึงเดือนถัดไป · ว่าง = ไม่จำกัด">
            <input className="r" inputMode="decimal" value={lim} disabled={!can('edit')} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 140 }} />
          </Field>
          <div className="toolbar">
            <button className="primary" disabled={busy || !can('edit')} onClick={() => save(key.trim() ? { api_key: key.trim() } : {})}>บันทึก <kbd>F9</kbd></button>
            {c.has_key && <button disabled={busy || !can('edit')} onClick={() => { if (window.confirm('ลบกุญแจ API? ปุ่มอ่านบิลจะหายจนกว่าจะใส่ใหม่')) void save({ api_key: null }); }}>ลบกุญแจ</button>}
          </div>
          <p className="hint">กด บันทึก ด้านล่างเพื่อบันทึกทั้งกุญแจ รุ่น เพดาน และข้อมูลสำหรับแนะนำการลงบัญชี</p>
          <p className="hint">ข้อมูลในบิลถูกส่งไปให้ Anthropic ประมวลผลเพื่ออ่านเท่านั้น (โหมดอ่านในเครื่องนี้ก่อน: ภาพอยู่ในเครื่อง ส่งเฉพาะข้อความที่อ่านได้) · กุญแจเก็บแบบเข้ารหัส เห็นได้เฉพาะ 4 ตัวท้าย และไม่ติดไปกับแฟ้มสำรองข้อมูล (นำข้อมูลไปเครื่องอื่นต้องใส่กุญแจใหม่)</p>
        </fieldset>
        <LocalOcrBox />
        <fieldset className="box">
          <legend>ข้อมูลสำหรับให้ AI แนะนำการลงบัญชี (ของบริษัทนี้)</legend>
          <Field label="ประเภทธุรกิจ" hint="ช่วยแยกว่าของที่ซื้อควรเป็นสินค้า (ซื้อมาขาย/วัตถุดิบ) หรือค่าใช้จ่าย">
            <select value={bt} disabled={!can('edit')} onChange={(e) => setBiz(e.target.value)}><option value="">— ไม่ระบุ —</option>{Object.entries(AI_BUSINESS_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="แนวทางการลงบัญชีของบริษัท" hint="เขียนภาษาธรรมดา บอกว่ารายการแบบไหนลงรหัสอะไร (ไม่เกิน 4,000 ตัวอักษร) — AI ใช้ประกอบการแนะนำทุกครั้ง">
            <textarea rows={8} value={gd} maxLength={4000} disabled={!can('edit')} placeholder={GUIDE_EXAMPLE} onChange={(e) => setGuide(e.target.value)} style={{ width: '100%' }} />
          </Field>
          <div className="toolbar"><button className="primary" disabled={busy || !can('edit')} onClick={() => save(key.trim() ? { api_key: key.trim() } : {})}>บันทึก <kbd>F9</kbd></button></div>
          <div className="hint">
            <b>ใส่ข้อมูลอย่างไรให้ AI แนะนำได้แม่น</b>
            <ol style={{ margin: '4px 0 0 18px' }}>
              <li><b>ตั้งชื่อรหัสให้ชัด</b> — รหัสสินค้า (สินค้า › รายละเอียดสินค้า) และรหัสค่าใช้จ่าย (ซื้อ › รายละเอียดค่าใช้จ่ายอื่น ๆ) ใช้ชื่อที่ตรงกับที่พิมพ์ในบิล และใส่คำที่มักเจอในช่อง <b>หมายเหตุ</b> เช่น รหัส "ค่าน้ำมัน" หมายเหตุ "ดีเซล แก๊สโซฮอล์ เบนซิน ปตท บางจาก"</li>
              <li><b>ผูกบัญชีให้ครบ</b> — กลุ่มบัญชีสินค้า และบัญชีค่าใช้จ่ายของแต่ละรหัส (หน้าต่างอ่านบิลจะแสดงบัญชีที่จะลงให้ตรวจ)</li>
              <li><b>แฟ้มผู้จำหน่ายมีเลขผู้เสียภาษีและสาขา</b> — ใช้ตรวจว่าบิลมาจากใคร ชื่อ/สาขาตรงไหม และเตือนบิลซ้ำ</li>
              <li><b>เขียนแนวทาง</b> ในช่องด้านบน สำหรับรายการที่ชื่อรหัสอย่างเดียวบอกไม่ได้ เช่น เกณฑ์ราคาสินทรัพย์ ผู้จำหน่ายประจำที่ลงรหัสเฉพาะ</li>
              <li><b>ยืนยันทุกครั้งก่อนบันทึก</b> — เอกสารที่บันทึกแล้วกลายเป็นประวัติ ครั้งต่อไปรายการเดิมจากผู้จำหน่ายเดิมจะแนะนำรหัสเดิมได้มั่นใจขึ้น (ใช้ประวัติ 3 ปีล่าสุดของบริษัทนี้เท่านั้น)</li>
            </ol>
          </div>
        </fieldset>
      </>}
      <h3>การใช้งานเดือนนี้</h3>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 160 }}>เวลา</th><th>ผู้ใช้</th><th>แฟ้ม</th><th>ผล</th><th className="r">โทเคน เข้า/ออก</th><th className="r">ค่าใช้จ่าย ($)</th></tr></thead>
          <tbody>{usage.data?.map((u, i) => <tr key={i}>
            <td><DateText v={u.created_at} /> <span className="muted small">{new Date(u.created_at).toLocaleTimeString('th-TH')}</span></td><td>{u.username}</td><td>{u.file_name}</td>
            <td>{u.status === 'OK' ? <><Pill tone="n">อ่านได้</Pill>{u.message && <span className="small muted"> {u.message}</span>}</> : <span title={u.message ?? ''}><Pill tone="x">{u.status === 'REFUSED' ? 'ปฏิเสธ' : 'ไม่สำเร็จ'}</Pill> <span className="small muted">{u.message}</span></span>}</td>
            <td className="r">{fmt(String(u.input_tokens), { places: 0 })} / {fmt(String(u.output_tokens), { places: 0 })}</td><td className="r">{d(u.cost_usd).toFixed(4)}</td></tr>)}
            {usage.data && !usage.data.length && <tr><td colSpan={6} className="empty">เดือนนี้ยังไม่มีการใช้งาน</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * อ่านบิลแบบผสม (เจ้าของ 18/11/2569): ตั้งต่อเบราว์เซอร์/เครื่อง ไม่ใช่ต่อบริษัท — เครื่องที่ติดตั้ง Ollama + Typhoon-OCR เปิดใช้ได้
 * เปิดแล้ว: อ่านภาพในเครื่องนี้ก่อน ส่งเฉพาะข้อความให้ Claude · ใช้ไม่ได้ → Claude อ่านภาพตามเดิม (บอกเหตุในหน้าต่างอ่านบิล)
 */
function LocalOcrBox() {
  const [on, setOn] = useState(localOcrOn());
  const [ck, setCk] = useState<OllamaCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => { setBusy(true); try { setCk(await checkOllama(5000)); } finally { setBusy(false); } };
  return (
    <fieldset className="box">
      <legend>อ่านภาพในเครื่องนี้ก่อน (Typhoon-OCR ผ่าน Ollama)</legend>
      <label className="check"><input type="checkbox" checked={on} onChange={(e) => { setLocalOcrOn(e.target.checked); setOn(e.target.checked); if (e.target.checked) void test(); }} /> อ่านภาพในเครื่องนี้ก่อน แล้วส่งเฉพาะข้อความให้ Claude จัดร่าง <span className="muted small">(ตั้งเฉพาะเบราว์เซอร์นี้)</span></label>
      <p className="hint">ภาพบิลไม่ออกจากเครื่อง ค่าใช้จ่าย Claude ต่ำลง (ส่งข้อความแทนภาพ) · ใช้ได้เฉพาะเครื่องที่ติดตั้ง Ollama และโมเดล {TYPHOON_MODEL} · อ่านในเครื่องไม่ได้หรืออ่านไม่ชัด จะส่งภาพให้ Claude อ่านแทนโดยอัตโนมัติ</p>
      <div className="toolbar"><button type="button" disabled={busy} onClick={() => void test()}>{busy ? 'กำลังตรวจ…' : 'ตรวจการเชื่อมต่อ'}</button>
        {ck && <span>{ck.ok && ck.model ? <Pill tone="n">พร้อมใช้</Pill> : <Pill tone="x">ยังใช้ไม่ได้</Pill>} <span className="small">{ck.message}</span></span>}</div>
      <details className="hint">
        <summary>วิธีติดตั้ง (ครั้งเดียวต่อเครื่อง)</summary>
        <ol style={{ margin: '4px 0 0 18px' }}>
          <li>ติดตั้ง Ollama จาก ollama.com แล้วเปิด PowerShell พิมพ์ <code>ollama pull {TYPHOON_MODEL}</code> (ราว 3.2 GB · การ์ดจอ NVIDIA จะอ่านเร็ว ราว 5 วินาทีต่อหน้า)</li>
          <li>อนุญาตให้โปรแกรมนี้เรียก Ollama: พิมพ์ใน PowerShell <code>setx OLLAMA_ORIGINS "{location.origin}"</code> แล้วปิด Ollama ที่ไอคอนมุมขวาล่าง (Quit Ollama) และเปิดใหม่</li>
          <li>ติ๊ก "อ่านภาพในเครื่องนี้ก่อน" ด้านบน แล้วกด ตรวจการเชื่อมต่อ — ถ้าเบราว์เซอร์ถามขออนุญาตเข้าถึงแอป/อุปกรณ์ในเครื่องหรือเครือข่ายในบ้าน ให้กด อนุญาต (Allow)</li>
        </ol>
      </details>
    </fieldset>
  );
}
