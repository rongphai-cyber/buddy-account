import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { periodLabel } from '@buddy/core';
import { api, type FiscalYear } from '../api';
import { useSession } from '../session';

export function useYears() {
  return useQuery({ queryKey: ['periods'], queryFn: () => api.get<FiscalYear[]>('/api/v1/gl/periods') });
}

/** ปีบัญชีที่ควรเปิดเป็นค่าเริ่มต้น: ปีของวันทำการ ถ้าไม่มีรายการใช้ปีล่าสุดที่มีรายการ */
export function defaultYear(years: FiscalYear[] | undefined, workDate?: string | null) {
  if (!years?.length) return undefined;
  const wd = workDate ?? new Date().toISOString().slice(0, 10);
  const cur = years.find((y) => y.start_date <= wd && y.end_date >= wd && y.journal_count > 0);
  return cur ?? years.filter((y) => y.journal_count > 0).at(-1) ?? years.at(-1);
}

/** เลือกปีบัญชี + งวดเริ่ม–สิ้นสุด (แบบหน้าจอเลือกขอบเขตรายงานของ Express S-RP-01) */
export function PeriodRange({ value, onChange, single }: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void; single?: boolean }) {
  const years = useYears();
  const { me } = useSession();
  const ys = me?.company?.year_system ?? 'B';
  const year = years.data?.find((y) => y.start_date <= value.to && y.end_date >= value.to) ?? defaultYear(years.data, me?.work_date);
  useEffect(() => {
    if (!value.from && year) onChange({ from: year.start_date, to: year.end_date });
  }, [year, value.from, onChange]);
  if (!years.data) return null;
  const visible = years.data.filter((y) => y.journal_count > 0 || y.status === 'O');
  return (
    <span className="inline period-range">
      ปี
      <select value={year?.id ?? ''} onChange={(e) => { const y = years.data!.find((x) => x.id === e.target.value)!; onChange({ from: single ? y.start_date : y.start_date, to: y.end_date }); }}>
        {visible.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
      </select>
      {!single && <>
        งวด
        <select value={value.from} onChange={(e) => onChange({ from: e.target.value, to: value.to < e.target.value ? e.target.value : value.to })}>
          {year?.periods.map((p) => <option key={p.id} value={p.start_date}>{p.period_no}. {periodLabel(p.start_date, ys)}</option>)}
        </select>
        ถึง
      </>}
      <select value={value.to} onChange={(e) => onChange({ from: value.from > e.target.value ? (year?.periods.find((p) => p.end_date === e.target.value)?.start_date ?? value.from) : value.from, to: e.target.value })}>
        {year?.periods.map((p) => <option key={p.id} value={p.end_date}>{single ? 'สิ้นงวด ' : ''}{p.period_no}. {periodLabel(p.start_date, ys)}</option>)}
      </select>
    </span>
  );
}
