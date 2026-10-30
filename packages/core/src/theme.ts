/**
 * ธีมของแต่ละบริษัท (ข้อกำหนดเจ้าของ 30/10/2569: "เปลี่ยนสี/ฟอนต์/ธีมของแต่ละบริษัท")
 * เลือกได้จากชุดสีพาสเทลที่กำหนด (CLAUDE.md ข้อ 12: ธีมพาสเทลเท่านั้น) + แบบอักษร — ไม่รับสีอิสระ
 * สีประจำระบบงาน (ซื้อ ขาย การเงิน …) คงเดิมทุกธีม ให้จำหน้าจอได้เหมือนกันทุกบริษัท
 * ช่วยแยกบริษัทได้ด้วยตา เมื่อผู้ใช้ทำงานหลายบริษัท
 */
export interface Theme {
  key: string; label: string;
  accent: string; accentSoft: string; bg: string; surface2: string; line: string; fieldLine: string;
  /** แถบด้านบน: ไล่สี 3 จุด */
  bar: [string, string, string];
}
export const THEMES: Theme[] = [
  { key: 'lavender', label: 'ม่วงลาเวนเดอร์', accent: '#6f5db8', accentSoft: '#ece7fa', bg: '#f8f6fc', surface2: '#f1edf9', line: '#e3ddf0', fieldLine: '#c3b8de', bar: ['#e9e3fa', '#e0f1fb', '#dff5e9'] },
  { key: 'sky', label: 'ฟ้า', accent: '#2f6fae', accentSoft: '#e2eefa', bg: '#f5f9fd', surface2: '#eaf2fa', line: '#d9e6f2', fieldLine: '#b3cbe3', bar: ['#dcecfb', '#e4f3fb', '#e8f7f3'] },
  { key: 'mint', label: 'เขียวมิ้นต์', accent: '#2b7d60', accentSoft: '#dff3e9', bg: '#f5fbf8', surface2: '#e9f6ef', line: '#d6ebe0', fieldLine: '#aed3bf', bar: ['#d9f3e6', '#e5f7ee', '#eef9e3'] },
  { key: 'teal', label: 'เขียวน้ำทะเล', accent: '#1d7880', accentSoft: '#dcf1f2', bg: '#f4fbfb', surface2: '#e7f5f6', line: '#d2e9ea', fieldLine: '#a8d0d3', bar: ['#d7f1f2', '#e1f1fb', '#e6f6ee'] },
  { key: 'peach', label: 'พีช', accent: '#ad5128', accentSoft: '#fbe8dd', bg: '#fdf8f5', surface2: '#faefe8', line: '#f0ddd2', fieldLine: '#dfbba6', bar: ['#fde4d6', '#fdeedd', '#fbf3df'] },
  { key: 'rose', label: 'ชมพูกุหลาบ', accent: '#ad4169', accentSoft: '#fae5ed', bg: '#fdf6f9', surface2: '#f9ecf2', line: '#efd8e2', fieldLine: '#dbb3c4', bar: ['#fbe0ea', '#f6e4f5', '#ebe5fa'] },
  { key: 'lemon', label: 'เหลืองนวล', accent: '#7f650c', accentSoft: '#f7efd0', bg: '#fdfbf3', surface2: '#f8f3e2', line: '#ece4c8', fieldLine: '#d6c891', bar: ['#faf0cc', '#f6f6da', '#e8f6e0'] },
  { key: 'slate', label: 'เทาฟ้า', accent: '#4c5c84', accentSoft: '#e6e9f3', bg: '#f7f8fb', surface2: '#eceff6', line: '#dde1ec', fieldLine: '#b9c0d4', bar: ['#e5e9f5', '#edf0f7', '#ecf3f1'] },
];
export interface ThemeFont { key: string; label: string; css: string }
export const THEME_FONTS: ThemeFont[] = [
  { key: 'plex', label: 'IBM Plex Sans Thai (ค่าเริ่มต้น)', css: "'IBM Plex Sans Thai', 'Noto Sans Thai', 'Leelawadee UI', Tahoma, system-ui, sans-serif" },
  { key: 'sarabun', label: 'สารบรรณ (Sarabun) — แบบหนังสือราชการ', css: "'Sarabun', 'Leelawadee UI', Tahoma, system-ui, sans-serif" },
  { key: 'system', label: 'แบบอักษรในเครื่อง (Leelawadee / Tahoma) — ใช้ได้แม้ไม่มีอินเทอร์เน็ต', css: "'Leelawadee UI', Tahoma, 'Noto Sans Thai', system-ui, sans-serif" },
];
export interface UiTheme { theme: string; font: string }
export const DEFAULT_UI_THEME: UiTheme = { theme: 'lavender', font: 'plex' };

/** ค่าที่เก็บไว้ (อาจเก่า/ผิด) → ค่าที่ใช้ได้เสมอ */
export function normalizeUiTheme(v: unknown): UiTheme {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<UiTheme>;
  return { theme: THEMES.some((t) => t.key === o.theme) ? o.theme! : DEFAULT_UI_THEME.theme, font: THEME_FONTS.some((f) => f.key === o.font) ? o.font! : DEFAULT_UI_THEME.font };
}

/** ตัวแปร CSS ของธีม (ใส่ที่ :root) — ตรงกับชื่อใน style.css */
export function themeVars(v: UiTheme): Record<string, string> {
  const t = THEMES.find((x) => x.key === v.theme) ?? THEMES[0]!;
  const f = THEME_FONTS.find((x) => x.key === v.font) ?? THEME_FONTS[0]!;
  return {
    '--accent': t.accent, '--accent-soft': t.accentSoft, '--bg': t.bg, '--surface-2': t.surface2, '--line': t.line, '--field-line': t.fieldLine,
    '--bar': `linear-gradient(90deg, ${t.bar[0]} 0%, ${t.bar[1]} 50%, ${t.bar[2]} 100%)`, '--sans': f.css,
  };
}

/** อัตราส่วนความต่างของสี (WCAG 2) — ใช้ตรวจว่าทุกธีมอ่านง่าย */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
