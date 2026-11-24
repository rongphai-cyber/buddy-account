/**
 * ตัวเลือกการคัดลอกบริษัท (HANDOFF 181) — ใช้ร่วม "คัดลอกบริษัท" (บริษัททั้งหมด) และ "กำหนดบริษัทใหม่ › คัดลอกจากบริษัทที่มีอยู่"
 * เปิดแฟ้มข้อมูลใหม่แบบ Express (คู่มือบทที่ 4 S-CO-07): ติ๊ก = ไม่เอาไปบริษัทใหม่ · ยอดยกมาและรายการรายวันไม่เอาเสมอ
 * ต่างจาก Express: ไม่ลบอะไรในบริษัทเดิม — สร้างบริษัทใหม่แทน (บริษัทเดิมยังใช้ได้ตามเดิม)
 */
export type CopyGroup = 'customers' | 'suppliers' | 'salespersons' | 'bank_accounts' | 'items' | 'serials' | 'assets';
export const COPY_GROUP_LABELS: Array<{ key: CopyGroup; label: string; hint?: string }> = [
  { key: 'customers', label: 'ทะเบียนลูกค้า', hint: 'รวมสาขา สถานที่ส่งของ ผู้ติดต่อ' },
  { key: 'suppliers', label: 'ทะเบียนผู้จำหน่าย', hint: 'รวมสาขา บัญชีธนาคาร ผู้ติดต่อ' },
  { key: 'salespersons', label: 'พนักงานขาย' },
  { key: 'bank_accounts', label: 'บัญชีเงินฝากธนาคาร' },
  { key: 'items', label: 'สินค้า', hint: 'รวมสูตรการผลิต ราคาตามจำนวน รูปสินค้า' },
  { key: 'serials', label: 'ทะเบียนหมายเลขสินค้า' },
  { key: 'assets', label: 'รายการทรัพย์สิน', hint: 'ยกค่าเสื่อมราคาสะสมถึงวันก่อนเริ่มปีบัญชีใหม่เป็นยอดยกมา · ที่ขายแล้วไม่ยกไป' },
];
export const ALL_COPY_GROUPS = COPY_GROUP_LABELS.map((g) => g.key);

/** value = กลุ่มข้อมูลหลักที่เอาไปบริษัทใหม่ */
export function CopyGroupsPicker({ value, onChange, disabled }: { value: CopyGroup[]; onChange: (v: CopyGroup[]) => void; disabled?: boolean }) {
  const drop = (k: CopyGroup, on: boolean) => onChange(on ? value.filter((x) => x !== k) : [...value, k]);
  return (
    <fieldset className="copy-groups" disabled={disabled}>
      <legend>ข้อมูลที่ไม่เอาไปบริษัทใหม่ (ติ๊ก = ไม่เอา · แบบ "เปิดแฟ้มข้อมูลใหม่" ของ Express)</legend>
      <label className="check"><input type="checkbox" checked disabled /> ยอดยกมาของทุกระบบ</label>
      <label className="check"><input type="checkbox" checked disabled /> รายการรายวันของทุกระบบ (เอกสาร ใบสำคัญ)</label>
      {COPY_GROUP_LABELS.map((g) => <label key={g.key} className="check" title={g.hint}><input type="checkbox" checked={!value.includes(g.key)} onChange={(e) => drop(g.key, e.target.checked)} /> {g.label}{g.hint && <span className="muted small"> — {g.hint}</span>}</label>)}
      <label className="check"><input type="checkbox" checked={false} disabled /> ผังบัญชี <span className="muted small">— เอาไปเสมอ (ค่าตั้งระบบ ประเภทเอกสาร และการเชื่อมต่อบัญชีอ้างผังบัญชี)</span></label>
      <p className="hint">ค่าตั้งระบบเอาไปเสมอ: ค่าเริ่มต้นแต่ละระบบ ประเภทเอกสาร/เลขที่ สมุดรายวัน การเชื่อมต่อบัญชี แบบฟอร์มพิมพ์ แบบงบการเงิน หน่วยนับ คลัง แผนก โลโก้ ที่อยู่กิจการ · บริษัทเดิมไม่ถูกลบหรือแก้ไข</p>
    </fieldset>
  );
}
