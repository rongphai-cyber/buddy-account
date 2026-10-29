// สร้าง settings_catalog.json (ค่าเริ่มต้น ↔ ฟิลด์ ISINFO) จากแคตตาล็อกใน packages/core — importer อ่านไฟล์นี้
// ใช้: pnpm settings:catalog (ชุดทดสอบ core ตรวจว่าไฟล์ตรงกับแคตตาล็อกเสมอ)
import { writeFileSync } from 'node:fs';
import { SETTING_DEFS } from '../../packages/core/src/settings.ts';
const rows = SETTING_DEFS.filter((d) => d.from).map((d) => ({ key: d.key, module: d.module, from: d.from }));
writeFileSync(new URL('./settings_catalog.json', import.meta.url), JSON.stringify(rows, null, 1) + '\n');
console.log(`settings_catalog.json: ${rows.length} ค่า`);
