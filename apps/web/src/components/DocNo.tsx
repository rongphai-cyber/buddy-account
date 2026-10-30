import { useEffect, useState } from 'react';
import { formatDocNo } from '@buddy/core';
import { Field, toast } from '../ui';

/**
 * ช่องเลขที่เอกสาร (ข้อกำหนดเจ้าของ 30/10/2569) — ใช้กับทุกหน้าจอเอกสารที่บันทึก
 * เอกสารใหม่: แสดงตัวนำหน้าตามประเภทเอกสารไว้ให้ คีย์เลขต่อเองได้ · ไม่คีย์ (เหลือแค่ตัวนำหน้า) แล้ว Enter = แจ้งว่าใช้เลขอัตโนมัติ
 * value = เลขที่ส่งให้เซิร์ฟเวอร์ (null = ออกเลขอัตโนมัติตอนบันทึก) · เอกสารที่บันทึกแล้วแสดงเลขเดิม แก้ไม่ได้
 */
export function useDocNo(type: { code: string; next_no?: string | number | null } | undefined, saved: string | null | undefined, opts: { disabled?: boolean; resetKey?: unknown; label?: string } = {}) {
  const [txt, setTxt] = useState('');
  const prefix = type?.code ?? '';
  useEffect(() => setTxt(''), [prefix, opts.resetKey]);
  const typed = txt.trim();
  const auto = !typed || typed.toUpperCase() === prefix.toUpperCase();
  const preview = prefix && type?.next_no != null ? formatDocNo(prefix, String(type.next_no)) : '';
  const field = (
    <Field label={opts.label ?? 'เลขที่เอกสาร'} hint={saved ? undefined : auto ? `เว้นไว้ = เลขอัตโนมัติ ${preview}`.trim() : 'คีย์เลขเอง — ห้ามซ้ำกับเอกสารอื่น'}>
      <input className="mono" value={saved ?? (txt || prefix)} disabled={!!saved || opts.disabled} maxLength={30} aria-label={opts.label ?? 'เลขที่เอกสาร'}
        placeholder={preview} onChange={(e) => setTxt(e.target.value.replace(/\s/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter' && !saved && !opts.disabled && auto) toast(`ไม่ได้คีย์เลขที่เอง — ใช้เลขที่อัตโนมัติ ${preview} (ออกเลขจริงตอนบันทึก)`.replace('  ', ' '), 'warn'); }} />
    </Field>
  );
  return { field, value: saved ? null : auto ? null : typed, reset: () => setTxt('') };
}
