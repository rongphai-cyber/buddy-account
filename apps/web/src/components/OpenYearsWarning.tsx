import { useNavigate } from 'react-router-dom';
/** เตือนเมื่อมีปีบัญชีที่ยังไม่ประมวลผลสิ้นปีเกิน 3 ปี (HANDOFF 176) — เตือนเท่านั้น ไม่บังคับ */
export function OpenYearsWarning({ codes, onGo }: { codes: string[]; onGo?: () => void }) {
  const nav = useNavigate();
  return (
    <p className="notebox">⚠️ ปี {codes.join(', ')} ยังไม่ได้ประมวลผลสิ้นปี — มีปีบัญชีที่ยังเปิดอยู่เกิน 3 ปี ควรตรวจและประมวลผลสิ้นปีตามลำดับ เพื่อให้ยอดยกมาแต่ละปีต่อเนื่องและแก้ไขย้อนหลังไม่ได้
      {' '}<button className="linklike" onClick={() => { onGo?.(); nav('/gl/year-end'); }}>อื่น ๆ › ประมวลผลสิ้นปี</button></p>
  );
}
