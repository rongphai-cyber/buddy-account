import { useEffect, useState } from 'react';
import { normalizeUiTheme, THEME_FONTS, THEMES, type UiTheme } from '@buddy/core';
import { api } from '../api';
import { applyTheme } from '../theme';
import { useCan, useSession } from '../session';
import { ErrorBox, toast } from '../ui';

/**
 * ธีมของบริษัท (ข้อกำหนดเจ้าของ 30/10/2569) — เลือกชุดสีพาสเทลและแบบอักษร เห็นผลทันทีก่อนบันทึก
 * ทุกคนในบริษัทเห็นเหมือนกัน · ช่วยแยกบริษัทได้ด้วยตาเมื่อทำงานหลายบริษัท
 */
export function ThemePicker() {
  const { me, refresh } = useSession();
  const can = useCan('SET.CO');
  const saved = normalizeUiTheme(me?.ui_theme);
  const [v, setV] = useState<UiTheme>(saved);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dirty = v.theme !== saved.theme || v.font !== saved.font;
  // ดูตัวอย่างทันที · ออกจากหน้านี้โดยไม่บันทึก = กลับเป็นธีมที่บันทึกไว้
  useEffect(() => { applyTheme(v); }, [v]);
  // เปลี่ยนบริษัท/บันทึกแล้ว → เริ่มจากธีมที่บันทึกของบริษัทนั้น
  useEffect(() => { setV(saved); }, [saved.theme, saved.font]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => applyTheme(normalizeUiTheme(me?.ui_theme)), [me?.ui_theme]);
  const save = async () => {
    setErr(null); setBusy(true);
    try { await api.put('/api/v1/company/ui-theme', v); toast('บันทึกธีมของบริษัทแล้ว — ทุกคนในบริษัทนี้เห็นธีมนี้'); await refresh(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const edit = can('edit');
  return (
    <>
      <h2 className="section-title">ธีมและแบบอักษรของบริษัท</h2>
      <div className="card theme-card">
        <p className="hint">เลือกสีให้แต่ละบริษัทต่างกัน จะได้รู้ทันทีว่ากำลังทำงานบริษัทไหน · สีประจำระบบงาน (ซื้อ ขาย การเงิน ฯลฯ) คงเดิม · ขนาดตัวอักษรปรับที่เบราว์เซอร์ด้วย Ctrl + / Ctrl −</p>
        <ErrorBox error={err} />
        <div className="theme-grid" role="radiogroup" aria-label="ชุดสี">
          {THEMES.map((t) => <button key={t.key} type="button" role="radio" aria-checked={v.theme === t.key} disabled={!edit} className={`theme-swatch${v.theme === t.key ? ' on' : ''}`}
            onClick={() => setV({ ...v, theme: t.key })} style={{ background: `linear-gradient(90deg, ${t.bar[0]}, ${t.bar[1]}, ${t.bar[2]})` }}>
            <span className="ts-dot" style={{ background: t.accent }} />
            <span className="ts-name">{t.label}</span>
            {saved.theme === t.key && <span className="ts-cur">ใช้อยู่</span>}
          </button>)}
        </div>
        <div className="form-grid">
          <label className="field"><span className="lbl">แบบอักษร</span>
            <select value={v.font} disabled={!edit} onChange={(e) => setV({ ...v, font: e.target.value })}>{THEME_FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
          <div className="field theme-sample" style={{ fontFamily: THEME_FONTS.find((f) => f.key === v.font)?.css }}><span className="lbl">ตัวอย่าง</span>
            <span>บริษัท ตัวอย่าง จำกัด · ยอดรวม ๑๒๓ 1,234,567.89 บาท</span></div>
        </div>
        {edit && <div className="theme-acts">
          <button type="button" className="primary" disabled={!dirty || busy} onClick={save}>บันทึกธีม</button>
          {dirty && <button type="button" onClick={() => setV(saved)}>คืนค่าที่บันทึกไว้</button>}
          {dirty && <span className="muted small">กำลังแสดงตัวอย่าง — ยังไม่บันทึก</span>}
        </div>}
        {!edit && <p className="muted small">เปลี่ยนธีมได้เฉพาะผู้มีสิทธิ์แก้รายละเอียดกิจการ</p>}
      </div>
    </>
  );
}
