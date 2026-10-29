import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useCan } from '../../session';
import { cx, ErrorBox, GROUP_TH, Modal, Pill, toast, useHotkeys } from '../../ui';

interface TplAccount { no: string; th: string; en: string | null; parent: string | null; level: number; group: string; control: boolean; exists: boolean; same_name: boolean; fits_mask: boolean }
interface Tpl { key: string; label: string; mask: string | null; accounts: TplAccount[]; english_fillable: number }

/**
 * ผังบัญชีตัวอย่าง (ใช้อ้างอิง): เลือกบัญชีที่ยังไม่มีเพิ่มเข้าผังของบริษัท และเติมชื่อภาษาอังกฤษจากชื่อไทยที่ตรงกัน
 * ผังของบริษัทยังเพิ่ม/แก้/เปลี่ยนเลขได้ตามปกติ
 */
export function ChartTemplateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const can = useCan('GL.ACC');
  const list = useQuery({ queryKey: ['chart-templates'], queryFn: () => api.get<Array<{ key: string; label: string }>>('/api/v1/gl/chart-templates') });
  const [key, setKey] = useState('th_en');
  const tpl = useQuery({ queryKey: ['chart-template', key], queryFn: () => api.get<Tpl>(`/api/v1/gl/chart-templates/${key}`), staleTime: 0 });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [q, setQ] = useState('');
  const [fill, setFill] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (tpl.data?.accounts ?? []).filter((a) => (!onlyMissing || !a.exists) && (!s || a.no.includes(s) || a.th.toLowerCase().includes(s) || (a.en ?? '').toLowerCase().includes(s)));
  }, [tpl.data, onlyMissing, q]);
  const toggle = (no: string, on: boolean) => setPick((p) => { const n = new Set(p); if (on) n.add(no); else n.delete(no); return n; });
  const apply = async () => {
    if (busy || !can('add') || (!pick.size && !fill)) return;
    setErr(null); setBusy(true);
    try {
      const r = await api.post<{ added: string[]; filled: number }>(`/api/v1/gl/chart-templates/${key}/apply`, { add: [...pick], fill_english: fill });
      toast(`เพิ่ม ${r.added.length} บัญชี · เติมชื่อภาษาอังกฤษ ${r.filled} บัญชี`);
      qc.invalidateQueries({ queryKey: ['accounts'] }); qc.invalidateQueries({ queryKey: ['chart-template', key] });
      setPick(new Set());
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: apply }, []);
  const missing = tpl.data?.accounts.filter((a) => !a.exists).length ?? 0;
  return (
    <Modal title="ผังบัญชีตัวอย่าง (ใช้อ้างอิง)" size="wide" onClose={onClose}
      footer={<>
        <label className="check" style={{ marginRight: 'auto' }}><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> เติมชื่อภาษาอังกฤษให้บัญชีที่ชื่อไทยตรงกันและยังไม่มีชื่ออังกฤษ ({tpl.data?.english_fillable ?? 0} บัญชี)</label>
        <button onClick={onClose}>ปิด <kbd>Esc</kbd></button>
        <button className="primary" disabled={busy || !can('add') || (!pick.size && !(fill && tpl.data?.english_fillable))} onClick={apply}>เพิ่ม {pick.size} บัญชีที่เลือก{fill ? ' + เติมชื่ออังกฤษ' : ''} <kbd>F9</kbd></button>
      </>}>
      <ErrorBox error={err ?? tpl.error} />
      <div className="toolbar">
        <select value={key} onChange={(e) => { setKey(e.target.value); setPick(new Set()); }} aria-label="ผังตัวอย่าง">{list.data?.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
        <input type="search" placeholder="ค้นหาเลขที่ ชื่อไทย หรือชื่ออังกฤษ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาบัญชีในผังตัวอย่าง" />
        <label><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} style={{ width: 'auto' }} /> เฉพาะที่ยังไม่มีในผังของบริษัท ({missing})</label>
      </div>
      <p className="hint">เลือกบัญชีย่อยที่ต้องการ บัญชีคุมที่ยังไม่มีจะเพิ่มให้อัตโนมัติ · เพิ่มแล้วแก้ชื่อ/เลขที่/บัญชีคุมได้ที่หน้าผังบัญชีตามปกติ{tpl.data?.mask ? ` · รูปแบบเลขบัญชีของบริษัท ${tpl.data.mask}` : ''}</p>
      <div className="table-wrap tall">
        <table className="grid">
          <thead><tr><th style={{ width: 36 }} /><th style={{ width: 100 }}>เลขที่บัญชี</th><th>ชื่อบัญชี (ไทย)</th><th>Account Name (English)</th><th style={{ width: 90 }}>หมวด</th><th style={{ width: 70 }}>ประเภท</th><th style={{ width: 120 }}>ในผังบริษัท</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.no} className={cx(a.control && 'ctl')}>
                <td className="c">{!a.exists && <input type="checkbox" style={{ width: 'auto' }} disabled={!a.fits_mask} checked={pick.has(a.no)} onChange={(e) => toggle(a.no, e.target.checked)} aria-label={`เลือก ${a.no}`} />}</td>
                <td className="mono">{a.no}</td>
                <td style={{ paddingLeft: 8 + (a.level - 1) * 14 }}>{a.control ? <b>{a.th}</b> : a.th}</td>
                <td className="muted">{a.en}</td>
                <td>{GROUP_TH[a.group]}</td><td>{a.control ? 'คุม' : 'ย่อย'}</td>
                <td>{a.exists ? (a.same_name ? <Pill tone="n">มีแล้ว</Pill> : <Pill tone="c">เลขนี้ใช้ชื่ออื่น</Pill>) : !a.fits_mask ? <Pill tone="x">ไม่ตรงรูปแบบ</Pill> : ''}</td>
              </tr>
            ))}
            {tpl.data && !rows.length && <tr><td colSpan={7} className="empty">{onlyMissing ? 'ผังของบริษัทมีบัญชีครบตามผังตัวอย่างแล้ว' : 'ไม่พบ'}</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
