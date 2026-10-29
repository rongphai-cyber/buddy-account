import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MENU, textSim, type MenuItem } from '@buddy/core';
import type { Me } from '../api';
import { cx, Modal } from '../ui';

type Row = { code: string; label: string; path: string[]; route: string };
const lower = (s: string) => s.toLowerCase().normalize('NFC');

/**
 * ค้นหาเมนู (Ctrl+K) — แทนปุ่มลัด Alt+ตัวเลขของเมนูหลัก: พิมพ์ชื่อหน้า (บางส่วนก็ได้ หลายคำคั่นด้วยเว้นวรรค) แล้ว Enter
 * ใช้ได้กับทุกหน้าย่อยและมีเมนูเพิ่มเท่าไรก็ได้ · แสดงเฉพาะเมนูที่ผู้ใช้มีสิทธิ์อ่าน
 */
export function MenuSearch({ perms, onClose }: { perms: Me['perms'] | undefined; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const all = useMemo(() => {
    const out: Row[] = [{ code: 'HOME', label: 'หน้าแรก', path: [], route: '/' }];
    const walk = (items: MenuItem[], path: string[]) => items.forEach((it) => {
      if (it.children) walk(it.children, [...path, it.label]);
      else if (it.route && perms?.[it.code]?.read !== false) out.push({ code: it.code, label: it.label, path, route: it.route });
    });
    walk(MENU, []);
    return out;
  }, [perms]);
  const rows = useMemo(() => {
    const words = lower(q).split(/\s+/).filter(Boolean);
    if (!words.length) return all.slice(0, 12);
    return all.map((r) => {
      const label = lower(r.label), full = lower([...r.path, r.label].join(' '));
      // ทุกคำต้องพบในชื่อหรือหมวด — ชื่อขึ้นต้นด้วยคำค้นได้คะแนนสูงสุด · สะกดใกล้เคียงได้คะแนนรอง
      const hit = words.every((w) => full.includes(w));
      const score = hit ? (label.startsWith(words[0]!) ? 3 : words.every((w) => label.includes(w)) ? 2 : 1) : Math.max(textSim(q, r.label), textSim(q, full)) >= 0.5 ? 0.5 : 0;
      return { r, score };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.r.label.length - b.r.label.length).slice(0, 15).map((x) => x.r);
  }, [all, q]);
  const go = (r: Row | undefined) => { if (!r) return; onClose(); nav(r.route); };
  const cur = Math.min(sel, Math.max(0, rows.length - 1));
  return (
    <Modal title="ค้นหาเมนู" size="form" onClose={onClose}>
      <input type="search" autoFocus value={q} placeholder="พิมพ์ชื่อหน้า เช่น ภาษีซื้อ, เช็ค, ใบกำกับ, งบทดลอง" aria-label="ค้นหาเมนู" style={{ width: '100%' }}
        onChange={(e) => { setQ(e.target.value); setSel(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(rows[cur]); }
        }} />
      <ul className="menu-search-list" role="listbox" aria-label="ผลการค้นหาเมนู">
        {rows.map((r, i) => (
          <li key={r.code} role="option" aria-selected={i === cur} className={cx(i === cur && 'on')} onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
            <b>{r.label}</b>{r.path.length > 0 && <span className="muted small"> · {r.path.join(' › ')}</span>}
          </li>
        ))}
        {!rows.length && <li className="muted">ไม่พบเมนู "{q}" — ลองคำที่สั้นลง</li>}
      </ul>
      <p className="hint">↑ ↓ เลือก · Enter เปิด · Esc ปิด</p>
    </Modal>
  );
}
