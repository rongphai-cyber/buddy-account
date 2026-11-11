// เตรียมโปรแกรมก่อนสร้าง image บนคลาวด์ — wrangler.jsonc "build.command" เรียกไฟล์นี้ก่อน docker build (Buddy HANDOFF ข้อ 115)
// เหตุผล: เครื่อง build ของ Cloudflare รันคำสั่ง RUN ใน Dockerfile ไม่ได้ (runc … mounting "proc" … operation not permitted · HANDOFF 114)
//   → Workers Builds ติดตั้งแพ็กเกจ (pnpm install) ให้แล้ว · ไฟล์นี้สร้างหน้าจอ แล้วตรวจว่าครบ · Dockerfile แค่คัดลอก (ไม่มี RUN)
// deploy จากเครื่องสำนักงานด้วย image เดิม (ไม่สร้าง image): WTS_SKIP_PREBUILD=1
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUILD = 'pnpm --filter @buddy/web build';
const NEED = ['apps/server/node_modules/tsx/dist/cli.mjs', 'apps/web/dist/index.html'];

if (process.env.WTS_SKIP_PREBUILD === '1') {
  console.log('[prebuild] ข้าม (WTS_SKIP_PREBUILD=1)');
  process.exit(0);
}
console.log(`[prebuild] ${BUILD}`);
execSync(BUILD, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, CI: '1' } });
const missing = NEED.filter((f) => !existsSync(`${ROOT}${f}`));
if (missing.length) {
  console.error(`[prebuild] ✗ ไม่พบ ${missing.join(', ')} — ต้อง pnpm install --frozen-lockfile ก่อน (Workers Builds ทำให้เอง) · image จะเปิดไม่ขึ้น จึงหยุดตรงนี้`);
  process.exit(1);
}
if (process.platform !== 'linux') console.log('[prebuild] หมายเหตุ: เครื่องนี้ไม่ใช่ Linux — image ที่ใช้งานจริงต้องสร้างบน Cloudflare (node_modules ของ Linux)');
console.log(`[prebuild] ✓ พร้อมสร้าง image (${NEED.length} ไฟล์สำคัญครบ)`);
