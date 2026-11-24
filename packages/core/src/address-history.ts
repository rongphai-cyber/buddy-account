/**
 * ประวัติที่อยู่ของกิจการ (HANDOFF 180 · เจ้าของ 24/11/2569 "ปี 2567 ใช้ที่ 303 … ปี 2568 เป็น 340 … เอกสารแต่ละช่วงเวลาจะต้องออกให้ถูกต้อง")
 * แถวประวัติของสำนักงานใหญ่ (branch_id ว่าง) และของแต่ละสาขา มีวันที่มีผล — เอกสารใช้ที่อยู่ที่มีผล ณ วันที่เอกสาร
 */
export interface AddressRowLike { id?: string; branch_id: string | null; effective_from: string }
const iso = (v: string) => String(v).slice(0, 10);
const byDate = <T extends AddressRowLike>(a: T, b: T) => iso(a.effective_from).localeCompare(iso(b.effective_from));

/** แถวที่มีผล ณ วันที่ ของเจ้าของเดียวกัน: effective_from มากที่สุดที่ไม่เกินวันนั้น · วันก่อนแถวแรก = แถวแรก (เอกสารเก่ากว่าประวัติใช้ที่อยู่ชุดแรก) · ไม่มีแถว = null */
export function rowInEffect<T extends AddressRowLike>(rows: readonly T[], date: string): T | null {
  const s = [...rows].sort(byDate);
  if (!s.length) return null;
  const d = iso(date);
  let hit: T | null = null;
  for (const r of s) if (iso(r.effective_from) <= d) hit = r;
  return hit ?? s[0]!;
}

/**
 * ที่อยู่ของกิจการ ณ วันที่เอกสาร: สาขาที่มีประวัติที่อยู่ = ของสาขานั้น · สาขาที่ไม่มี (หรือสำนักงานใหญ่) = ของบริษัท (branch_id ว่าง)
 * fromBranch = ใช้ที่อยู่ของสาขา (ไม่ใช่ของสำนักงานใหญ่)
 */
export function addressAt<T extends AddressRowLike>(rows: readonly T[], date: string, branchId?: string | null): { row: T | null; fromBranch: boolean } {
  if (branchId) {
    const br = rowInEffect(rows.filter((r) => r.branch_id === branchId), date);
    if (br) return { row: br, fromBranch: true };
  }
  return { row: rowInEffect(rows.filter((r) => !r.branch_id), date), fromBranch: false };
}

/** วันที่มีผลซ้ำกับแถวอื่นของเจ้าของเดียวกัน (สำนักงานใหญ่/สาขาเดียวกัน) — ห้ามมีสองแถวที่มีผลวันเดียวกัน */
export function addressDateTaken<T extends AddressRowLike>(rows: readonly T[], branchId: string | null, date: string, exceptId?: string): boolean {
  return rows.some((r) => (r.branch_id ?? null) === (branchId ?? null) && iso(r.effective_from) === iso(date) && (!exceptId || r.id !== exceptId));
}
