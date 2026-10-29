// สร้างตัวติดตั้ง Buddy Account สำหรับ Windows (T7.4)
//   node tools/installer/build.mjs [--no-exe] [--skip-web]
// ผลลัพธ์ใน dist-installer/: BuddyAccount/ (โฟลเดอร์โปรแกรม) · BuddyAccount-<รุ่น>.zip · BuddyAccount-<รุ่น>.exe (IExpress มากับ Windows)
// ในชุดมี node.exe (ตัวที่ใช้สร้าง) + PostgreSQL 16 (embedded-postgres) + โปรแกรมที่รวมไฟล์ด้วย esbuild — เครื่องปลายทางไม่ต้องลงอะไรเพิ่ม
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = join(ROOT, 'tools/installer');
const OUT = join(ROOT, 'dist-installer');
const PKG = join(OUT, 'BuddyAccount');
const APP = join(PKG, 'app');
const args = new Set(process.argv.slice(2));
const step = (s) => console.log(`• ${s}`);

if (process.platform !== 'win32') throw new Error('สร้างตัวติดตั้ง Windows ต้องรันบน Windows');
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const version = `${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}-${today}.${commit}`;

rmSync(PKG, { recursive: true, force: true });
mkdirSync(join(APP, 'server'), { recursive: true });

if (!args.has('--skip-web') || !existsSync(join(ROOT, 'apps/web/dist/index.html'))) {
  step('สร้างหน้าเว็บ (vite build)');
  const r = spawnSync(join(ROOT, 'apps/web/node_modules/.bin/vite.CMD'), ['build'], { cwd: join(ROOT, 'apps/web'), stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('vite build ไม่สำเร็จ');
}

step('รวมโปรแกรมฝั่งเซิร์ฟเวอร์ (esbuild)');
// esbuild มากับ tsx ของ apps/server อยู่แล้ว (ไม่ต้องติดตั้งเพิ่ม)
const esbuild = createRequire(createRequire(join(ROOT, 'apps/server/package.json')).resolve('tsx'))('esbuild');
const banner = { js: "import { createRequire as __bCr } from 'node:module'; import { fileURLToPath as __bFu } from 'node:url'; import { dirname as __bDn } from 'node:path'; const require = __bCr(import.meta.url); const __filename = __bFu(import.meta.url); const __dirname = __bDn(__filename);" };
const common = { bundle: true, platform: 'node', target: 'node22', format: 'esm', banner, logLevel: 'warning', absWorkingDir: ROOT, legalComments: 'none' };
await esbuild.build({ ...common, entryPoints: { main: 'apps/server/src/main.ts', cli: 'apps/server/src/cli.ts' }, outdir: join(APP, 'server'), outExtension: { '.js': '.mjs' },
  external: ['@electric-sql/pglite', 'pg-native'], tsconfig: join(ROOT, 'apps/server/tsconfig.json') });
await esbuild.build({ ...common, entryPoints: [join(HERE, 'launcher.mjs')], outfile: join(APP, 'launcher.mjs'), external: ['pg-native'], nodePaths: [join(ROOT, 'apps/server/node_modules')] });

step('คัดลอกไฟล์ที่โปรแกรมอ่านตอนทำงาน');
cpSync(join(ROOT, 'apps/web/dist'), join(APP, 'apps/web/dist'), { recursive: true });
cpSync(join(ROOT, 'db/migrations'), join(APP, 'db/migrations'), { recursive: true });
cpSync(join(ROOT, 'db/seed'), join(APP, 'db/seed'), { recursive: true });
mkdirSync(join(APP, 'db/generated'), { recursive: true });
copyFileSync(join(ROOT, 'db/generated/seed_company_template.sql'), join(APP, 'db/generated/seed_company_template.sql'));
// PGlite (ฐานข้อมูลในตัว — โหมดสำรองเมื่อไม่ตั้ง DATABASE_URL) แยกไว้เพราะมีไฟล์ wasm
const pglite = join(ROOT, 'apps/server/node_modules/@electric-sql/pglite');   // exports ไม่เปิด package.json — ใช้ลิงก์ของ pnpm ตรง ๆ
cpSync(pglite, join(APP, 'node_modules/@electric-sql/pglite'), { recursive: true, dereference: true });

step('คัดลอก PostgreSQL 16 + Node.js');
const pgPkg = createRequire(createRequire(join(ROOT, 'package.json')).resolve('embedded-postgres')).resolve('@embedded-postgres/windows-x64');
const native = resolve(dirname(pgPkg), '..', 'native');
// ไม่เอา wxWidgets (ของ pgAdmin/StackBuilder) — postgres ไม่ได้ใช้
cpSync(native, join(APP, 'pgsql'), { recursive: true, dereference: true, filter: (s) => !/[\\/](wx\w+\.dll|testplug\.dll|pg-symlinks\.json)$/i.test(s) });
// VC++ runtime วางคู่ไบนารี (app-local) เผื่อเครื่องปลายทางยังไม่มี Visual C++ Redistributable
for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
  const s = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', dll);
  if (existsSync(s)) copyFileSync(s, join(APP, 'pgsql/bin', dll));
}
mkdirSync(join(PKG, 'node'), { recursive: true });
copyFileSync(process.execPath, join(PKG, 'node/node.exe'));

step('สคริปต์ติดตั้ง/เปิด/ปิด + ไอคอน');
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const bom = '\ufeff';   // Windows PowerShell 5.1 อ่านภาษาไทยในสคริปต์ถูกเมื่อมี BOM
for (const f of ['install.ps1', 'uninstall.ps1']) writeFileSync(join(PKG, f), bom + crlf(readFileSync(join(HERE, f), 'utf8')));
for (const f of ['Buddy Account.cmd', 'Stop Buddy Account.cmd']) writeFileSync(join(PKG, f), crlf(readFileSync(join(HERE, f), 'utf8')));
writeFileSync(join(APP, 'buddy.ico'), icon());
writeFileSync(join(APP, 'version.json'), JSON.stringify({ version, commit, built: new Date().toISOString(), node: process.version }, null, 2));
writeFileSync(join(PKG, 'อ่านก่อน.txt'), bom + crlf(readFileSync(join(HERE, 'README.txt'), 'utf8').replace('{version}', version)));

const size = (p) => { const s = statSync(p); return s.isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : s.size; };
step(`โฟลเดอร์โปรแกรม ${(size(PKG) / 1048576).toFixed(0)} MB`);

step('บีบอัดเป็น zip');
const zip = join(OUT, `BuddyAccount-${version}.zip`);
rmSync(zip, { force: true });
// tar ของ Windows (bsdtar) สร้าง zip ได้ — ไม่ใช้ tar ของ Git ที่ทำ zip ไม่ได้
execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', OUT, 'BuddyAccount'], { stdio: 'inherit' });
step(`${zip} (${(statSync(zip).size / 1048576).toFixed(0)} MB)`);

if (!args.has('--no-exe')) {
  step('สร้างไฟล์ติดตั้ง .exe (IExpress)');
  const stage = join(OUT, 'stage');
  rmSync(stage, { recursive: true, force: true }); mkdirSync(stage);
  copyFileSync(zip, join(stage, 'BuddyAccount.zip'));
  writeFileSync(join(stage, 'setup.cmd'), crlf(readFileSync(join(HERE, 'setup.cmd'), 'utf8')));
  const exe = join(OUT, `BuddyAccount-${version}.exe`);
  const sed = join(OUT, 'buddy.sed');
  writeFileSync(sed, crlf(`[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=${exe}
FriendlyName=Buddy Account ${version}
AppLaunched=cmd /c setup.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="setup.cmd"
FILE1="BuddyAccount.zip"
[SourceFiles]
SourceFiles0=${stage}\\
[SourceFiles0]
%FILE0%=
%FILE1%=
`));
  rmSync(exe, { force: true });
  spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'iexpress.exe'), ['/N', '/Q', sed], { stdio: 'inherit' });
  if (!existsSync(exe)) throw new Error('IExpress สร้างไฟล์ .exe ไม่สำเร็จ — ใช้ไฟล์ zip แทนได้ (แตกไฟล์แล้วคลิกขวา install.ps1 > Run with PowerShell)');
  rmSync(stage, { recursive: true, force: true }); rmSync(sed, { force: true });
  step(`${exe} (${(statSync(exe).size / 1048576).toFixed(0)} MB)`);
}
console.log(`เสร็จ — รุ่น ${version}`);

/** ไอคอน 256×256 (PNG ใน ICO): สี่เหลี่ยมมุมมนสีพาสเทล + หน้าบัญชี */
function icon() {
  const N = 256, px = Buffer.alloc(N * N * 4);
  const set = (x, y, [r, g, b, a = 255]) => { const i = (y * N + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  const inRound = (x, y, x0, y0, x1, y1, rad) => {
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad), cy = Math.min(Math.max(y, y0 + rad), y1 - rad);
    return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let c = [0, 0, 0, 0];
    if (inRound(x, y, 8, 8, 247, 247, 48)) c = [126, 200, 180];                      // พื้นเขียวมิ้นต์
    if (inRound(x, y, 64, 44, 192, 212, 14)) c = [255, 255, 255];                     // หน้ากระดาษ
    if (x >= 84 && x <= 172 && [84, 116, 148].some((l) => y >= l && y < l + 12)) c = [92, 150, 196];   // บรรทัดรายการ
    if (x >= 120 && x <= 172 && y >= 176 && y < 190) c = [232, 140, 120];             // เส้นยอดรวม
    set(x, y, c);
  }
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);       // ICO, 1 ภาพ
  head[6] = 0; head[7] = 0; head[8] = 0; head[9] = 0; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}
