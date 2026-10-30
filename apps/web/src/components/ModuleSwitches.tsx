import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModuleSwitch } from '@buddy/core';
import { api } from '../api';
import { useCan, useSession } from '../session';
import { Confirm, ErrorBox, toast } from '../ui';

/**
 * ระบบที่ใช้งานของบริษัท (ข้อกำหนดเจ้าของ 30/10/2569: ปิดบางระบบไม่ให้เห็น/ใช้)
 * ปิด = ทุกคนในบริษัทไม่เห็นเมนูของระบบนั้น (รวมผู้ดูแล) · ข้อมูลเดิมไม่หาย เปิดกลับได้ทุกเมื่อ
 */
export function ModuleSwitches() {
  const qc = useQueryClient();
  const { refresh } = useSession();
  const edit = useCan('SET.CO')('edit');
  const q = useQuery({ queryKey: ['company-modules'], queryFn: () => api.get<{ off: string[]; modules: ModuleSwitch[] }>('/api/v1/company/modules') });
  const [off, setOff] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [ask, setAsk] = useState<string[] | null>(null);
  useEffect(() => { if (q.data) setOff(q.data.off); }, [q.data]);
  const saved = q.data?.off ?? [];
  const dirty = q.data && (off.length !== saved.length || off.some((k) => !saved.includes(k)));
  const save = async () => {
    setErr(null); setAsk(null);
    try {
      await api.put('/api/v1/company/modules', { off });
      toast(off.length ? `บันทึกแล้ว — ปิด ${off.length} ระบบ เมนูของระบบที่ปิดถูกซ่อน` : 'บันทึกแล้ว — เปิดใช้ทุกระบบ');
      await qc.invalidateQueries({ queryKey: ['company-modules'] }); await refresh();
    } catch (e) { setErr(e); }
  };
  // ปิดระบบเพิ่ม → ถามยืนยัน (เมนูหายจากทุกคนในบริษัท) · เปิดกลับไม่ต้องถาม
  const trySave = () => { const newly = off.filter((k) => !saved.includes(k)); if (newly.length) setAsk(newly); else void save(); };
  const label = (k: string) => q.data?.modules.find((m) => m.key === k)?.label ?? k;
  return (
    <>
      <h2 className="section-title">ระบบที่ใช้งาน</h2>
      <div className="card mod-card">
        <p className="hint">ไม่ติ๊ก = ปิดระบบนั้นทั้งบริษัท: ทุกคน (รวมผู้ดูแล) ไม่เห็นเมนูและใช้ไม่ได้ · <b>ข้อมูลเดิมไม่หาย</b> ยังอยู่ในบัญชีและรายงานงบ เปิดกลับได้ทุกเมื่อ · ระบบบัญชี ภาษี เริ่มระบบ และรายละเอียดสินค้า/บริการ ปิดไม่ได้</p>
        <ErrorBox error={err ?? q.error} />
        <div className="mod-grid">
          {q.data?.modules.map((m) => {
            const on = !off.includes(m.key);
            return <label key={m.key} className={`mod-item${on ? '' : ' off'}`}>
              <input type="checkbox" checked={on} disabled={!edit} onChange={(e) => setOff((x) => (e.target.checked ? x.filter((k) => k !== m.key) : [...x, m.key]))} />
              <span><b>{m.label}</b>{!on && <span className="mod-off"> ปิดอยู่</span>}{m.hint && <span className="muted small"><br />{m.hint}</span>}</span>
            </label>;
          })}
        </div>
        {edit ? <div className="theme-acts">
          <button type="button" className="primary" disabled={!dirty} onClick={trySave}>บันทึกระบบที่ใช้งาน</button>
          {dirty && <button type="button" onClick={() => setOff(saved)}>คืนค่าเดิม</button>}
        </div> : <p className="muted small">เปิด/ปิดระบบได้เฉพาะผู้มีสิทธิ์แก้รายละเอียดกิจการ</p>}
      </div>
      {ask && <Confirm title="ปิดระบบ" okText="ปิดระบบ" danger onOk={save} onClose={() => setAsk(null)}
        text={<>ปิด <b>{ask.map(label).join(', ')}</b> ทั้งบริษัท? เมนูจะหายจากทุกคนในบริษัททันที — ข้อมูลเดิมไม่หาย เปิดกลับได้ที่หน้านี้</>} />}
    </>
  );
}
