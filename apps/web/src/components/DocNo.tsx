import { useEffect, useState } from 'react';
import { formatDocNo } from '@buddy/core';
import { Field, toast } from '../ui';

/**
 * ช่องเลขที่เอกสาร (ข้อกำหนดเจ้าของ 30/10/2569) — ใช้กับทุกหน้าจอเอกสารที่บันทึก
 * เอกสารใหม่: แสดงตัวนำหน้าตามประเภทเอกสารไว้ให้ คีย์เลขต่อเองได้ · ไม่คีย์แล้ว Enter/คลิกผ่าน = ช่องแสดงเลขอัตโนมัติที่จะได้ + กล่องแจ้งติดช่อง
 * value = เลขที่ส่งให้เซิร์ฟเวอร์ (null = ออกเลขอัตโนมัติตอนบันทึก) · เอกสารที่บันทึกแล้วแสดงเลขเดิม แก้ไม่ได้
 */
/** เลขที่ที่คีย์ต้องขึ้นต้นด้วยตัวนำหน้า: ตัดส่วนที่ตรงตัวนำหน้า (แม้พิมพ์ไม่ครบ) แล้วเติมตัวนำหน้าเต็มกลับ */
export function withPrefix(prefix: string, raw: string) {
  const v = raw.replace(/\s/g, '');
  let k = 0;
  while (k < prefix.length && k < v.length && v[k]!.toUpperCase() === prefix[k]!.toUpperCase()) k++;
  return prefix + v.slice(k);
}

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
    <Field label={opts.label ?? 'เลขที่เอกสาร'} hint={saved ? undefined : auto ? `เว้นไว้ = เลขอัตโนมัติ ${preview}`.trim() : `คีย์เลขเอง — ขึ้นต้นด้วย ${prefix} เสมอ ห้ามซ้ำกับเอกสารอื่น`}>
      <input className={'mono' + (shown && auto && !saved ? ' auto-no' : '')} value={saved ?? (shown && auto && preview ? preview : txt || prefix)} disabled={!!saved || opts.disabled} maxLength={30} aria-label={opts.label ?? 'เลขที่เอกสาร'}
        placeholder={preview} onChange={(e) => { setShown(false); setTxt(withPrefix(prefix, e.target.value)); }}
        onKeyDown={(e) => {
          // ลบตัวนำหน้าไม่ได้: Backspace/Delete ที่ตัวนำหน้า = ไม่ทำอะไร
          const el = e.currentTarget, a = el.selectionStart ?? 0, b = el.selectionEnd ?? 0;
          if (prefix && a === b && ((e.key === 'Backspace' && a <= prefix.length) || (e.key === 'Delete' && a < prefix.length))) { e.preventDefault(); toast(`ตัวนำหน้า ${prefix} ลบไม่ได้ — เลขที่เอกสารต้องขึ้นต้นด้วยตัวนำหน้าของประเภทเอกสาร`, 'warn', el); }
          else if (prefix && (e.key === 'Home' || (e.key === 'ArrowLeft' && a <= prefix.length && a === b))) { e.preventDefault(); el.setSelectionRange(prefix.length, prefix.length); }
        }}
        onFocus={(e) => { setShown(false); const el = e.currentTarget; setTimeout(() => { const n = el.value.length; el.setSelectionRange(n, n); }, 0); }}
        onBlur={(e) => { if (!saved && !opts.disabled && auto) { setShown(true); toast(`ไม่ได้คีย์เลขที่เอง — ใช้เลขที่อัตโนมัติ ${preview} (ออกเลขจริงตอนบันทึก · ต้องการเลขเองให้คลิกช่องแล้วพิมพ์)`, 'warn', e.currentTarget); } }} />
    </Field>
  );
  return { field, value: saved ? null : auto ? null : typed, reset: () => setTxt('') };
}
