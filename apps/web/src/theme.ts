import { normalizeUiTheme, themeVars, type UiTheme } from '@buddy/core';

/** ใส่ธีมของบริษัทที่ :root (ตัวแปร CSS เดียวกับ style.css) — ไม่มีธีม = ค่าเริ่มต้น ตรงกับ style.css เดิม */
export function applyTheme(v: UiTheme | null | undefined) {
  const t = normalizeUiTheme(v);
  const root = document.documentElement;
  for (const [k, x] of Object.entries(themeVars(t))) root.style.setProperty(k, x);
  root.dataset.theme = t.theme;
}
