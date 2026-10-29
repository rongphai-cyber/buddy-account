import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, type YearSystem } from '@buddy/core';
import { api } from '../../api';
import { useCan, useSession } from '../../session';
import { LkSelect, SearchPick, useLookups } from '../../components/LkSelect';
import { Confirm, DateInput, DateText, ErrorBox, Field, KeyHints, Modal, PageHead, toast, useHotkeys } from '../../ui';

/** ทะเบียนหมายเลขสินค้า (คู่มือ S-IC-12) + บัตรรับประกัน (S-IC-13) + รายงานประวัติการให้บริการ (S-IC-14) */
interface Svc { service_date: string; service_by: string | null; detail: string | null }
interface Sn { id: string; serial_no: string; machine_no: string | null; ref_code: string | null; item_id: string | null; item_code: string | null; item_name: string | null; category_code: string | null; description: string | null;
  sale_date: string | null; warranty_end: string | null; customer_id: string | null; customer_code: string | null; customer_name: string | null; address_1: string | null; address_2: string | null; address_3: string | null; zip_code: string | null;
  salesperson_id: string | null; salesperson_code: string | null; salesperson_name: string | null; print_count: number; services: Svc[] }

export function SerialsPage() {
  const can = useCan('IC.SERIAL');
  const { me } = useSession();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const [report, setReport] = useState(false);
  const list = useQuery({ queryKey: ['serials', q], queryFn: () => api.get<{ rows: Sn[] }>('/api/v1/serials', { q, with_services: 'Y', limit: 2000 }), placeholderData: (p) => p });
  const printReport = () => { setReport(true); setTimeout(() => { window.print(); setReport(false); }, 100); };
  useHotkeys({ Insert: can('add') && !open ? () => setOpen('new') : undefined, 'Ctrl+P': !open ? printReport : undefined }, []);
  const ys: YearSystem = me?.company?.year_system ?? 'B';
  return (
    <div className="page" data-tone="inventory">
      <PageHead eyebrow="สินค้า" title="ทะเบียนหมายเลขสินค้า" lead="หมายเลขเครื่อง (Serial No.) ที่ขายไป วันหมดประกัน และประวัติการซ่อม/บำรุง/เปลี่ยนอะไหล่ · พิมพ์บัตรรับประกันได้จากหน้ารายละเอียด · ไม่กระทบสต๊อกและบัญชี"
        actions={<>{can('add') && <button className="primary" onClick={() => setOpen('new')}>+ เพิ่มหมายเลข <kbd>Ins</kbd></button>}<button onClick={printReport} disabled={!list.data?.rows.length}>🖨 รายงานประวัติการให้บริการ <kbd>Ctrl+P</kbd></button></>} />
      <div className="toolbar"><input type="search" autoFocus placeholder="ค้นหาหมายเลขสินค้า หมายเลขเครื่อง รหัสอ้างอิง รายละเอียด หรือลูกค้า" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" /></div>
      <ErrorBox error={list.error} />
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th style={{ width: 160 }}>หมายเลขสินค้า</th><th style={{ width: 140 }}>หมายเลขเครื่อง</th><th style={{ width: 150 }}>รหัสอ้างอิง</th><th>รายละเอียด</th><th style={{ width: 110 }}>วันที่ขาย</th><th style={{ width: 120 }}>หมดประกัน</th><th style={{ width: 200 }}>ลูกค้า</th><th className="r" style={{ width: 70 }}>บริการ</th></tr></thead>
          <tbody>
            {list.data?.rows.map((r) => {
              const expired = r.warranty_end && r.warranty_end.slice(0, 10) < (me?.work_date ?? '');
              return (
                <tr key={r.id} className="row-open" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r.id)}>
                  <td className="mono">{r.serial_no}</td><td className="mono">{r.machine_no}</td><td>{r.ref_code}</td><td>{r.description ?? r.item_name}</td><td><DateText v={r.sale_date} /></td>
                  <td className={expired ? 'bad' : undefined}><DateText v={r.warranty_end} />{expired ? ' (หมดแล้ว)' : ''}</td><td>{r.customer_name}</td><td className="r">{r.services.length || ''}</td>
                </tr>
              );
            })}
            {list.data && !list.data.rows.length && <tr><td colSpan={8} className="empty">ยังไม่มีหมายเลขสินค้าในทะเบียน — กด Ins เพื่อเพิ่ม</td></tr>}
          </tbody>
        </table>
      </div>
      <KeyHints keys={[['Ins', 'เพิ่มหมายเลข'], ['คลิก/Enter', 'เปิดรายละเอียด'], ['Ctrl+P', 'รายงานประวัติบริการ']]} />
      {open && <SerialForm id={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
      {report && list.data && createPortal(<div className="vat-print">
        <h2>ทะเบียนสินค้า เรียงตามหมายเลขสินค้า</h2><p style={{ textAlign: 'center' }}>{me?.company?.name_th}</p>
        <table><thead><tr><th>หมายเลขสินค้า</th><th>หมายเลขเครื่อง</th><th>รหัสอ้างอิง</th><th>หมวด</th><th>รายละเอียด</th><th>วันที่ขาย</th><th>หมดประกัน</th><th>รหัสลูกค้า</th></tr></thead>
          <tbody>{list.data.rows.flatMap((r) => [<tr key={r.id}><td>{r.serial_no}</td><td>{r.machine_no}</td><td>{r.ref_code}</td><td>{r.category_code}</td><td>{r.description ?? r.item_name}</td><td>{formatDate(r.sale_date, ys)}</td><td>{formatDate(r.warranty_end, ys)}</td><td>{r.customer_code}</td></tr>,
            ...r.services.map((s, i) => <tr key={r.id + i}><td /><td colSpan={2}>{formatDate(s.service_date, ys)}</td><td colSpan={2}>{s.service_by}</td><td colSpan={3}>{s.detail}</td></tr>)])}</tbody></table>
      </div>, document.body)}
    </div>
  );
}

type Form = { serial_no: string; machine_no: string; ref_code: string; item: { id: string; code: string; name?: string | null } | null; category_code: string; description: string; sale_date: string; warranty_end: string;
  customer: { id: string; code: string; name?: string | null } | null; customer_name: string; salesperson_id: string; services: Svc[] };
function SerialForm({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useCan('IC.SERIAL');
  const { me } = useSession();
  const lk = useLookups('22');
  const slm = useQuery({ queryKey: ['salespersons', 'A'], queryFn: () => api.get<Array<{ id: string; code: string; name: string }>>('/api/v1/salespersons', { status: 'A' }) });
  const cur = useQuery({ enabled: !!id, queryKey: ['serials', 'one', id], staleTime: 0, queryFn: () => api.get<Sn>(`/api/v1/serials/${id}`) });
  const [f, setF] = useState<Form | null>(id ? null : { serial_no: '', machine_no: '', ref_code: '', item: null, category_code: '', description: '', sale_date: '', warranty_end: '', customer: null, customer_name: '', salesperson_id: '', services: [] });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [card, setCard] = useState(false);
  if (!f && cur.data) {
    const c = cur.data;
    setF({ serial_no: c.serial_no, machine_no: c.machine_no ?? '', ref_code: c.ref_code ?? '', item: c.item_id ? { id: c.item_id, code: c.item_code ?? '', name: c.item_name } : null, category_code: c.category_code ?? '', description: c.description ?? '',
      sale_date: c.sale_date ? String(c.sale_date).slice(0, 10) : '', warranty_end: c.warranty_end ? String(c.warranty_end).slice(0, 10) : '', customer: c.customer_id ? { id: c.customer_id, code: c.customer_code ?? '', name: c.customer_name } : null,
      customer_name: c.customer_id ? '' : c.customer_name ?? '', salesperson_id: c.salesperson_id ?? '', services: c.services.map((s) => ({ ...s, service_date: String(s.service_date).slice(0, 10) })) });
  }
  const ro = !!id ? !can('edit') : !can('add');
  const set = (p: Partial<Form>) => setF((x) => ({ ...x!, ...p }));
  const save = async () => {
    if (!f || busy || ro) return;
    setBusy(true); setErr(null);
    const body = { serial_no: f.serial_no, machine_no: f.machine_no || null, ref_code: f.ref_code || null, item_id: f.item?.id ?? null, category_code: f.category_code || null, description: f.description || null, sale_date: f.sale_date || null,
      warranty_end: f.warranty_end || null, customer_id: f.customer?.id ?? null, customer_name: f.customer ? null : f.customer_name || null, salesperson_id: f.salesperson_id || null, services: f.services.filter((s) => s.service_date || s.detail) };
    try {
      if (id) await api.put(`/api/v1/serials/${id}`, body); else await api.post('/api/v1/serials', body);
      toast(`บันทึกหมายเลข ${f.serial_no} แล้ว`); qc.invalidateQueries({ queryKey: ['serials'] }); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const remove = async () => { try { await api.del(`/api/v1/serials/${id}`); toast('ลบหมายเลขแล้ว'); qc.invalidateQueries({ queryKey: ['serials'] }); onClose(); } catch (e) { setDel(false); setErr(e); } };
  const printCard = async () => { setCard(true); try { await api.post(`/api/v1/serials/${id}/printed`, {}); } catch { /* นับครั้งไม่สำเร็จไม่ขวางการพิมพ์ */ } setTimeout(() => { window.print(); setCard(false); qc.invalidateQueries({ queryKey: ['serials'] }); }, 100); };
  useHotkeys({ F9: save, 'Ctrl+S': save }, []);
  const c = cur.data;
  const ys: YearSystem = me?.company?.year_system ?? 'B';
  return (
    <Modal title={id ? `หมายเลขสินค้า ${c?.serial_no ?? ''}` : 'เพิ่มหมายเลขสินค้า'} size="wide" onClose={onClose} footer={<>
      {!ro && <button className="primary" disabled={busy} onClick={save}>บันทึก <kbd>F9</kbd></button>}
      {id && can('print') && <button onClick={printCard} title="พิมพ์ได้หลังบันทึกข้อมูลครบแล้ว">🖨 พิมพ์บัตรรับประกัน{c?.print_count ? ` (พิมพ์แล้ว ${c.print_count} ครั้ง)` : ''}</button>}
      {id && can('delete') && <button onClick={() => setDel(true)}>ลบ</button>}
      <button onClick={onClose}>ปิด <kbd>Esc</kbd></button></>}>
      <ErrorBox error={err ?? cur.error} />
      {f && <>
        <div className="form-grid">
          <Field label="หมายเลขสินค้า (Serial No.)" req><input className="mono" value={f.serial_no} maxLength={40} disabled={ro} autoFocus onChange={(e) => set({ serial_no: e.target.value })} /></Field>
          <Field label="หมายเลขเครื่อง" hint="อ้างอิงเครื่องหลัก เช่น Pentium III 600"><input className="mono" value={f.machine_no} maxLength={40} disabled={ro} onChange={(e) => set({ machine_no: e.target.value })} /></Field>
          <Field label="รหัสอ้างอิง" hint="รหัสสื่อความหมาย เช่น CDROM ASUS 48X"><input value={f.ref_code} maxLength={30} disabled={ro} onChange={(e) => set({ ref_code: e.target.value })} /></Field>
          <Field label="รหัสสินค้า"><SearchPick<{ id: string; code: string; name_th: string }> endpoint="/api/v1/item-search" params={{ module: 'AR' }} value={f.item} disabled={ro} label={(r: { name_th: string }) => r.name_th}
            onPick={(r: { id: string; code: string; name_th: string } | null) => set({ item: r ? { id: r.id, code: r.code, name: r.name_th } : null, description: f.description || r?.name_th || '' })} /></Field>
          <Field label="หมวดสินค้า"><LkSelect rows={lk.data?.['22']} value={f.category_code} disabled={ro} onChange={(v) => set({ category_code: v })} aria-label="หมวดสินค้า" /></Field>
          <Field label="รายละเอียด"><input value={f.description} maxLength={200} disabled={ro} onChange={(e) => set({ description: e.target.value })} /></Field>
          <Field label="วันที่ขาย"><DateInput value={f.sale_date} disabled={ro} onChange={(v) => set({ sale_date: v })} /></Field>
          <Field label="วันที่หมดประกัน"><DateInput value={f.warranty_end} disabled={ro} onChange={(v) => set({ warranty_end: v })} /></Field>
          <Field label="รหัสลูกค้า"><SearchPick<{ id: string; code: string; name: string }> endpoint="/api/v1/customers" value={f.customer} disabled={ro} label={(r: { name: string }) => r.name} onPick={(r: { id: string; code: string; name: string } | null) => set({ customer: r ? { id: r.id, code: r.code, name: r.name } : null })} /></Field>
          {!f.customer && <Field label="ชื่อลูกค้า" hint="กรณีไม่มีรหัสลูกค้า"><input value={f.customer_name} maxLength={200} disabled={ro} onChange={(e) => set({ customer_name: e.target.value })} /></Field>}
          <Field label="ผู้ขาย"><select value={f.salesperson_id} disabled={ro} onChange={(e) => set({ salesperson_id: e.target.value })}><option value="">—</option>{slm.data?.map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field>
        </div>
        <p className="hint" style={{ marginTop: 12 }}>ประวัติการให้บริการ (ซ่อม/บำรุง/เปลี่ยนอะไหล่)</p>
        <table className="grid lines">
          <thead><tr><th style={{ width: 150 }}>วันที่</th><th style={{ width: 200 }}>ผู้บริการ</th><th>รายการ</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {f.services.map((s, i) => <tr key={i}>
              <td><DateInput value={s.service_date} disabled={ro} onChange={(v) => set({ services: f.services.map((x, j) => (j === i ? { ...x, service_date: v } : x)) })} /></td>
              <td><input value={s.service_by ?? ''} maxLength={60} disabled={ro} onChange={(e) => set({ services: f.services.map((x, j) => (j === i ? { ...x, service_by: e.target.value } : x)) })} aria-label="ผู้บริการ" /></td>
              <td><input value={s.detail ?? ''} maxLength={2000} disabled={ro} onChange={(e) => set({ services: f.services.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })} aria-label="รายการบริการ" /></td>
              <td>{!ro && <button className="icon" title="ลบบรรทัด" onClick={() => set({ services: f.services.filter((_, j) => j !== i) })}>✕</button>}</td>
            </tr>)}
            {!f.services.length && <tr><td colSpan={4} className="empty">ยังไม่มีประวัติบริการ</td></tr>}
          </tbody>
        </table>
        {!ro && <button style={{ marginTop: 8 }} onClick={() => set({ services: [...f.services, { service_date: me?.work_date ?? '', service_by: '', detail: '' }] })}>+ เพิ่มประวัติบริการ</button>}
      </>}
      {del && <Confirm danger title="ลบหมายเลขสินค้า" text={<>ลบ <b>{c?.serial_no}</b> ออกจากทะเบียน?</>} okText="ลบ" onClose={() => setDel(false)} onOk={remove} />}
      {card && c && createPortal(<div className="vat-print">
        <h2>{me?.company?.name_th}</h2><h2>บัตรรับประกัน</h2>
        <table><tbody>
          <tr><th>หมายเลขสินค้า</th><td>{c.serial_no}</td><th>หมายเลขเครื่อง</th><td>{c.machine_no}</td></tr>
          <tr><th>รหัสอ้างอิง</th><td>{c.ref_code}</td><th>หมวดสินค้า</th><td>{c.category_code}</td></tr>
          <tr><th>วันที่ขาย</th><td>{formatDate(c.sale_date, ys)}</td><th>วันที่หมดประกัน</th><td>{formatDate(c.warranty_end, ys)}</td></tr>
          <tr><th>รหัสลูกค้า</th><td>{c.customer_code}</td><th>ชื่อลูกค้า</th><td>{c.customer_name}</td></tr>
          <tr><th>ที่อยู่</th><td colSpan={3}>{[c.address_1, c.address_2, c.address_3, c.zip_code].filter(Boolean).join(' ')}</td></tr>
          <tr><th>รายละเอียด</th><td colSpan={3}>{c.description ?? c.item_name}</td></tr>
          <tr><th>ผู้ขาย</th><td colSpan={3}>{c.salesperson_name}</td></tr>
        </tbody></table>
      </div>, document.body)}
    </Modal>
  );
}
