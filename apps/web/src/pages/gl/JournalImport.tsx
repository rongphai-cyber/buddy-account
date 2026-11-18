import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useCan } from '../../session';
import { Confirm, DateText, ErrorBox, KeyHints, Money, PageHead, Pill, toast, useHotkeys } from '../../ui';
import { download, readBase64 } from '../tools/TradeImport';

type VRow = { group: string; book: string; row: number; date: string; ref: string | null; description: string | null; lines: number; debit: string; voucher_no: string | null; taxes: number };
type Result = { ok: boolean; committed: boolean; vouchers: VRow[]; errors: Array<{ row: number; message: string }>; file_vouchers: number; total_debit: string };

/**
 * นำเข้าใบสำคัญจาก Excel (เจ้าของ 17/11/2569 ขั้นที่ 1) — สมุดรายวันทุกเล่ม
 * ดาวน์โหลดแบบฟอร์ม → เลือกแฟ้ม (ระบบตรวจทันที ยังไม่บันทึก) → นำเข้า (ลงบัญชีทุกใบพร้อมกัน ผิดใบเดียวไม่บันทึกเลย)
 */
export function JournalImportPage() {
  const can = useCan('GL.JNL');
  const nav = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const run = async (commit: boolean, f = file) => {
    if (!f || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<Result>('/api/v1/gl/journal-import', { file_name: f.name, data: f.data, commit });
      setRes(r);
      if (commit) { toast(`นำเข้าใบสำคัญ ${r.vouchers.length} ใบแล้ว`); qc.invalidateQueries({ queryKey: ['journals'] }); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setRes(null); setErr(null);
    try { const v = { name: f.name, data: await readBase64(f) }; setFile(v); await run(false, v); } catch (e) { setErr(e); }
  };
  const ready = !!res && !res.committed && res.ok && res.vouchers.length > 0;
  const taxCount = (res?.vouchers ?? []).reduce((n, x) => n + (x.taxes ?? 0), 0);
  const showNo = !!res && (res.committed || res.vouchers.some((x) => x.voucher_no));
  const taxNote = taxCount ? ` พร้อมรายการภาษี ${taxCount} รายการ` : '';
  useHotkeys({ F9: can('add') && ready ? () => setAsk(true) : undefined, Escape: () => nav('/gl/journals') }, [ready]);
  return (
    <div className="page" data-tone="gl">
      <PageHead eyebrow="บัญชี › ลงประจำวัน › นำเข้า Excel" title="นำเข้าใบสำคัญจากแฟ้ม Excel"
        lead={<>หนึ่งแถวในแฟ้ม = หนึ่งบรรทัดบัญชี · แถวที่ <b>สมุด</b> และ <b>เลขที่กลุ่ม</b> เดียวกันรวมเป็นใบสำคัญใบเดียว · เลือกแฟ้มแล้วระบบ<b>ตรวจก่อน</b> (ยังไม่บันทึก): ดุลทุกใบ บัญชี แผนก Job มีจริง งวดยังเปิด อ้างอิงไม่ซ้ำ · กดนำเข้าแล้วลงบัญชีทุกใบพร้อมกัน — ผิดใบเดียวไม่บันทึกเลย · <b>เลขที่ใบสำคัญ</b> เว้นว่าง = ระบบออกเลขตามสมุด หรือใส่เองโดยขึ้นต้นด้วยตัวนำหน้าของสมุด (สมุด PV → PV…) · คำอธิบายรายการว่าง = คำอธิบายของใบ · <b>ภาษี</b>: ใส่ในแถวของบัญชีภาษี ระบบเติมแฟ้มภาษีซื้อ/ขาย/ภ.ง.ด.3/53 ให้</>}
        actions={<>
          {can('add') && <button className="primary" disabled={!ready || busy} onClick={() => setAsk(true)}>นำเข้า {ready ? `${res!.vouchers.length} ใบ` : ''} <kbd>F9</kbd></button>}
          <button onClick={() => nav('/gl/journals')}>รายการ <kbd>Esc</kbd></button>
        </>} />
      <div className="card ti-steps">
        <div className="ti-actions">
          <button type="button" onClick={() => download('/api/v1/gl/journal-import/template', 'import-journal.xlsx').then((n) => toast(`ดาวน์โหลด ${n} แล้ว`)).catch(setErr)}>⬇ 1. แบบฟอร์มตัวอย่าง (.xlsx)</button>
          {can('add') && <label className="btn primary-soft">⬆ 2. เลือกแฟ้มที่กรอกแล้ว (.xlsx / .csv)…<input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} /></label>}
          {file && <span className="muted small">แฟ้ม: <b>{file.name}</b></span>}
          {file && !res?.committed && <button type="button" disabled={busy} onClick={() => run(false)}>↻ ตรวจแฟ้มอีกครั้ง</button>}
          {busy && <span className="muted">กำลังตรวจ…</span>}
        </div>
        <p className="hint">คอลัมน์: สมุด · เลขที่กลุ่ม · เลขที่ใบสำคัญ (ว่างได้) · วันที่ · อ้างอิง · คำอธิบาย · เลขที่บัญชี · คำอธิบายรายการ · แผนก · Job · เดบิต · เครดิต (คำอธิบายแต่ละคอลัมน์อยู่ในแผ่น "คำอธิบาย" ของแบบฟอร์ม)</p>
        <p className="hint">ภาษี (ใส่เฉพาะแถวบัญชีภาษี ยอดเงินของแถว = ยอดภาษี): ภาษี (ภาษีซื้อ ภาษีขาย ภงด3 ภงด53) · เลขที่ใบกำกับ · วันที่ใบกำกับ · งวดภาษี · ชื่อคู่ค้า · เลขผู้เสียภาษี · สาขาคู่ค้า · ฐานภาษี · อัตราภาษี · ประเภทเงินได้</p>
      </div>
      <ErrorBox error={err} />
      {res && <>
        <div className="ti-summary">
          {res.committed ? <Pill tone="n">✓ นำเข้าแล้ว {res.vouchers.length} ใบ</Pill> : res.ok ? <Pill tone="n">พร้อมนำเข้า {res.vouchers.length} ใบ</Pill> : <Pill tone="x">ต้องแก้ {res.errors.length} รายการ</Pill>}
          <span>ยอดเดบิตรวม <b><Money v={res.total_debit} /></b> บาท</span>
          {!!taxCount && <span>รายการภาษี <b>{taxCount}</b> รายการ (เติมแฟ้มภาษีซื้อ/ขาย/หัก ณ ที่จ่าย)</span>}
          {!res.committed && !res.ok && <span className="muted small">ผ่านการตรวจ {res.vouchers.length} จาก {res.file_vouchers} ใบ — แก้ในแฟ้มแล้วเลือกแฟ้มใหม่ (ไม่มีอะไรถูกบันทึก)</span>}
        </div>
        {res.errors.length > 0 && <div className="table-wrap ti-errors">
          <table className="grid">
            <thead><tr><th style={{ width: 70 }}>แถวที่</th><th>ต้องแก้</th></tr></thead>
            <tbody>{res.errors.map((e, i) => <tr key={i}><td className="r num">{e.row}</td><td>{e.message}</td></tr>)}</tbody>
          </table>
        </div>}
        {res.vouchers.length > 0 && <div className="table-wrap">
          <table className="grid">
            <thead><tr>
              <th style={{ width: 60 }}>แถว</th><th style={{ width: 80 }}>สมุด</th><th style={{ width: 90 }}>กลุ่ม</th>{showNo && <th style={{ width: 130 }} title="ตรวจแฟ้ม: แสดงเฉพาะเลขที่กำหนดเอง · นำเข้าแล้ว: เลขที่บันทึกจริง">เลขที่ใบสำคัญ</th>}<th style={{ width: 110 }}>วันที่</th>
              <th style={{ width: 120 }}>อ้างอิง</th><th>คำอธิบาย</th><th className="r" style={{ width: 70 }}>บรรทัด</th><th className="r" style={{ width: 80 }} title="จำนวนรายการภาษีซื้อ/ขาย/หัก ณ ที่จ่ายที่จะเติมในแฟ้มภาษี">ภาษี</th><th className="r" style={{ width: 130 }}>ยอดเงิน</th>
            </tr></thead>
            <tbody>{res.vouchers.map((x) => <tr key={`${x.book}|${x.group}`} className={res.committed && x.voucher_no ? 'row-open' : undefined} onClick={res.committed && x.voucher_no ? () => nav(`/gl/journals?q=${encodeURIComponent(x.voucher_no!)}`) : undefined}>
              <td className="r num muted">{x.row}</td><td className="mono">{x.book}</td><td className="mono">{x.group}</td>{showNo && <td className="mono">{res.committed ? <b>{x.voucher_no}</b> : x.voucher_no ?? <span className="muted small">ระบบออกให้</span>}</td>}<td><DateText v={x.date} /></td>
              <td className="mono small">{x.ref}</td><td>{x.description}</td><td className="r num">{x.lines}</td><td className="r num">{x.taxes ? x.taxes : ''}</td><td className="r"><b><Money v={x.debit} /></b></td>
            </tr>)}</tbody>
          </table>
        </div>}
      </>}
      <KeyHints keys={[['F9', 'นำเข้า (เมื่อตรวจผ่าน)'], ['Esc', 'กลับรายการ']]} />
      {ask && res && <Confirm title="นำเข้าใบสำคัญ" okText={`นำเข้า ${res.vouchers.length} ใบ`}
        text={<>บันทึกใบสำคัญ <b>{res.vouchers.length}</b> ใบ ยอดเดบิตรวม <b><Money v={res.total_debit} /></b> บาท และลงบัญชีทันที{taxNote} — ถ้าต้องการแก้ภายหลังให้แก้หรือยกเลิกทีละใบที่หน้าสมุดรายวัน</>}
        onOk={() => { setAsk(false); void run(true); }} onClose={() => setAsk(false)} />}
    </div>
  );
}
