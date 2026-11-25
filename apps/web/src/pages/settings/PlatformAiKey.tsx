import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, fmt } from '@buddy/core';
import { api } from '../../api';
import { Confirm, DateText, ErrorBox, Field, Modal, PasswordInput, Pill, toast, useHotkeys } from '../../ui';

/** สถานะกุญแจ AI ของผู้ให้บริการ (GET /api/v1/platform/ai-key) — ไม่มีตัวกุญแจ เห็นเฉพาะ 4 ตัวท้าย */
interface PlatformAi {
  has_key: boolean; key_broken: boolean; key_hint: string | null; updated_at: string | null; month_cost_usd: string;
  tenants: Array<{ id: string; code: string; name: string; status: string; ai_limit_usd: string | null; month_cost_usd: string }>;
}

/**
 * AI ที่ WTS จ่ายให้ (HANDOFF 190 · เจ้าของ 25/11/2569 "ลูกค้าบางรายให้เราเป็นจ่ายให้")
 * เจ้าของใส่กุญแจ API ของ Anthropic เอง (เข้ารหัสเก็บ ไม่ส่งกลับหน้าจอ) · ลูกค้าที่ตั้ง "WTS จ่ายให้" ใช้กุญแจนี้ภายใต้เพดานต่อเดือนของแต่ละราย
 */
export function PlatformAiKey({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform-ai-key'], queryFn: () => api.get<PlatformAi>('/api/v1/platform/ai-key') });
  const [key, setKey] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const c = q.data;
  const save = async (api_key: string | null) => {
    if (busy) return;
    if (api_key !== null && !api_key.trim()) { setErr(new Error('วางกุญแจ API ของ Anthropic (ขึ้นต้นด้วย sk-ant-) แล้วกดบันทึก')); return; }
    setBusy(true); setErr(null);
    try {
      qc.setQueryData(['platform-ai-key'], await api.put<PlatformAi>('/api/v1/platform/ai-key', { api_key: api_key === null ? null : api_key.trim() }));
      toast(api_key === null ? 'ลบกุญแจ AI ของ WTS แล้ว — ลูกค้าที่ WTS จ่ายให้ใช้อ่านบิลด้วย AI ไม่ได้จนกว่าจะใส่ใหม่' : 'บันทึกกุญแจ AI ของ WTS แล้ว');
      setKey(''); setRemoving(false);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: () => void save(key), 'Ctrl+S': () => void save(key) }, [key, busy]);
  return (
    <Modal title="AI ที่ WTS จ่ายให้" size="wide" onClose={onClose} footer={<><button onClick={onClose}>ปิด</button><button className="primary" disabled={busy || !key.trim()} onClick={() => void save(key)}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? q.error} />
      <p className="small muted">ลูกค้าที่ตั้ง "ผู้จ่ายค่า AI = WTS จ่ายให้" (แก้ไขลูกค้าแต่ละราย) ใช้กุญแจนี้อ่านบิล — ค่าใช้จ่ายเรียกเก็บกับบัญชี Anthropic ของ WTS ภายใต้เพดานต่อเดือนของลูกค้าแต่ละราย (รวมทุกบริษัทของลูกค้า) · ลูกค้าอื่นใช้กุญแจของตัวเองตามเดิม</p>
      {c && <>
        <fieldset className="box">
          <legend>กุญแจ API ของ Anthropic (ของ WTS)</legend>
          <p>{c.has_key ? <Pill tone="m">พร้อมใช้ · กุญแจ {c.key_hint}</Pill> : c.key_broken ? <Pill tone="c">กุญแจที่เก็บไว้ถอดรหัสไม่ได้ — ใส่ใหม่</Pill> : <Pill tone="c">ยังไม่ได้ใส่กุญแจ</Pill>}
            {c.updated_at && <span className="small muted"> ตั้งเมื่อ <DateText v={c.updated_at.slice(0, 10)} /></span>}</p>
          <Field label={c.has_key ? 'เปลี่ยนกุญแจ (ว่าง = ใช้กุญแจเดิม)' : 'กุญแจ API'} req={!c.has_key} hint="สร้างที่ console.anthropic.com › API Keys (ขึ้นต้นด้วย sk-ant-) · เก็บแบบเข้ารหัส ไม่แสดงกลับ (เห็นเฉพาะ 4 ตัวท้าย) · ลูกค้าไม่เห็นกุญแจนี้">
            <PasswordInput autoComplete="off" value={key} placeholder={c.has_key ? `ใช้อยู่ ${c.key_hint}` : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} style={{ width: '100%' }} aria-label="กุญแจ API ของ WTS" />
          </Field>
          {c.has_key && <div className="toolbar"><button className="danger" disabled={busy} onClick={() => setRemoving(true)}>ลบกุญแจ…</button></div>}
        </fieldset>
        <h3>ลูกค้าที่ WTS จ่ายค่า AI ให้ — เดือนนี้</h3>
        <div className="table-wrap"><table className="grid">
          <thead><tr><th>รหัส</th><th>ชื่อลูกค้า</th><th className="r">ใช้ไป (ดอลลาร์)</th><th className="r">เพดาน/เดือน (ดอลลาร์)</th><th>สถานะ</th></tr></thead>
          <tbody>
            {c.tenants.map((t) => {
              const full = t.ai_limit_usd !== null && d(t.month_cost_usd).gte(t.ai_limit_usd);
              return <tr key={t.id}><td className="mono">{t.code}</td><td>{t.name}</td><td className="r num">{d(t.month_cost_usd).toFixed(2)}</td><td className="r num">{t.ai_limit_usd === null ? 'ไม่จำกัด' : fmt(t.ai_limit_usd)}</td>
                <td>{full ? <Pill tone="c">ครบเพดานแล้ว</Pill> : <Pill tone="m">ใช้ได้</Pill>}</td></tr>;
            })}
            {!c.tenants.length && <tr><td colSpan={5} className="empty">ยังไม่มีลูกค้าที่ WTS จ่ายค่า AI ให้ — ตั้งได้ที่ แก้ไขลูกค้า › ผู้จ่ายค่า AI</td></tr>}
          </tbody>
          {c.tenants.length > 0 && <tfoot><tr><td colSpan={2}>รวม</td><td className="r num"><b>{d(c.month_cost_usd).toFixed(2)}</b></td><td colSpan={2} /></tr></tfoot>}
        </table></div>
      </>}
      {removing && <Confirm title="ลบกุญแจ AI ของ WTS" danger okText="ลบกุญแจ" text="ลูกค้าที่ WTS จ่ายค่า AI ให้จะอ่านบิลด้วย AI ไม่ได้จนกว่าจะใส่กุญแจใหม่ (ป้อนเองได้ตามปกติ) — ลบหรือไม่"
        onOk={() => void save(null)} onClose={() => setRemoving(false)} />}
    </Modal>
  );
}
