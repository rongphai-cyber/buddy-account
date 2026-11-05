/** ที่อยู่แยกช่อง (docs/18 ข้อ 12 · เจ้าของ 05/11/2569) — ตัวตรวจร่วมทุกหน้าจอที่มีที่อยู่ */
import { sql, type RawBuilder } from 'kysely';
import { z } from 'zod';
import { geoLookup } from '@buddy/core/geo-th';

const str = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
export const geoCode = z.string().trim().nullable().optional().transform((v) => (v ? v : null))
  .refine((v) => !v || geoLookup(v) !== null, 'ตำบล/แขวงไม่ถูกต้อง — เลือกจังหวัด อำเภอ ตำบลจากรายการ หรือกรอกรหัสไปรษณีย์ใหม่');

/** ช่อง addr_* ใส่ใน z.object({...}) */
export const addrShape = {
  addr_no: str(20), addr_moo: str(20), addr_village: str(100), addr_building: str(40),
  addr_room: str(20), addr_floor: str(20), addr_soi: str(100), addr_road: str(100), addr_geo_code: geoCode,
};
export const ADDR_COLS = ['addr_no', 'addr_moo', 'addr_village', 'addr_building', 'addr_room', 'addr_floor', 'addr_soi', 'addr_road', 'addr_geo_code'] as const;
/** SET addr_* = NULL (PDPA) */
export const addrNullSql = (): RawBuilder<unknown> => sql.raw(ADDR_COLS.map((c) => `${c} = NULL`).join(', '));
