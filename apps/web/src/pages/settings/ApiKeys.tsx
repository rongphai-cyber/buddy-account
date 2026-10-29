import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, PageHead, Pill, Tabs, toast, useHotkeys } from '../../ui';

type Key = { id: string; name: string; key_prefix: string; read_only: boolean; expires_on: string | null; status: string; last_used_at: string | null; last_used_ip: string | null; created_at: string; username: string; display_name: string; created_by_name: string | null };
type User = { id: string; username: string; display_name: string; status: string; group_code: string | null; companies: string[] };
type Doc = { method: string; path: string; kind: string; menu: string | null; menu_label: string | null; action: string | null };
const ACT: Record<string, string> = { read: 'อ่าน', add: 'เพิ่ม', edit: 'แก้ไข', cancel: 'ยกเลิก', delete: 'ลบ', print: 'พิมพ์', approve: 'รับรอง' };

/**
 * กุญแจ API ให้ระบบอื่นเชื่อมต่อ (T7.5) — ผูกกับบริษัทนี้ + ผู้ใช้หนึ่งคน สิทธิ์ตามผู้ใช้นั้น
 * กุญแจแสดงครั้งเดียวตอนสร้าง · ยกเลิกแล้วใช้ไม่ได้ทันที · รายการ API สร้างจากตารางสิทธิ์ของโปรแกรม
 */
export function ApiKeysPage() {
  const can = useCan('SET.API');
  const { me } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState('keys');
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get<Key[]>('/api/v1/api-keys') });
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const [revoke, setRevoke] = useState<Key | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useHotkeys({ Insert: can('add') && tab === 'keys' ? () => setAdding(true) : undefined }, [tab]);
  const doRevoke = async () => {
    if (!revoke) return;
    try { await api.post(`/api/v1/api-keys/${revoke.id}/revoke`, {}); toast(`ยกเลิกกุญแจ ${revoke.name} แล้ว`); setRevoke(null); qc.invalidateQueries({ queryKey: ['api-keys'] }); }
    catch (e) { setRevoke(null); setErr(e); }
  };
  return (
    <div className="page" data-tone="settings">
      <PageHead eyebrow="เริ่มระบบ › ความปลอดภัย" title="กุญแจ API (เชื่อมต่อระบบอื่น)"
        lead={<>ให้ระบบอื่น (หน้าร้าน เว็บขายของ โปรแกรมเงินเดือน ฯลฯ) อ่าน/บันทึกข้อมูลของ <b>{me?.company?.name_th}</b> ผ่าน API — กุญแจทำงานในนามผู้ใช้ที่เลือก ด้วยสิทธิ์ของผู้ใช้นั้น</>}
        actions={tab === 'keys' && can('add') && <button className="primary" onClick={() => setAdding(true)}>+ สร้างกุญแจ <kbd>Ins</kbd></button>} />
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'keys', label: 'กุญแจ', badge: keys.data?.filter((k) => k.status === 'A').length || undefined }, { key: 'docs', label: 'รายการ API และตัวอย่าง' }]} />
      <ErrorBox error={err ?? keys.error} />
      {tab === 'keys' ? <>
        <div className="table-wrap">
          <table className="grid">
            <thead><tr><th>ชื่อ</th><th style={{ width: 170 }}>กุญแจ</th><th>ทำงานในนาม</th><th style={{ width: 110 }}>สิทธิ์</th><th style={{ width: 110 }}>หมดอายุ</th><th style={{ width: 170 }}>ใช้ล่าสุด</th><th style={{ width: 90 }}>สถานะ</th><th style={{ width: 90 }} /></tr></thead>
            <tbody>
              {keys.data?.map((k) => (
                <tr key={k.id} className={cx(k.status !== 'A' && 'cancelled')}>
                  <td>{k.name}<div className="muted small">สร้าง <DateText v={k.created_at} /> {k.created_by_name ? `โดย ${k.created_by_name}` : ''}</div></td>
                  <td className="mono">bk_{k.key_prefix}_…</td>
                  <td>{k.username} <span className="muted">{k.display_name}</span></td>
                  <td>{k.read_only ? 'อ่านอย่างเดียว' : 'ตามสิทธิ์ผู้ใช้'}</td>
                  <td>{k.expires_on ? <DateText v={k.expires_on} /> : <span className="muted">ไม่หมดอายุ</span>}</td>
                  <td>{k.last_used_at ? <><DateText v={k.last_used_at} /> <span className="muted small">{new Date(k.last_used_at).toLocaleTimeString('th-TH')} {k.last_used_ip}</span></> : <span className="muted">ยังไม่เคยใช้</span>}</td>
                  <td>{k.status === 'A' ? <Pill tone="n">ใช้งาน</Pill> : <Pill tone="x">ยกเลิก</Pill>}</td>
                  <td>{k.status === 'A' && can('cancel') && <button onClick={() => setRevoke(k)}>ยกเลิก</button>}</td>
                </tr>
              ))}
              {keys.data && !keys.data.length && <tr><td colSpan={8} className="empty">ยังไม่มีกุญแจ — กด Ins เพื่อสร้าง</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="hint">ความปลอดภัย: ส่งกุญแจทางช่องทางที่ปลอดภัยเท่านั้น · ระบบเก็บเฉพาะรหัสตรวจสอบ (ดูกุญแจซ้ำไม่ได้ — หายให้ยกเลิกแล้วสร้างใหม่) · ทุกการสร้าง/ยกเลิก และการบันทึกผ่านกุญแจ อยู่ในแฟ้มบันทึกเหตุการณ์ในนามผู้ใช้ของกุญแจ</p>
        <KeyHints keys={[['Ins', 'สร้างกุญแจ']]} />
      </> : <ApiDocs />}
      {adding && <AddKey onClose={() => setAdding(false)} onDone={(name, key) => { setAdding(false); setShown({ name, key }); qc.invalidateQueries({ queryKey: ['api-keys'] }); }} />}
      {shown && <Modal title={`กุญแจ API: ${shown.name}`} size="confirm" onClose={() => setShown(null)} footer={<><button onClick={() => { void navigator.clipboard?.writeText(shown.key); toast('คัดลอกกุญแจแล้ว'); }}>คัดลอก</button><button className="primary" onClick={() => setShown(null)}>เก็บแล้ว ปิด</button></>}>
        <p><b>คัดลอกเก็บไว้ตอนนี้</b> — ปิดหน้าต่างนี้แล้วจะดูกุญแจเต็มอีกไม่ได้</p>
        <input className="mono" readOnly value={shown.key} onFocus={(e) => e.target.select()} autoFocus style={{ width: '100%' }} aria-label="กุญแจ API" />
        <p className="hint">ระบบปลายทางส่งใน header: <code>Authorization: Bearer {shown.key.slice(0, 18)}…</code></p>
      </Modal>}
      {revoke && <Confirm danger title="ยกเลิกกุญแจ API" text={<>ยกเลิก <b>{revoke.name}</b> (bk_{revoke.key_prefix}_…)? ระบบที่ใช้กุญแจนี้จะเชื่อมต่อไม่ได้ทันที (เปลี่ยนสถานะ ไม่ลบ)</>} okText="ยกเลิกกุญแจ" onOk={doRevoke} onClose={() => setRevoke(null)} />}
    </div>
  );
}

function AddKey({ onClose, onDone }: { onClose: () => void; onDone: (name: string, key: string) => void }) {
  const { me } = useSession();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/api/v1/users') });
  const cid = me?.company?.id;
  const pick = (users.data?.users ?? []).filter((u) => u.status === 'A' && (u.group_code === 'ADMIN' || (cid && u.companies.includes(cid))));
  const [f, setF] = useState({ name: '', user_id: '', read_only: true, expires_on: '' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post<{ key: string }>('/api/v1/api-keys', { name: f.name, user_id: f.user_id || undefined, read_only: f.read_only, expires_on: f.expires_on || null }); onDone(f.name, r.key); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [f]);
  return (
    <Modal title="สร้างกุญแจ API" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" disabled={busy} onClick={save}>สร้างกุญแจ <kbd>F9</kbd></button></>}>
      <ErrorBox error={err ?? users.error} />
      <Field label="ชื่อกุญแจ" req hint="ระบบที่จะใช้ เช่น เว็บขายของ ระบบหน้าร้านสาขา 1"><input autoFocus value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="ทำงานในนามผู้ใช้" req hint="แนะนำสร้างผู้ใช้เฉพาะสำหรับระบบนั้น และให้สิทธิ์เท่าที่จำเป็น (ตั้งค่า › ผู้ใช้งานและสิทธิ์)">
        <select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}><option value="">— เลือกผู้ใช้ —</option>{pick.map((u) => <option key={u.id} value={u.id}>{u.username} {u.display_name}{u.group_code === 'ADMIN' ? ' (ผู้ดูแล — สิทธิ์ทั้งหมด)' : ''}</option>)}</select>
      </Field>
      <label className="check"><input type="checkbox" checked={f.read_only} onChange={(e) => setF({ ...f, read_only: e.target.checked })} /> อ่านอย่างเดียว (ดึงข้อมูล/รายงาน ไม่บันทึกเอกสาร)</label>
      <Field label="หมดอายุ" hint="ว่าง = ไม่หมดอายุ"><DateInput value={f.expires_on} onChange={(v) => setF({ ...f, expires_on: v })} /></Field>
    </Modal>
  );
}

function ApiDocs() {
  const docs = useQuery({ queryKey: ['api-docs'], queryFn: () => api.get<{ rate_limit_per_minute: number; rows: Doc[] }>('/api/v1/api-docs') });
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (docs.data?.rows ?? []).filter((r) => !t || r.path.toLowerCase().includes(t) || (r.menu_label ?? '').toLowerCase().includes(t) || r.method.toLowerCase() === t);
  }, [docs.data, q]);
  const host = window.location.origin;
  return <>
    <div className="box">
      <h3>วิธีเรียกใช้</h3>
      <ul className="small">
        <li>ทุกคำขอส่ง header <code>Authorization: Bearer &lt;กุญแจ&gt;</code> · ข้อมูลเป็น JSON (UTF-8) · <b>เงินส่งเป็นข้อความทศนิยม</b> เช่น <code>"1234.50"</code> · วันที่ <code>YYYY-MM-DD</code> (ค.ศ.)</li>
        <li>ข้อมูลที่เห็น/บันทึกได้ = ของบริษัทที่สร้างกุญแจเท่านั้น ตามสิทธิ์ของผู้ใช้ที่ผูกไว้ · บันทึกเอกสาร = ลงบัญชีทันทีเหมือนบันทึกที่หน้าจอ</li>
        <li>ผิดพลาดตอบ <code>{'{ "error": { "code", "message", "issues" } }'}</code> ข้อความภาษาไทยบอกวิธีแก้ · 401 กุญแจไม่ถูกต้อง/หมดอายุ · 403 ไม่มีสิทธิ์ · 429 เกิน {docs.data?.rate_limit_per_minute ?? 600} ครั้ง/นาที</li>
        <li>ไม่รองรับเรียกจากหน้าเว็บของโดเมนอื่นโดยตรง (ไม่มี CORS) — ให้เรียกจากเซิร์ฟเวอร์/โปรแกรมของระบบนั้น</li>
      </ul>
      <h3>ตัวอย่าง</h3>
      <pre className="small">{`# PowerShell — รายชื่อลูกค้า
$h = @{ Authorization = "Bearer bk_..." }
Invoke-RestMethod "${host}/api/v1/customers?q=" -Headers $h

# curl — งบทดลองปี 2569
curl -H "Authorization: Bearer bk_..." "${host}/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31"

# curl — บันทึกใบสำคัญ (ต้องเป็นกุญแจที่ไม่ใช่อ่านอย่างเดียว)
curl -X POST -H "Authorization: Bearer bk_..." -H "Content-Type: application/json" ${host}/api/v1/gl/journals \\
  -d '{"journal_book_id":"<รหัสสมุด>","voucher_date":"2026-03-01","description":"จากระบบหน้าร้าน",
       "lines":[{"account_id":"<บัญชีเดบิต>","debit":"1070.00"},{"account_id":"<บัญชีเครดิต>","credit":"1070.00"}]}'`}</pre>
      <p className="hint">รูปแบบข้อมูลของแต่ละ API ดูได้จากหน้าจอโปรแกรม (เครื่องมือนักพัฒนาของเบราว์เซอร์ แท็บ Network) — ใช้ข้อมูลชุดเดียวกับหน้าจอทุกประการ</p>
    </div>
    <div className="toolbar"><input type="search" placeholder="ค้นหา path หรือชื่อเมนู เช่น invoices, ลูกค้า, GET" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา API" />
      <span className="muted small">{rows.length} รายการ</span></div>
    <ErrorBox error={docs.error} />
    <div className="table-wrap">
      <table className="grid">
        <thead><tr><th style={{ width: 70 }}>วิธี</th><th>Path</th><th>เมนู (สิทธิ์ที่ต้องมี)</th><th style={{ width: 90 }}>การทำงาน</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={`${r.method} ${r.path}`}><td className="mono">{r.method}</td><td className="mono">{r.path}</td>
          <td>{r.kind === 'lookup' ? <span className="muted">ข้อมูลอ้างอิง — ทุกผู้ใช้ของบริษัท</span> : r.kind === 'self' ? <span className="muted">ข้อมูลผู้ใช้ของกุญแจ</span> : `${r.menu_label} (${r.menu})`}</td>
          <td>{r.action ? ACT[r.action] ?? r.action : ''}</td></tr>)}</tbody>
      </table>
    </div>
  </>;
}
