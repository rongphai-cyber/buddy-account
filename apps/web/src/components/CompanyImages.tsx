import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useCan } from '../session';
import { Confirm, ErrorBox, toast } from '../ui';

/** รูปของบริษัท (โลโก้/ลายเซ็น) ในรูปแบบที่หน้าพิมพ์ใช้ — ส่งมากับข้อมูลพิมพ์ (GET /print/…) */
export type CompanyImages = { logo: string | null; signs: Record<string, { name: string; data: string }> };
type Img = { id: string; kind: 'LOGO' | 'SIGN'; name: string; mime: string; bytes: number; data: string };
const MAX = 300 * 1024;

export function useCompanyImages() {
  const q = useQuery({ queryKey: ['company-images'], queryFn: () => api.get<Img[]>('/api/v1/company-images') });
  const images: CompanyImages = { logo: q.data?.find((x) => x.kind === 'LOGO')?.data ?? null, signs: Object.fromEntries((q.data ?? []).filter((x) => x.kind === 'SIGN').map((x) => [x.id, { name: x.name, data: x.data }])) };
  return { q, images };
}

/** อ่านรูปจากแฟ้ม — ใหญ่เกิน 300 KB ย่อให้เอง (กว้างสุด 900 px · PNG คงพื้นโปร่งใส ถ้ายังใหญ่ใช้ JPEG) */
export async function readImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error('ใช้รูป PNG หรือ JPG เท่านั้น');
  const url = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('อ่านแฟ้มไม่ได้')); r.readAsDataURL(file); });
  if (file.size <= MAX) return url;
  const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('เปิดรูปไม่ได้')); i.src = url; });
  for (const w of [900, 700, 500, 350]) {
    const c = document.createElement('canvas');
    c.width = Math.min(w, img.width); c.height = Math.round(img.height * (c.width / img.width));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    for (const out of [c.toDataURL('image/png'), c.toDataURL('image/jpeg', 0.85)]) if (out.length * 0.75 <= MAX) return out;
  }
  throw new Error('รูปใหญ่เกินไป ย่อแล้วยังเกิน 300 KB — ใช้รูปที่เล็กลง');
}

/**
 * โลโก้และลายเซ็นของบริษัท (ข้อกำหนดเจ้าของ 30/10/2569) — ใช้ร่วมทุกแบบฟอร์ม
 * แบบฟอร์มเลือกตำแหน่งโลโก้ และเลือกรูปลายเซ็นให้แต่ละช่องลงชื่อ
 */
export function CompanyImagesPanel() {
  const can = useCan('RP.FORM');
  const qc = useQueryClient();
  const { q } = useCompanyImages();
  const [err, setErr] = useState<unknown>(null);
  const [signName, setSignName] = useState('');
  const [del, setDel] = useState<Img | null>(null);
  // เปิดเองตอนยังไม่มีโลโก้ · หลังจากนั้นตามที่ผู้ใช้เปิด/ปิด (ไม่พับเองหลังอัปโหลด)
  const [open, setOpen] = useState<boolean | null>(null);
  const reload = () => { qc.invalidateQueries({ queryKey: ['company-images'] }); qc.invalidateQueries({ queryKey: ['print'] }); qc.invalidateQueries({ queryKey: ['print-sample'] }); };
  const upLogo = async (f: File | undefined) => {
    if (!f) return; setErr(null);
    try { await api.put('/api/v1/company-images/logo', { data: await readImage(f) }); toast('บันทึกโลโก้แล้ว'); reload(); } catch (e) { setErr(e); }
  };
  const upSign = async (f: File | undefined) => {
    if (!f) return; setErr(null);
    if (!signName.trim()) { setErr(new Error('ตั้งชื่อลายเซ็นก่อน เช่น กรรมการผู้จัดการ')); return; }
    try { await api.post('/api/v1/company-images/signs', { name: signName.trim(), data: await readImage(f) }); toast('เพิ่มลายเซ็นแล้ว'); setSignName(''); reload(); } catch (e) { setErr(e); }
  };
  const remove = async () => { if (!del) return; try { await api.del(`/api/v1/company-images/${del.id}`); toast('ลบรูปแล้ว'); reload(); } catch (e) { setErr(e); } setDel(null); };
  const logo = q.data?.find((x) => x.kind === 'LOGO');
  const signs = (q.data ?? []).filter((x) => x.kind === 'SIGN');
  return (
    <details className="card ci-panel" open={open ?? !logo} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><b>โลโก้และลายเซ็นของบริษัท</b> <span className="muted small">— ใช้ได้ทุกแบบฟอร์ม · PNG/JPG (รูปใหญ่ย่อให้เอง) · ลายเซ็นแนะนำ PNG พื้นโปร่งใส</span></summary>
      <ErrorBox error={err ?? q.error} />
      <div className="ci-row">
        <div className="ci-box">
          <div className="small muted">โลโก้</div>
          {logo ? <img src={logo.data} alt="โลโก้บริษัท" className="ci-img" /> : <div className="ci-empty">ยังไม่มีโลโก้</div>}
          {can('edit') && <div className="ci-acts"><label className="btn">{logo ? 'เปลี่ยนโลโก้…' : '⬆ อัปโหลดโลโก้…'}<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { void upLogo(e.target.files?.[0]); e.target.value = ''; }} /></label>
            {logo && can('delete') && <button type="button" onClick={() => setDel(logo)}>ลบ</button>}</div>}
        </div>
        {signs.map((s) => <div key={s.id} className="ci-box">
          <div className="small muted">ลายเซ็น: {s.name}</div>
          <img src={s.data} alt={`ลายเซ็น ${s.name}`} className="ci-img" />
          {can('delete') && <div className="ci-acts"><button type="button" onClick={() => setDel(s)}>ลบ</button></div>}
        </div>)}
        {can('add') && <div className="ci-box">
          <div className="small muted">เพิ่มลายเซ็น</div>
          <input value={signName} maxLength={120} placeholder="ชื่อ เช่น กรรมการผู้จัดการ" onChange={(e) => setSignName(e.target.value)} aria-label="ชื่อลายเซ็น" />
          <div className="ci-acts"><label className="btn">⬆ เลือกรูปลายเซ็น…<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { void upSign(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
        </div>}
      </div>
      {del && <Confirm title="ลบรูป" danger text={`ลบ${del.kind === 'LOGO' ? 'โลโก้' : `ลายเซ็น "${del.name}"`}? แบบฟอร์มที่ใช้รูปนี้จะไม่แสดงรูปอีก`} okText="ลบ" onOk={remove} onClose={() => setDel(null)} />}
    </details>
  );
}
