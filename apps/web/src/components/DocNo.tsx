import { useEffect, useState } from 'react';
import { formatDocNo } from '@buddy/core';
import { Field, toast } from '../ui';

/**
 * ช่องเลขที่เอกสาร (ข้อกำหนดเจ้าของ 30/10/2569) — ใช้กับทุกหน้าจอเอกสารที่บันทึก
 * เอกสารใหม่: แสดงตัวนำหน้าตามประเภทเอกสารไว้ให้ คีย์เลขต่อเองได้ · ไม่คีย์แล้ว Enter/คลิกผ่าน = ช่องแสดงเลขอัตโนมัติที่จะได้ + กล่องแจ้งติดช่อง
 * value = เลขที่ส่งให้เซิร์ฟเวอร์ (null = ออกเลขอัตโนมัติตอนบันทึก) · เอกสารที่บันทึกแล้วแสดงเลขเดิม แก้ไม่ได้
 */
export function useDocNo(type: { code: string; next_no?: string | number | null } | undefined, saved: string | null | undefined, opts: { disabled?: boolean; resetKey?: unknown; label?: string } = {}) {
  const [txt, setTxt] = useState('');
  /** ผ่านช่องไปโดยไม่คีย์ → แสดงเลขอัตโนมัติในช่อง */
  const [shown, setShown] = useState(false);
  const prefix = type?.code ?? '';
  useEffect(() => { setTxt(''); setShown(false); }, [prefix, opts.resetKey]);
  const typed = txt.trim();
  const auto = !typed || typed.toUpperCase() === prefix.toUpperCase();
  const preview = prefix && type?.next_no != null ? formatDocNo(prefix, String(type.next_no)) : '';
  const field = (
    <Field label={opts.label ?? 'เลขที่เอกสาร'} hint={saved ? undefined : auto ? `เว้นไว้ = เลขอัตโนมัติ ${preview}`.trim() : 'คีย์เลขเอง — ห้ามซ้ำกับเอกสารอื่น'}>
      <input className={'mono' + (shown && auto && !saved ? ' auto-no' : '')} value={saved ?? (shown && auto && preview ? preview : txt || prefix)} disabled={!!saved || opts.disabled} maxLength={30} aria-label={opts.label ?? 'เลขที่เอกสาร'}
        placeholder={preview} onChange={(e) => { setShown(false); setTxt(e.target.value.replace(/\s/g, '')); }}
        onFocus={() => setShown(false)}
        onBlur={(e) => { if (!saved && !opts.disabled && auto) { setShown(true); toast(`ไม่ได้คีย์เลขที่เอง — ใช้เลขที่อัตโนมัติ ${preview} (ออกเลขจริงตอนบันทึก · ต้องการเลขเองให้คลิกช่องแล้วพิมพ์)`, 'warn', e.currentTarget); } }} />
    </Field>
  );
  return { field, value: saved ? null : auto ? null : typed, reset: () => setTxt('') };
}
