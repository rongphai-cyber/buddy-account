import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Confirm, ErrorBox, Modal, toast } from '../ui';
import { readImage } from './CompanyImages';

type Img = { id: string; line_no: number; is_main: boolean; name: string | null; bytes: number };
export const MAX_ITEM_IMAGES = 8;
/** ที่อยู่แฟ้มรูปสินค้า (ใช้กับ <img>) */
export const itemImageSrc = (id: string, size: 'thumb' | 'full' = 'thumb') => `/api/v1/item-images/${id}?size=${size}`;

/** รูปย่อสำหรับรายการ: JPEG ด้านยาวไม่เกิน 160 px พื้นขาว (รูป PNG โปร่งใสไม่กลายเป็นพื้นดำ) */
async function makeThumb(url: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('เปิดรูปไม่ได้')); i.src = url; });
  const k = Math.min(1, 160 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

/** รูปเล็กในรายการ/หน้าค้นหา — ไม่มีรูปแสดงช่องว่างขนาดเท่ากันให้แถวตรงกัน */
export function ItemThumb({ id, size = 32 }: { id: string | null | undefined; size?: number }) {
  return id ? <img className="item-thumb" src={itemImageSrc(id)} alt="" loading="lazy" style={{ width: size, height: size }} /> : <span className="item-thumb none" style={{ width: size, height: size }} />;
}

/**
 * แท็บรูปภาพในหน้าสินค้า (ข้อกำหนดเจ้าของ 30/10/2569) — สูงสุด 8 รูป บันทึกทันทีเมื่อเลือกแฟ้ม
 * รูปหลัก ⭐ แสดงในรายการสินค้าและหน้าค้นหา · คลิกรูปเพื่อดูขนาดเต็ม
 */
export function ItemImagesTab({ path, itemId, canEdit }: { path: string; itemId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['item-images', path, itemId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Img[]>(`/api/v1/${path}/${itemId}/images`) });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Img | null>(null);
  const [del, setDel] = useState<Img | null>(null);
  const list = q.data ?? [];
  const reload = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: [path] }); qc.invalidateQueries({ queryKey: ['pick'] }); };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null); setBusy(true);
    let n = 0;
    try {
      for (const f of Array.from(files).slice(0, MAX_ITEM_IMAGES - list.length)) {
        const data = await readImage(f);
        await api.post(`/api/v1/${path}/${itemId}/images`, { data, thumb: await makeThumb(data), name: f.name.slice(0, 120) });
        n++;
      }
      if (files.length > MAX_ITEM_IMAGES - list.length) toast(`เพิ่มได้อีก ${MAX_ITEM_IMAGES - list.length} รูป — แฟ้มที่เกินไม่ได้บันทึก`, 'warn');
    } catch (e) { setErr(e); }
    if (n) toast(`เพิ่มรูป ${n} รูปแล้ว`);
    setBusy(false); reload();
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => { setErr(null); try { await fn(); toast(msg); reload(); } catch (e) { setErr(e); } };
  return (
    <div className="item-images">
      <ErrorBox error={err ?? q.error} />
      <div className="ii-bar">
        <span className="muted small">{list.length} / {MAX_ITEM_IMAGES} รูป · PNG/JPG (รูปใหญ่ย่อให้เอง ≤ 300 KB) · รูปหลัก ⭐ แสดงในรายการสินค้าและหน้าค้นหา</span>
        {canEdit && list.length < MAX_ITEM_IMAGES && <label className={`btn${busy ? ' disabled' : ''}`}>{busy ? 'กำลังบันทึก…' : '⬆ เพิ่มรูป…'}
          <input type="file" accept="image/png,image/jpeg" multiple hidden disabled={busy} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>}
      </div>
      <div className="ii-grid">
        {list.map((x) => <figure key={x.id} className={x.is_main ? 'is-main' : undefined}>
          <button type="button" className="ii-img" title="ดูรูปขนาดเต็ม" onClick={() => setView(x)}><img src={itemImageSrc(x.id)} alt={x.name ?? 'รูปสินค้า'} loading="lazy" /></button>
          <figcaption>
            {x.is_main ? <b>⭐ รูปหลัก</b> : canEdit ? <button type="button" onClick={() => act(() => api.put(`/api/v1/${path}/${itemId}/images/${x.id}/main`, {}), 'ตั้งเป็นรูปหลักแล้ว')}>ตั้งเป็นรูปหลัก</button> : null}
            {canEdit && <button type="button" className="danger" onClick={() => setDel(x)}>ลบ</button>}
          </figcaption>
        </figure>)}
        {q.data && !list.length && <div className="ii-empty">ยังไม่มีรูป{canEdit ? ' — กด "เพิ่มรูป" เลือกได้หลายแฟ้มพร้อมกัน' : ''}</div>}
      </div>
      {view && <Modal title={view.name ?? 'รูปสินค้า'} onClose={() => setView(null)} footer={<button onClick={() => setView(null)}>ปิด <kbd>Esc</kbd></button>}>
        <img className="ii-full" src={itemImageSrc(view.id, 'full')} alt={view.name ?? 'รูปสินค้า'} />
      </Modal>}
      {del && <Confirm danger title="ลบรูป" text={`ลบรูป${del.is_main ? 'หลัก' : ''}นี้?${del.is_main && list.length > 1 ? ' รูปถัดไปจะเป็นรูปหลักแทน' : ''}`} okText="ลบ"
        onOk={() => { const x = del; setDel(null); void act(() => api.del(`/api/v1/${path}/${itemId}/images/${x.id}`), 'ลบรูปแล้ว'); }} onClose={() => setDel(null)} />}
    </div>
  );
}
