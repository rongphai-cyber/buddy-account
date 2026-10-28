import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addMonths, periodLabel } from '@buddy/core';
import { api, type FiscalYear } from '../../api';
import { useSession } from '../../session';
import { Confirm, cx, DateInput, DateText, ErrorBox, Field, Modal, PageHead, Pill, toast, toastError } from '../../ui';

/** รอบบัญชี (บทที่ 6 S-SET-01) + ล็อคงวด (บทที่ 18 S-ME-02) */
export function PeriodsPage() {
  const qc = useQueryClient();
  const { me } = useSession();
  const ys = me?.company?.year_system ?? 'B';
  const years = useQuery({ queryKey: ['periods'], queryFn: () => api.get<FiscalYear[]>('/api/v1/gl/periods') });
  const [ask, setAsk] = useState<{ id: string; label: string; locked: boolean } | null>(null);
  const [newYear, setNewYear] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const list = (years.data ?? []).filter((y) => showAll || y.journal_count > 0 || y.status === 'O');
  const lock = (id: string, locked: boolean) => api.post<{ changed: number }>(`/api/v1/gl/periods/${id}/lock`, { locked }).then((r) => { toast(`${locked ? 'ปิด' : 'เปิด'}งวดแล้ว ${r.changed} งวด`); qc.invalidateQueries({ queryKey: ['periods'] }); }).catch(toastError);
  const last = years.data?.at(-1);
  return (
    <div className="page" data-tone="setup">
      <PageHead eyebrow="เริ่มระบบ › รอบบัญชี" title="รอบบัญชีและการปิดงวด" lead="ปิดงวดแล้วจะบันทึกหรือแก้ไขเอกสารที่ลงวันที่ในงวดนั้นไม่ได้ (Message# 1021) — ปิดงวดใดจะปิดงวดก่อนหน้าทั้งหมดด้วย"
        actions={<><label className="inline chk"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> แสดงปีที่ไม่มีรายการ</label><button className="primary" onClick={() => setNewYear(true)}>+ เพิ่มปีบัญชี</button></>} />
      <ErrorBox error={years.error} />
      {list.map((y) => (
        <section key={y.id} className="card">
          <div className="row"><h2>ปีบัญชี {y.code}</h2><span className="muted"><DateText v={y.start_date} /> – <DateText v={y.end_date} /> · {Number(y.journal_count).toLocaleString()} ใบสำคัญ</span>{y.status === 'C' && <Pill tone="x">ประมวลผลสิ้นปีแล้ว</Pill>}</div>
          <div className="periods">
            {y.periods.map((p) => (
              <button key={p.id} className={cx('period-cell', p.is_locked && 'locked')} onClick={() => setAsk({ id: p.id, label: `งวดที่ ${p.period_no} ${periodLabel(p.start_date, ys)}`, locked: !p.is_locked })}
                title={p.is_locked ? `ปิดโดย ${p.locked_by_name ?? ''} — คลิกเพื่อเปิดงวด` : 'คลิกเพื่อปิดงวดถึงงวดนี้'}>
                <b>{p.period_no}</b><span>{periodLabel(p.start_date, ys)}</span><span className="small">{p.is_locked ? '🔒 ปิดแล้ว' : 'เปิด'}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {ask && <Confirm title={ask.locked ? 'ปิดงวด' : 'เปิดงวด'} text={ask.locked ? `ปิดงวดถึง ${ask.label} (รวมงวดก่อนหน้าที่ยังเปิด)?` : `เปิด ${ask.label} และงวดหลังจากนั้นที่ปิดอยู่?`} onClose={() => setAsk(null)} onOk={() => { lock(ask.id, ask.locked); setAsk(null); }} />}
      {newYear && <NewYear suggested={last ? addMonths(last.start_date, 12) : (me?.work_date ?? '').slice(0, 4) + '-01-01'} onClose={() => setNewYear(false)} onDone={() => { setNewYear(false); qc.invalidateQueries({ queryKey: ['periods'] }); }} />}
    </div>
  );
}

function NewYear({ suggested, onClose, onDone }: { suggested: string; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(suggested);
  const [err, setErr] = useState<unknown>(null);
  return (
    <Modal title="เพิ่มปีบัญชี" size="confirm" onClose={onClose} footer={<><button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={() => api.post('/api/v1/gl/periods/years', { start_date: v }).then(() => { toast('เพิ่มปีบัญชีแล้ว 12 งวด'); onDone(); }).catch(setErr)}>ตกลง</button></>}>
      <ErrorBox error={err} />
      <Field label="วันที่เริ่มรอบบัญชี" hint="วันเริ่มรอบบัญชีที่ยื่นภาษี (ไม่ใช่วันเริ่มใช้โปรแกรม) — ระบบสร้างงวดรายเดือน 12 งวด"><DateInput value={v} onChange={setV} autoFocus /></Field>
    </Modal>
  );
}
