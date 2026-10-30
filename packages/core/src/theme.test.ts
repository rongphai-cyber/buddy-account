import { describe, expect, it } from 'vitest';
import { contrastRatio, DEFAULT_UI_THEME, normalizeUiTheme, THEME_FONTS, THEMES, themeVars } from './theme.js';

describe('ธีมของแต่ละบริษัท', () => {
  it('every theme stays readable: white text on accent, ink/muted on background and fields', () => {
    expect(new Set(THEMES.map((t) => t.key)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect([t.key, contrastRatio(t.accent, '#ffffff') >= 4.5]).toEqual([t.key, true]);       // ปุ่มหลักตัวอักษรขาว
      expect([t.key, contrastRatio('#2b2840', t.bg) >= 7]).toEqual([t.key, true]);              // ตัวอักษรหลักบนพื้น
      expect([t.key, contrastRatio('#69657f', t.surface2) >= 4.5]).toEqual([t.key, true]);      // ตัวอักษรรองบนพื้นรอง
      expect([t.key, contrastRatio('#2b2840', t.accentSoft) >= 7]).toEqual([t.key, true]);      // แถวที่เลือก/ป้าย
      // พาสเทล: พื้นและแถบสว่างมาก
      for (const c of [t.bg, t.surface2, t.accentSoft, ...t.bar]) expect([t.key, c, contrastRatio(c, '#ffffff') < 1.25]).toEqual([t.key, c, true]);
    }
  });

  it('the default theme equals the original look; unknown values fall back', () => {
    expect(themeVars(DEFAULT_UI_THEME)).toMatchObject({ '--accent': '#6f5db8', '--bg': '#f8f6fc', '--bar': 'linear-gradient(90deg, #e9e3fa 0%, #e0f1fb 50%, #dff5e9 100%)' });
    expect(themeVars(DEFAULT_UI_THEME)['--sans']).toBe(THEME_FONTS[0]!.css);
    expect(normalizeUiTheme({ theme: 'mint', font: 'sarabun' })).toEqual({ theme: 'mint', font: 'sarabun' });
    expect(normalizeUiTheme({ theme: 'neon', font: 'comic' })).toEqual(DEFAULT_UI_THEME);
    expect(normalizeUiTheme(null)).toEqual(DEFAULT_UI_THEME);
    expect(normalizeUiTheme('x')).toEqual(DEFAULT_UI_THEME);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });
});
