import { useEffect, useRef, useState } from 'react';
import { fiscalYearLabel, fiscalYearOf, todayIso, workRange } from '@buddy/core';
import { useSession } from './session';

/**
 * ปีบัญชีที่กำลังทำงาน (HANDOFF 174): ปีบัญชีที่มีวันทำการอยู่ — ใช้ร่วมทุกหน้ารายการ/รายงานที่มีช่วงวันที่ (docs/18)
 * from/to = ต้นปีบัญชี–สิ้นปีบัญชี · label = "2568" ตามรหัสปีบัญชีของบริษัท
 */
export function useWorkYear() {
  const { me } = useSession();
  const wd = me?.work_date ?? todayIso();
  const years = me?.fiscal_years ?? [];
  const y = fiscalYearOf(wd, years);
  const r = workRange(wd, years);
  return { workDate: wd, from: r.from, to: r.to, year: y, label: y ? fiscalYearLabel(y, me?.company?.year_system ?? 'B') : null };
}

/**
 * ช่วงวันที่ของหน้ารายการ: ค่าเริ่มต้น = ปีบัญชีที่ทำงาน · ผู้ใช้แก้ช่วงในหน้านั้นได้ · เปลี่ยนปีที่ทำงาน (วันทำการ) แล้วช่วงตามปีใหม่
 * init = ค่าจาก URL (?from=&to=) ถ้ามี
 */
export function useWorkRangeState(init?: { from?: string | null; to?: string | null }) {
  const w = useWorkYear();
  const [from, setFrom] = useState(init?.from || w.from);
  const [to, setTo] = useState(init?.to || w.to);
  const key = `${w.from}|${w.to}`, prev = useRef(key);
  useEffect(() => { if (prev.current !== key) { prev.current = key; setFrom(w.from); setTo(w.to); } }, [key, w.from, w.to]);
  return { from, setFrom, to, setTo, work: w };
}
