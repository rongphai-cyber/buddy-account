import { getLang, setLang } from '../i18n';

/** ปุ่มสลับภาษา ไทย/อังกฤษ (ข้อกำหนดเจ้าของข้อ 9) — จำไว้ในเครื่องนี้ */
export function LangSwitch({ className }: { className?: string }) {
  const en = getLang() === 'en';
  return (
    <button type="button" className={`lang-sw ${className ?? ''}`} data-no-i18n onClick={() => setLang(en ? 'th' : 'en')}
      title={en ? 'เปลี่ยนเป็นภาษาไทย' : 'Switch to English'} aria-label={en ? 'ภาษาไทย' : 'English'}>
      {en ? 'ไทย' : 'EN'}
    </button>
  );
}
