import { useSession } from '../session';

/**
 * รายการเอกสารแยกสาขา (ข้อกำหนดเจ้าของ 01/11/2569): เลือกสาขาที่แถบบน = แสดงเฉพาะสาขานั้น (เซิร์ฟเวอร์กรอง)
 * "ทุกสาขา" และบริษัทมีหลายสาขา = แสดงคอลัมน์สาขาให้รู้ว่าแต่ละใบเป็นของสาขาไหน
 */
export function useShowBranchCol() {
  const { me } = useSession();
  return (me?.branches.length ?? 0) > 1 && !me?.branch;
}

/** ป้ายบอกว่ารายการนี้กรองเฉพาะสาขาที่เลือก */
export function BranchScope() {
  const { me } = useSession();
  if (!me?.branch || (me.branches.length ?? 0) <= 1) return null;
  return <p className="notebox small branch-scope">🏢 แสดงเฉพาะสาขา <b>{me.branch.code} {me.branch.name}</b> — ดูทุกสาขาให้เลือก "ทุกสาขา" ที่แถบด้านบน</p>;
}
