import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useCan } from '../../session';
import { cx, ErrorBox, KeyHints, navKey, PageHead, toast, useHotkeys } from '../../ui';

interface TableInfo { code: string; label: string; rate: boolean; hint: string | null; count: number }
interface Row { id?: string; code: string; short_th: string | null; short_en: string | null; name_th: string; name_en: string | null; rate: string | null; status: string; used?: number }

/** ตารางข้อมูล — คู่มือบทที่ 6 S-TBL-00 (รายการตาราง) / S-TBL-01 (ตารางแก้ไขรูปแบบเดียวกันทุกตาราง) */
export function DataTablesPage() {
  const can = useCan('SET.TBL');
  const qc = useQueryClient();
  const tables = useQuery({ queryKey: ['data-tables'], queryFn: () => api.get<TableInfo[]>('/api/v1/data-tables') });
  const [code, setCode] = useState('20');
  const t = tables.data?.find((x) => x.code === code);
  const cur = useQuery({ queryKey: ['data-table', code], queryFn: () => api.get<Row[]>(`/api/v1/data-tables/${code}`), staleTime: 0 });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [stamp, setStamp] = useState('');
  if (cur.data && stamp !== code + cur.dataUpdatedAt) { setStamp(code + cur.dataUpdatedAt); setRows(cur.data.map((r) => ({ ...r, rate: r.rate === null ? null : String(Number(r.rate)) }))); }
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = !!rows && !!cur.data && JSON.stringify(rows.map(({ used: _u, ...r }) => r)) !== JSON.stringify(cur.data.map(({ used: _u, ...r }) => ({ ...r, rate: r.rate === null ? null : String(Number(r.rate)) })));
  const pick = (c: string) => { if (c === code) return; if (dirty && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก — ทิ้งการแก้ไข?')) return; setCode(c); setRows(null); setStamp(''); setErr(null); };
  const save = async () => {
    if (!rows || busy || !can('edit')) return;
    setErr(null); setBusy(true);
    try {
      await api.put(`/api/v1/data-tables/${code}`, { rows: rows.map(({ used: _u, ...r }) => r) });
      toast(`บันทึกตาราง ${code} ${t?.label ?? ''} แล้ว`);
      qc.invalidateQueries({ queryKey: ['data-table', code] }); qc.invalidateQueries({ queryKey: ['data-tables'] }); qc.invalidateQueries({ queryKey: ['lookups'] });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save, Insert: () => rows && setRows([...rows, { code: '', short_th: null, short_en: null, name_th: '', name_en: null, rate: t?.rate ? '1' : null, status: 'A' }]) }, []);
  const set = (i: number, p: Partial<Row>) => setRows((rs) => rs!.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › ตารางข้อมูล" title="ตารางข้อมูล"
        lead="รหัสที่ใช้อ้างอิงในหน้าจออื่น ๆ — เพิ่ม แก้ไข ลบได้ตลอดเวลา แต่รหัสที่ถูกนำไปใช้ในการเดินรายการแล้ว ห้ามลบหรือแก้รหัส (แก้ชื่อได้) · แผนกกำหนดที่ เริ่มระบบ › แผนก · สมุดรายวันที่ บัญชี › สร้างสมุดรายวัน"
        actions={can('edit') && <button className="primary" disabled={busy || !dirty} onClick={save}>บันทึก <kbd>F9</kbd></button>} />
      <div className="tbl-layout">
        <nav className="settings-nav tbl-nav" aria-label="รายการตาราง">
          {tables.data?.map((x) => <button key={x.code} className={cx(x.code === code && 'on')} onClick={() => pick(x.code)}><span className="mono">{x.code}</span> {x.label} <span className="muted small">{x.count || ''}</span></button>)}
          <Link className="muted small" to="/settings/departments">50 แผนก ›</Link>
          <Link className="muted small" to="/gl/books">10 สมุดรายวัน ›</Link>
        </nav>
        <div>
          <h2 className="tbl-title"><span className="mono">{code}</span> {t?.label}</h2>
          {t?.hint && <p className="hint">{t.hint}</p>}
          <ErrorBox error={err ?? cur.error} />
          {rows && <div className="table-wrap lines" onKeyDown={navKey}>
            <table className="grid">
              <thead><tr><th style={{ width: 110 }}>รหัส</th><th style={{ width: 130 }}>ชื่อย่อไทย</th><th style={{ width: 130 }}>ชื่อย่อ Eng</th><th>ชื่อเต็มไทย</th><th>ชื่อเต็ม Eng</th>{t?.rate && <th className="r" style={{ width: 90 }}>อัตรา</th>}<th style={{ width: 100 }}>สถานะ</th><th className="r" style={{ width: 70 }}>ใช้แล้ว</th><th style={{ width: 36 }} /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id ?? `n${i}`}>
                    <td><input className="mono" value={r.code} maxLength={10} readOnly={!!r.used} title={r.used ? 'รหัสนี้ถูกนำไปใช้แล้ว แก้รหัสไม่ได้' : undefined} onChange={(e) => set(i, { code: e.target.value })} aria-label="รหัส" /></td>
                    <td><input value={r.short_th ?? ''} maxLength={30} onChange={(e) => set(i, { short_th: e.target.value })} aria-label="ชื่อย่อไทย" /></td>
                    <td><input value={r.short_en ?? ''} maxLength={30} onChange={(e) => set(i, { short_en: e.target.value })} aria-label="ชื่อย่ออังกฤษ" /></td>
                    <td><input value={r.name_th} maxLength={120} onChange={(e) => set(i, { name_th: e.target.value })} aria-label="ชื่อเต็มไทย" /></td>
                    <td><input value={r.name_en ?? ''} maxLength={120} onChange={(e) => set(i, { name_en: e.target.value })} aria-label="ชื่อเต็มอังกฤษ" /></td>
                    {t?.rate && <td><input className="r" inputMode="decimal" value={r.rate ?? ''} onChange={(e) => set(i, { rate: e.target.value.replace(/[^\d.]/g, '') })} aria-label="อัตรา" /></td>}
                    <td><select value={r.status} onChange={(e) => set(i, { status: e.target.value })} aria-label="สถานะ"><option value="A">ใช้งาน</option><option value="I">เลิกใช้</option></select></td>
                    <td className="r muted">{r.used ? Number(r.used).toLocaleString() : ''}</td>
                    <td>{!r.used && <button type="button" className="icon-btn" tabIndex={-1} title="ลบบรรทัด" onClick={() => setRows(rows.filter((_, k) => k !== i))}>✕</button>}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={9} className="empty">ยังไม่มีข้อมูล — กด Ins เพื่อเพิ่ม</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan={9}><button type="button" onClick={() => setRows([...rows, { code: '', short_th: null, short_en: null, name_th: '', name_en: null, rate: t?.rate ? '1' : null, status: 'A' }])}>+ เพิ่มรายการ <kbd>Ins</kbd></button> <span className="hint">รหัสใช้ตัวอักษร/ตัวเลขสื่อความหมาย เช่น กล = กล่อง</span></td></tr></tfoot>
            </table>
          </div>}
        </div>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มรายการ'], ['Enter', 'ช่องถัดไป'], ['F9', 'บันทึก']]} />
    </div>
  );
}
