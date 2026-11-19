#!/usr/bin/env node
// ตั้งค่าสำเนาสำรองนอกเครื่อง (HANDOFF 146) — ใช้คู่กับ tools/cloud/backup.mjs (งานตั้งเวลา "WTS cloud backup")
//
//   node tools/cloud/setup-offsite.mjs --status                     ดูค่าที่ตั้งไว้ (ไม่แสดงกุญแจ)
//   node tools/cloud/setup-offsite.mjs --folder "D:\WTS-Backup-offsite"
//                                     ตั้งโฟลเดอร์ที่สอง (ไดรฟ์ภายนอก / โฟลเดอร์ OneDrive ที่เลือกเอง) · สร้างกุญแจครั้งแรก · ทดสอบเขียน/อ่าน
//   node tools/cloud/setup-offsite.mjs --export-key "F:\"           คัดลอกกุญแจไปเก็บนอกเครื่อง (USB) — ไม่มีกุญแจ = เปิดสำเนานอกเครื่องไม่ได้
//   node tools/cloud/setup-offsite.mjs --no-folder                  เลิกใช้โฟลเดอร์ที่สอง
// R2: ใส่กุญแจด้วย powershell -ExecutionPolicy Bypass -File tools\cloud\set-r2-keys.ps1 (ขั้น "สำรองนอกเครื่อง") แล้วรัน --status
// ไม่พิมพ์กุญแจ/รหัสลงจอ · ไม่แตะไฟล์อื่นในโฟลเดอร์ปลายทาง (สร้างเฉพาะโฟลเดอร์ชุดสำรองและไฟล์ทดสอบชั่วคราว)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, keyId, loadKey, newKeyFile, offsiteConfig, OFFSITE_KEEP_DAYS } from './offsite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CFG = join(ROOT, '.data/backup-offsite.json');
const argv = process.argv.slice(2);
const argOf = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
const readCfg = () => (existsSync(CFG) ? JSON.parse(readFileSync(CFG, 'utf8')) : {});
const writeCfg = (c) => writeFileSync(CFG, `${JSON.stringify(c, null, 2)}\n`);
const readEnv = (f) => Object.fromEntries(readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]));
const fail = (m) => { console.log(`✗ ${m}`); process.exit(1); };

function status() {
  const envFile = join(ROOT, '.data/cloud-prod.env');
  const oc = offsiteConfig(ROOT, existsSync(envFile) ? readEnv(envFile) : {});
  const key = loadKey(oc.keyFile);
  console.log(`กุญแจ: ${key ? `มี (รหัส ${keyId(key)}) — ${oc.keyFile}` : 'ยังไม่มี (สร้างให้เมื่อตั้ง --folder หรือมีกุญแจ R2)'}`);
  if (!oc.targets.length) console.log('ที่เก็บนอกเครื่อง: ยังไม่ได้ตั้ง — ไฟล์สำรองอยู่ในเครื่องนี้เครื่องเดียว');
  for (const t of oc.targets) console.log(`ที่เก็บนอกเครื่อง: ${t.label} · เก็บ ${oc.keepDays} วัน`);
  return { oc, key };
}

if (argv.includes('--folder')) {
  const folder = argOf('--folder');
  if (!folder) fail('ระบุโฟลเดอร์ เช่น --folder "D:\\WTS-Backup-offsite"');
  const abs = resolve(folder);
  if (abs.toLowerCase().startsWith(resolve('E:/WTS-Backup/cloud').toLowerCase())) fail('โฟลเดอร์ที่สองต้องไม่อยู่ในโฟลเดอร์สำรองหลัก E:\\WTS-Backup\\cloud');
  if (!existsSync(dirname(abs))) fail(`ไม่พบ ${dirname(abs)} — เสียบไดรฟ์/ตรวจชื่อก่อน`);
  mkdirSync(abs, { recursive: true });
  if (!statSync(abs).isDirectory()) fail(`${abs} ไม่ใช่โฟลเดอร์`);
  const cfg = readCfg();
  const keyFile = join(ROOT, cfg.key_file ?? '.data/backup-offsite.key');
  const key = loadKey(keyFile) ?? newKeyFile(keyFile);
  // ทดสอบเขียน → อ่าน → ถอดรหัส แล้วลบไฟล์ทดสอบ
  const probe = join(abs, `.wts-offsite-test-${randomBytes(4).toString('hex')}.enc`);
  const data = randomBytes(64);
  writeFileSync(probe, encrypt(key, data));
  const ok = decrypt(key, readFileSync(probe)).equals(data);
  rmSync(probe, { force: true });
  if (!ok) fail('เขียนแล้วอ่านกลับไม่ตรง — ใช้โฟลเดอร์อื่น');
  writeCfg({ ...cfg, folder: abs, keep_days: cfg.keep_days ?? OFFSITE_KEEP_DAYS });
  console.log(`✓ ตั้งโฟลเดอร์ที่สองแล้ว: ${abs} (ทดสอบเขียน/อ่านผ่าน) · กุญแจรหัส ${keyId(key)}`);
  console.log('ขั้นต่อไป: คัดลอกกุญแจไปเก็บนอกเครื่อง — node tools/cloud/setup-offsite.mjs --export-key "<ไดรฟ์ USB>"');
} else if (argv.includes('--no-folder')) {
  const cfg = readCfg(); delete cfg.folder; writeCfg(cfg);
  console.log('✓ เลิกใช้โฟลเดอร์ที่สองแล้ว (สำเนาเดิมในโฟลเดอร์นั้นไม่ถูกลบ)');
} else if (argv.includes('--export-key')) {
  const to = argOf('--export-key');
  if (!to || !existsSync(to)) fail('ระบุโฟลเดอร์/ไดรฟ์ที่มีอยู่ เช่น --export-key "F:\\"');
  const { oc, key } = status();
  if (!key) fail('ยังไม่มีกุญแจ — ตั้ง --folder หรือกุญแจ R2 ก่อน');
  const dest = join(resolve(to), `WTS-backup-offsite-${keyId(key)}.key`);
  if (existsSync(dest)) fail(`มีไฟล์ ${dest} อยู่แล้ว`);
  copyFileSync(oc.keyFile, dest);
  console.log(`✓ คัดลอกกุญแจไปที่ ${dest} แล้ว — เก็บแยกจากเครื่องนี้ (ใครได้กุญแจ + สำเนา = เปิดข้อมูลได้)`);
} else {
  const { oc, key } = status();
  if (!key && oc.targets.some((t) => t.kind === 'r2')) { newKeyFile(oc.keyFile); console.log('สร้างกุญแจใหม่แล้ว — คัดลอกไปเก็บด้วย --export-key'); }
}
