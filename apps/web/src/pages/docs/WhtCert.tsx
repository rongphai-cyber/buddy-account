import { useState } from 'react';
import { d } from '@buddy/core';
import { api } from '../../api';
import { DateInput, DateText, ErrorBox, Field, Modal, toast, useHotkeys } from '../../ui';

/**
 * หนังสือรับรอง 50 ทวิ ที่ลูกค้า/ธนาคารออกให้เรา (ทะเบียนภาษีถูกหัก — รายงาน 6.8 · ข้อกำหนดเจ้าของ 01/11/2569)
 * ได้รับมักตามมาทีหลัง → บันทึกได้ทุกเวลาหลังบันทึกเอกสาร ไม่ต้องกดแก้ไข ไม่กระทบการลงบัญชี
 */
export function WhtCert({ docId, wht, certNo, certDate, cancelled, onSaved }: { docId: string | null | undefined; wht: string | null | undefined; certNo: string | null | undefined; certDate: string | null | undefined; cancelled?: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  if (!docId || d(wht || 0).isZero() || cancelled) return null;
  return (
    <span className="wht-cert small">
      50 ทวิ ที่ได้รับ: {certNo ? <><b className="mono" data-no-i18n>{certNo}</b>{certDate && <> ลงวันที่ <DateText v={certDate} /></>}</> : <span className="bad">ยังไม่ได้รับ</span>}{' '}
      <button type="button" className="link" onClick={() => setEdit(true)}>✎ บันทึก</button>
      {edit && <WhtCertDialog docId={docId} certNo={certNo} certDate={certDate} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onSaved(); }} />}
    </span>
  );
}

function WhtCertDialog({ docId, certNo, certDate, onClose, onSaved }: { docId: string; certNo: string | null | undefined; certDate: string | null | undefined; onClose: () => void; onSaved: () => void }) {
  const [no, setNo] = useState(certNo ?? '');
  const [date, setDate] = useState(certDate ? String(certDate).slice(0, 10) : '');
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    setErr(null);
    try {
      await api.put(`/api/v1/docs/doc/${docId}/wht-cert`, { cert_no: no.trim() || null, cert_date: date || null });
      toast(no.trim() ? `บันทึกเลขที่ 50 ทวิ ${no.trim()} แล้ว` : 'ล้างเลขที่ 50 ทวิ แล้ว');
      onSaved();
    } catch (e) { setErr(e); }
  };
  useHotkeys({ F9: save, 'Ctrl+S': save }, [no, date]);
  return (
    <Modal title="หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) ที่ได้รับ" size="confirm" onClose={onClose}
      footer={<><button onClick={onClose}>ยกเลิก <kbd>Esc</kbd></button><button className="primary" onClick={save}>บันทึก <kbd>F9</kbd></button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="เลขที่ (เล่มที่/เลขที่)" hint="ตามหนังสือรับรองที่ผู้จ่ายเงินออกให้ — ว่าง = ยังไม่ได้รับ"><input value={no} maxLength={30} autoFocus onChange={(e) => setNo(e.target.value)} /></Field>
        <Field label="ลงวันที่"><DateInput value={date} onChange={setDate} /></Field>
      </div>
      <p className="muted small">ใช้เป็นหลักฐานเครดิตภาษีในแบบ ภ.ง.ด.50/51 — ดูรายการที่ยังไม่ได้รับที่ รายงานภาษี › 6.8 ทะเบียนภาษีถูกหัก ณ ที่จ่าย</p>
    </Modal>
  );
}
