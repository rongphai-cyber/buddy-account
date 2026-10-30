// สร้างข้อมูลทดลองทั้งปี 2569 (1 ม.ค. – 31 ธ.ค. 2026) ให้บริษัท DEMO ผ่าน API ทั้งหมด (กฎลงบัญชีเหมือนบันทึกจากหน้าจอ) แล้วตรวจความถูกต้อง
// ใช้กับฐานสำเนา buddy_smoke เท่านั้น — ต้องมี server ของสำเนาเปิดอยู่ (ค่าเริ่มต้น http://127.0.0.1:4103, BUDDY_REQUIRE_ADMIN_2FA=0)
// ฐานหลัก (ข้อมูลทดลองทั้งหมด): ใส่ SEED_LIVE=1 และเปิด server ของฐานหลักที่พอร์ตอื่นที่ไม่ใช่ 4100 (สำรองฐานก่อนด้วย db-backup.mjs save)
// และต้องไม่มีบริษัท DEMO อยู่ก่อน (ล้างด้วย tools/demo-check/wipe-company.mjs DEMO --yes)
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/smoke-copy.mjs run -- node tools/demo-check/seed-year.mjs
// ผู้ใช้ที่ใช้ใส่ข้อมูล: demo.seed (รหัสผ่านอ่านจาก .data/ข้อมูลเข้าระบบ-ผู้ใส่ข้อมูลทดลอง.txt — ไม่พิมพ์ออกจอ)
// ผู้ใช้ทดลองที่สร้าง (sale1, acc1): รหัสผ่านเก็บใน .data/ข้อมูลเข้าระบบ-ผู้ใช้ทดลอง.txt เท่านั้น
// ทุกการเขียนผ่าน API · การอ่านฐานข้อมูลใช้เฉพาะตอนตรวจท้ายสคริปต์ · สุ่มแบบกำหนดเมล็ด (รันซ้ำได้ผลเหมือนเดิม)
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'file:///E:/BuddyAccount/apps/server/node_modules/pg/lib/index.js';
import Decimal from 'file:///E:/BuddyAccount/packages/core/node_modules/decimal.js/decimal.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4103';
if (/:4100\b/.test(BASE)) { console.error('ห้ามใช้กับ server จริง (พอร์ต 4100)'); process.exit(2); }
if (process.env.SEED_LIVE !== '1' && !process.env.DATABASE_URL?.includes('buddy_smoke')) { console.error('ใช้กับสำเนา buddy_smoke (รันผ่าน smoke-copy.mjs run --) หรือใส่ SEED_LIVE=1 สำหรับฐานหลัก'); process.exit(2); }
const SEED_FILE = 'E:/BuddyAccount/.data/ข้อมูลเข้าระบบ-ผู้ใส่ข้อมูลทดลอง.txt';
const USERS_FILE = 'E:/BuddyAccount/.data/ข้อมูลเข้าระบบ-ผู้ใช้ทดลอง.txt';
const CO_CODE = 'DEMO';
const T0 = Date.now();

/* ------------------------------------------------------------------ เครื่องมือ */
const D = (x) => new Decimal(x ?? 0);
const m2 = (x) => D(x).toDecimalPlaces(2).toFixed(2);
const pad = (n) => String(n).padStart(2, '0');
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20260101);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const rf = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const lastDay = (m) => new Date(Date.UTC(2026, m, 0)).getUTCDate();
const monthEnd = (m) => `2026-${pad(m)}-${pad(lastDay(m))}`;
const monthStart = (m) => `2026-${pad(m)}-01`;
const addDays = (iso, n) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
/** วันทำงานในเดือน (เสาร์/อาทิตย์เลื่อนเป็นวันทำงานที่ใกล้ที่สุดในเดือนเดียวกัน) */
function wday(m, d) {
  d = Math.min(Math.max(d, 1), lastDay(m));
  const t = new Date(Date.UTC(2026, m - 1, d));
  const w = t.getUTCDay();
  if (w === 6) t.setUTCDate(d + 2 <= lastDay(m) ? d + 2 : d - 1);
  else if (w === 0) t.setUTCDate(d + 1 <= lastDay(m) ? d + 1 : d - 2);
  return t.toISOString().slice(0, 10);
}
const monthOf = (iso) => Number(iso.slice(5, 7));
function taxId(base12) { let s = 0; for (let i = 0; i < 12; i++) s += Number(base12[i]) * (13 - i); return base12 + ((11 - (s % 11)) % 10); }
function ean13(base12) { let s = 0; for (let i = 0; i < 12; i++) s += Number(base12[i]) * (i % 2 ? 3 : 1); return base12 + ((10 - (s % 10)) % 10); }

/* ------------------------------------------------------------------ เรียก API */
let cookie = '';
const stats = new Map();   // "METHOD path" → { ok, fail }
const failures = [];
const warningsSeen = [];
const keyOf = (method, path) => `${method} ${path.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`;
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
/** ต้องสำเร็จ (ใช้ตอนตั้งค่า) — ล้ม = หยุดทั้งสคริปต์ */
async function ok(method, path, body) {
  const r = await call(method, path, body);
  const k = keyOf(method, path); const s = stats.get(k) ?? { ok: 0, fail: 0 }; stats.set(k, s);
  if (r.status !== 200) { s.fail++; throw new Error(`${method} ${path} → ${r.status} ${r.body?.error?.message ?? JSON.stringify(r.body).slice(0, 300)}`); }
  s.ok++;
  if (r.body?.warnings?.length) warningsSeen.push(...r.body.warnings.map((w) => `${path}: ${w}`));
  return r.body;
}
/** ล้มได้ (รายการประจำวัน) — บันทึกไว้ในรายการล้มเหลวแล้วทำต่อ */
async function tryOk(label, method, path, body) {
  try { return await ok(method, path, body); }
  catch (e) { failures.push({ label, error: e.message, body: body === undefined ? undefined : JSON.stringify(body).slice(0, 600) }); console.log(`  ✗ ${label}: ${e.message}`); return null; }
}
const get = (path) => ok('GET', path);

/* ------------------------------------------------------------------ ตัวจัดตารางงานตามวันที่ */
const tasks = [];
let seq = 0;
function at(date, prio, label, fn) { if (date > '2026-12-31') return; tasks.push({ date, prio, seq: seq++, label, fn }); }
async function runUntil(limit) {
  for (;;) {
    let bi = -1;
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.date > limit) continue;
      if (bi < 0) { bi = i; continue; }
      const b = tasks[bi];
      if (t.date < b.date || (t.date === b.date && (t.prio < b.prio || (t.prio === b.prio && t.seq < b.seq)))) bi = i;
    }
    if (bi < 0) return;
    const [t] = tasks.splice(bi, 1);
    try { await t.fn(t.date); } catch (e) { failures.push({ label: `${t.date} ${t.label}`, error: e.message }); console.log(`  ✗ ${t.date} ${t.label}: ${e.message}`); }
  }
}

/* ================================================================== 0. เข้าระบบ + สร้างบริษัท */
const seedPass = readFileSync(SEED_FILE, 'utf8').match(/รหัสผ่าน:\s*(\S+)/)?.[1];
if (!seedPass) { console.error('อ่านรหัสผ่าน demo.seed ไม่ได้'); process.exit(2); }
await ok('POST', '/api/v1/auth/login', { username: 'demo.seed', password: seedPass, work_date: '2026-10-30' });
const tenants = await get('/api/v1/tenants');
const tenant = tenants.find((t) => t.code === CO_CODE);
if (!tenant) throw new Error('ไม่พบลูกค้าผู้ใช้บริการรหัส DEMO');
let me = await get('/api/v1/auth/me');
if (me.companies?.some((c) => c.code === CO_CODE)) { console.error('มีบริษัท DEMO อยู่แล้ว — ล้างก่อนด้วย wipe-company.mjs DEMO --yes'); process.exit(2); }
console.log('▶ สร้างบริษัท DEMO');
const coId = (await ok('POST', '/api/v1/companies', { code: CO_CODE, name_th: 'บริษัท บัดดี้ เทรดดิ้ง (ทดลอง) จำกัด', fiscal_start: '2026-01-01', chart: 'th_en', tenant_id: tenant.id })).id;
await ok('POST', '/api/v1/auth/select', { company_id: coId, work_date: '2026-10-30' });

const COMPANY_TAX = taxId('010555904127');
await ok('PUT', '/api/v1/company', {
  name_th: 'บริษัท บัดดี้ เทรดดิ้ง (ทดลอง) จำกัด', name_en: 'Buddy Trading (Demo) Co., Ltd.',
  address_th_1: '88/8 อาคารบัดดี้ทาวเวอร์ ชั้น 5 ถนนสุขุมวิท 71', address_th_2: 'แขวงพระโขนงเหนือ เขตวัฒนา กรุงเทพมหานคร 10110',
  address_en_1: '88/8 Buddy Tower 5th Floor, Sukhumvit 71 Road', address_en_2: 'Phra Khanong Nuea, Watthana, Bangkok 10110',
  phone: '02-711-8899', business_type: 'J', tax_id: COMPANY_TAX, tax_branch_no: '0', branch_short_name: 'สนญ.', allow_blank_party_tax_id: true,
  trade_reg_no: '0105559041271', social_security_no: '1000123456', year_system: 'B', vat_rate: 7, account_mask: '9999-99', voucher_numbering: '4', use_department: true,
});

/* ================================================================== 1. ตั้งค่า */
console.log('▶ ตั้งค่าระบบ');
let accounts = await get('/api/v1/gl/accounts');
const accBy = () => new Map(accounts.map((a) => [a.account_no, a]));
let ACC = accBy();
async function addAccount(no, th, en, parentNo) {
  const p = ACC.get(parentNo);
  await ok('POST', '/api/v1/gl/accounts', { account_no: no, name_th: th, name_en: en, parent_id: p.id, level: p.level + 1, account_group: p.account_group, is_control: false });
}
await addAccount('1113-02', 'บัญชีเงินฝากออมทรัพย์ ธนาคารกสิกรไทย 045-2-88123-4', 'Savings Deposit – Kasikornbank 045-2-88123-4', '1113-00');
await addAccount('4400-03', 'รายได้ค่าบริการติดตั้งและบำรุงรักษา', 'Installation and Maintenance Service Revenue', '4400-00');
accounts = await get('/api/v1/gl/accounts'); ACC = accBy();
const A = (no) => { const a = ACC.get(no); if (!a) throw new Error(`ไม่พบบัญชี ${no}`); return a.id; };

// แผนก
const DEPTS = [['01', 'ฝ่ายบริหาร', 'Administration', 'บริหาร', 'ADM'], ['02', 'ฝ่ายขาย', 'Sales', 'ขาย', 'SAL'], ['03', 'ฝ่ายบัญชีและการเงิน', 'Accounting & Finance', 'บัญชี', 'ACC'], ['04', 'ฝ่ายคลังสินค้า', 'Warehouse', 'คลัง', 'WH']];
for (const [code, th, en, sth, sen] of DEPTS) await ok('POST', '/api/v1/departments', { code, name_th: th, name_en: en, short_name_th: sth, short_name_en: sen });
const DEP = Object.fromEntries((await get('/api/v1/departments')).map((d) => [d.code, d.id]));

// สาขา (เพิ่มสาขาบางนา)
await tryOk('สาขา', 'POST', '/api/v1/branches', { code: 'BN', name: 'สาขาบางนา', tax_branch_no: '00001', address: '199/9 ถนนบางนา-ตราด กม.3 แขวงบางนาใต้ เขตบางนา กรุงเทพมหานคร 10260' });

// ตารางข้อมูล
const TBL = {
  '01': [['BBL', 'ธนาคารกรุงเทพ', 'Bangkok Bank', 'กรุงเทพ'], ['KBANK', 'ธนาคารกสิกรไทย', 'Kasikornbank', 'กสิกร'], ['KTB', 'ธนาคารกรุงไทย', 'Krungthai Bank', 'กรุงไทย'], ['SCB', 'ธนาคารไทยพาณิชย์', 'Siam Commercial Bank', 'ไทยพาณิชย์'], ['BAY', 'ธนาคารกรุงศรีอยุธยา', 'Bank of Ayudhya', 'กรุงศรี'], ['TTB', 'ธนาคารทหารไทยธนชาต', 'TMBThanachart Bank', 'ทีทีบี'], ['GSB', 'ธนาคารออมสิน', 'Government Savings Bank', 'ออมสิน']],
  '02': [['00', 'เช็คในมือ', 'On hand'], ['01', 'นำฝาก/รอเรียกเก็บ', 'Deposited'], ['02', 'เช็คคืนยื่นใหม่', 'Returned – re-present'], ['05', 'จ่ายแล้วรอผ่าน', 'Issued'], ['10', 'ผ่านแล้ว', 'Cleared'], ['20', 'เช็คคืน', 'Returned']],
  '20': [['PCS', 'ชิ้น', 'Piece', 'ชิ้น', null], ['REAM', 'รีม', 'Ream', 'รีม', null], ['PACK', 'แพ็ค', 'Pack', 'แพ็ค', null], ['BTL', 'ขวด', 'Bottle', 'ขวด', null], ['ROLL', 'ม้วน', 'Roll', 'ม้วน', null],
    ['BOX', 'กล่อง (12 ชิ้น)', 'Box of 12', 'กล่อง', 12], ['DZ', 'โหล', 'Dozen', 'โหล', 12], ['CTN', 'ลัง (5 รีม)', 'Carton of 5', 'ลัง', 5], ['SET', 'ชุด', 'Set', 'ชุด', null], ['JOB', 'งาน', 'Job', 'งาน', null], ['MON', 'เดือน', 'Month', 'เดือน', null], ['TRIP', 'เที่ยว', 'Trip', 'เที่ยว', null]],
  '21': [['01', 'คลังสินค้าสำนักงานใหญ่', 'Head Office Warehouse', 'คลัง สนญ.'], ['02', 'คลังสินค้าสาขาบางนา', 'Bang Na Branch Warehouse', 'คลังบางนา']],
  '22': [['PAP', 'กระดาษและซอง', 'Paper & Envelopes'], ['STA', 'เครื่องเขียน', 'Stationery'], ['ITA', 'อุปกรณ์ไอที', 'IT Accessories'], ['PRN', 'เครื่องพิมพ์และหมึก', 'Printers & Ink'], ['BEV', 'เครื่องดื่มสำนักงาน', 'Office Beverages'], ['CLN', 'ของใช้ทำความสะอาด', 'Cleaning Supplies'], ['SET', 'สินค้าชุด', 'Kits & Sets'], ['SRV', 'บริการ', 'Services']],
  '23': [['1', 'ชุดระดับ 1 (ประกอบจากสินค้าทั่วไป)', 'Kit level 1']],
  '40': [['BKK', 'กรุงเทพฯ ชั้นใน', 'Inner Bangkok'], ['BKO', 'กรุงเทพฯ ชั้นนอก', 'Outer Bangkok'], ['NBI', 'นนทบุรี-ปทุมธานี', 'Nonthaburi-Pathum Thani'], ['SPK', 'สมุทรปราการ-บางนา', 'Samut Prakan-Bang Na'], ['EST', 'ภาคตะวันออก', 'Eastern Region']],
  '41': [['OWN', 'รถบริษัท', 'Company truck'], ['KRY', 'เคอรี่ เอ็กซ์เพรส', 'Kerry Express'], ['FLS', 'แฟลช เอ็กซ์เพรส', 'Flash Express'], ['PCK', 'ลูกค้ารับเอง', 'Customer pick-up']],
  '42': [['01', 'ลูกค้ายกเลิกคำสั่งซื้อ', 'Customer cancelled'], ['02', 'สินค้าหมด/เลิกผลิต', 'Out of stock / discontinued'], ['03', 'ลูกค้าเปลี่ยนรุ่นสินค้า', 'Customer changed model']],
  '43': [['01', 'ผู้จำหน่ายส่งของไม่ครบ', 'Supplier short shipment'], ['02', 'ยกเลิกเพราะราคาเปลี่ยน', 'Price changed'], ['03', 'สั่งเกินความต้องการ', 'Over-ordered']],
  '44': [['1', 'รอลูกค้าพิจารณา', 'Pending'], ['2', 'ลูกค้าอนุมัติ (ได้งาน)', 'Won'], ['3', 'ไม่ได้งาน', 'Lost']],
  '45': [['CORP', 'บริษัทเอกชน', 'Private company'], ['GOV', 'หน่วยงานราชการ/รัฐวิสาหกิจ', 'Government'], ['EDU', 'สถานศึกษา', 'Education'], ['MED', 'สถานพยาบาล', 'Healthcare'], ['SHOP', 'ร้านค้าปลีก/บุคคล', 'Retail / individual']],
  '46': [['MFG', 'ผู้ผลิต', 'Manufacturer'], ['DIS', 'ตัวแทนจำหน่าย', 'Distributor'], ['SRV', 'ผู้ให้บริการ', 'Service provider'], ['UTL', 'สาธารณูปโภค', 'Utilities'], ['IND', 'บุคคลธรรมดา', 'Individual']],
  '47': [['IN', 'พนักงานขายในสำนักงาน', 'Inside sales'], ['OUT', 'พนักงานขายภาคสนาม', 'Field sales']],
  '51': [['01', 'สินค้าซื้อแล้วไม่รับเปลี่ยนหรือคืน ยกเว้นสินค้ามีตำหนิจากผู้ผลิต', 'No return except defects'], ['02', 'กรุณาสั่งจ่ายเช็คขีดคร่อมในนาม บริษัท บัดดี้ เทรดดิ้ง (ทดลอง) จำกัด', 'Crossed cheque payable to company'], ['03', 'ราคานี้ยืนราคา 30 วัน', 'Price valid 30 days']],
  '52': [['COM', 'คอมพิวเตอร์', 'Computers'], ['FUR', 'เฟอร์นิเจอร์และเครื่องตกแต่ง', 'Furniture & fixtures'], ['OFE', 'อุปกรณ์สำนักงาน', 'Office equipment'], ['VEH', 'ยานพาหนะ', 'Vehicles']],
  '53': [['W', 'รอเบิกชดเชย', 'Waiting'], ['R', 'เบิกชดเชยแล้ว', 'Reimbursed']],
  '55': [['S03', 'ภ.ง.ด.3 (บุคคลธรรมดา)', 'PND 3 (individual)'], ['S53', 'ภ.ง.ด.53 (นิติบุคคล)', 'PND 53 (juristic person)']],
  '60': [['2026A', 'คอลเลกชันต้นปี 2569', 'Early 2026 collection'], ['2026B', 'คอลเลกชันปลายปี 2569', 'Late 2026 collection']],
  '61': [['C100', 'ต้นทุนสินค้า', 'Goods cost'], ['C200', 'ต้นทุนบริการ', 'Service cost']],
};
for (const [code, rows] of Object.entries(TBL)) {
  await ok('PUT', `/api/v1/data-tables/${code}`, { rows: rows.map(([c, th, en, sth, rate]) => ({ code: c, name_th: th, name_en: en ?? null, short_th: sth ?? null, rate: rate ?? null })) });
}
const tbl = async (code) => Object.fromEntries((await get(`/api/v1/data-tables/${code}`)).map((r) => [r.code, r.id]));
const BANK = await tbl('01'), UNIT = await tbl('20'), WH = await tbl('21');

// กลุ่มบัญชีสินค้า
const IAG = {};
for (const [code, th, en, cm] of [['GD', 'สินค้าสำเร็จรูป (ถัวเฉลี่ย)', 'Finished goods (average)', 'A'], ['GF', 'หมึกพิมพ์และเครื่องพิมพ์ (FIFO)', 'Printers & toner (FIFO)', 'F']]) {
  IAG[code] = (await ok('POST', '/api/v1/item-account-groups', { code, name_th: th, name_en: en, cost_method: cm, inventory_account_id: A('1140-02'), cogs_account_id: A('5110-00'),
    sales_account_id: A('4100-01'), sales_return_account_id: A('4100-03'), purchase_account_id: A('5130-01'), purchase_return_account_id: A('5130-03') })).id;
}

// บัญชีเงินฝาก
const BANKACC_DEF = [
  { code: 'B01', name: 'ธนาคารกรุงเทพ กระแสรายวัน สาขาสีลม', bank: 'BBL', branch: 'สีลม', account_number: '101-3-45678-9', short_name: 'BBL-CA', kind: 'C', gl: '1112-00', open: '1850000.00' },
  { code: 'B02', name: 'ธนาคารกสิกรไทย ออมทรัพย์ สาขาสุขุมวิท 71', bank: 'KBANK', branch: 'สุขุมวิท 71', account_number: '045-2-88123-4', short_name: 'KBANK-SA', kind: 'S', gl: '1113-02', open: '2400000.00' },
  { code: 'B03', name: 'ธนาคารกรุงไทย ออมทรัพย์ สาขาพระโขนง', bank: 'KTB', branch: 'พระโขนง', account_number: '501-0-74167-9', short_name: 'KTB-SA', kind: 'S', gl: '1113-01', open: '650000.00' },
];
const BA = {};
for (const b of BANKACC_DEF) BA[b.code] = { id: (await ok('POST', '/api/v1/bank-accounts', { code: b.code, name: b.name, bank_id: BANK[b.bank], branch: b.branch, account_number: b.account_number, short_name: b.short_name, account_kind: b.kind, gl_account_id: A(b.gl), opening_balance: b.open, opening_date: '2026-01-01' })).id, gl: b.gl, def: b };

// วิธีรับ/จ่ายชำระ
await ok('PUT', '/api/v1/payment-methods/R', { rows: [
  { seq: '01', code: 'CA', name_th: 'เงินสด', name_en: 'Cash', kind: 'CASH', gl_account_id: A('1111-01') },
  { seq: '02', code: 'CQ', name_th: 'เช็ครับ', name_en: 'Cheque received', kind: 'CHEQUE', creates_cheque: true, gl_account_id: A('1130-02') },
  { seq: '03', code: 'TK', name_th: 'เงินโอนเข้า กสิกรไทย', name_en: 'Transfer in – KBank', kind: 'TRANSFER', bank_account_id: BA.B02.id },
  { seq: '04', code: 'TB', name_th: 'เงินโอนเข้า กรุงเทพ', name_en: 'Transfer in – BBL', kind: 'TRANSFER', bank_account_id: BA.B01.id },
] });
await ok('PUT', '/api/v1/payment-methods/P', { rows: [
  { seq: '01', code: 'CA', name_th: 'เงินสด', name_en: 'Cash', kind: 'CASH', gl_account_id: A('1111-01') },
  { seq: '02', code: 'CQ', name_th: 'เช็คจ่าย ธนาคารกรุงเทพ', name_en: 'Cheque – BBL', kind: 'CHEQUE', creates_cheque: true, gl_account_id: A('2120-02'), bank_account_id: BA.B01.id },
  { seq: '03', code: 'TK', name_th: 'เงินโอนออก กสิกรไทย', name_en: 'Transfer out – KBank', kind: 'TRANSFER', bank_account_id: BA.B02.id },
  { seq: '04', code: 'TB', name_th: 'เงินโอนออก กรุงเทพ', name_en: 'Transfer out – BBL', kind: 'TRANSFER', bank_account_id: BA.B01.id },
] });
const PMR = Object.fromEntries((await get('/api/v1/payment-methods/R')).map((p) => [p.code, p.id]));
const PMP = Object.fromEntries((await get('/api/v1/payment-methods/P')).map((p) => [p.code, p.id]));

// ค่าเริ่มต้นแต่ละระบบ
await ok('PUT', '/api/v1/settings', { values: {
  'ic.main_warehouse': '01', 'gen.vat_rate': 7, 'gen.price_type': '2', 'ar.service_vat_basis': '1', 'fa.depreciate_on_entry': 'false', 'fa.depreciate_monthly': 'true',
  'fn.default_deposit_bank': 'B01', 'fn.default_paid_bank': 'B01', 'fn.wht_min_amount': 1000, 'fn.wht_default_rate': 3, 'fn.social_security_no': '1000123456', 'fn.compensation_fund_no': '1000123456',
  'ic.use_barcode': true, 'ic.allow_negative': 'N', 'ic.negative_check_level': '1', 'ar.warn_below_cost': true, 'ar.allow_over_credit': false, 'ic.warn_below_reorder': true,
} });

// เอกสาร/สมุด
const DT = {};
for (const t of await get('/api/v1/doc-types')) { DT[t.code] = t.id; if (!DT['cls:' + t.doc_class]) DT['cls:' + t.doc_class] = t.id; }
const dt = (cls) => { const v = DT['cls:' + cls]; if (!v) throw new Error(`ไม่มีประเภทเอกสาร ${cls}`); return v; };
const BOOK = Object.fromEntries((await get('/api/v1/gl/books')).map((b) => [b.code, b.id]));
const PERIODS = (await get('/api/v1/gl/periods')).find((y) => String(y.start_date).slice(0, 10) === '2026-01-01').periods;
const FY2026 = (await get('/api/v1/gl/periods')).find((y) => String(y.start_date).slice(0, 10) === '2026-01-01').id;
const periodId = (m) => PERIODS.find((p) => p.period_no === m).id;

// ต้นแบบวิธีการบันทึก (GL.TPL)
await ok('POST', '/api/v1/gl/templates', { code: 'SALARY', name: 'บันทึกเงินเดือนประจำเดือน', name_en: 'Monthly payroll', lines: [
  { account_id: A('5411-01'), side: 'D', description: 'เงินเดือนฝ่ายบริหาร/บัญชี/คลัง', amount: '0' }, { account_id: A('5300-11'), side: 'D', description: 'เงินเดือนฝ่ายขาย', amount: '0' },
  { account_id: A('5412-14'), side: 'D', description: 'เงินสมทบประกันสังคม (นายจ้าง)', amount: '0' }, { account_id: A('2131-04'), side: 'C', description: 'ประกันสังคมรอนำส่ง', amount: '0' },
  { account_id: A('2132-01'), side: 'C', description: 'ภาษีหัก ณ ที่จ่าย ภ.ง.ด.1', amount: '0' }, { account_id: A('1112-00'), side: 'C', description: 'จ่ายเงินเดือนสุทธิ', amount: '0' } ] });
await ok('POST', '/api/v1/gl/templates', { code: 'VATPAY', name: 'นำส่งภาษีมูลค่าเพิ่ม (ภ.พ.30)', name_en: 'VAT remittance', lines: [
  { account_id: A('2137-00'), side: 'D', description: 'เจ้าหนี้กรมสรรพากร', amount: '0' }, { account_id: A('1112-00'), side: 'C', description: 'จ่ายชำระภาษี', amount: '0' } ] });
await ok('POST', '/api/v1/gl/templates', { code: 'LOAN', name: 'ผ่อนชำระเงินกู้ธนาคารรายเดือน', name_en: 'Monthly loan installment', lines: [
  { account_id: A('2210-00'), side: 'D', description: 'เงินต้น', amount: '25000' }, { account_id: A('5470-03'), side: 'D', description: 'ดอกเบี้ยจ่าย', amount: '0' }, { account_id: A('1112-00'), side: 'C', description: 'ตัดบัญชีกระแสรายวัน', amount: '0' } ] });

// ผู้ใช้ทดลอง + กลุ่ม + สิทธิ์
const TEST_USERS = [];
{
  const ul = await get('/api/v1/users');
  const groups = Object.fromEntries((ul.groups ?? []).map((g) => [g.code, g.id]));
  for (const [code, name] of [['DEMO-SALES', 'ฝ่ายขาย (บริษัททดลอง)'], ['DEMO-ACCT', 'ฝ่ายบัญชี (บริษัททดลอง)']])
    if (!groups[code]) groups[code] = (await ok('POST', '/api/v1/user-groups', { code, name, tenant_id: tenant.id })).id;
  const creds = [];
  for (const [username, display, grp, lvl] of [['sale1', 'พนักงานขาย ทดลอง', 'DEMO-SALES', 0], ['acc1', 'พนักงานบัญชี ทดลอง', 'DEMO-ACCT', 5]]) {
    const pw = 'Demo-' + randomBytes(6).toString('base64url') + '7';
    const body = { username, display_name: display, password: pw, user_group_id: groups[grp], approval_level: lvl, check_rights: true, status: 'A', companies: [coId], tenant_id: tenant.id };
    const cur = (ul.users ?? []).find((u) => u.username === username);
    if (cur) await ok('PUT', `/api/v1/users/${cur.id}`, body); else await ok('POST', '/api/v1/users', body);
    TEST_USERS.push({ username, pw, grp });
    creds.push(`รหัสผู้ใช้: ${username}  (${display}, กลุ่ม ${grp})\nรหัสผ่าน: ${pw}`);
  }
  writeFileSync(USERS_FILE, `ผู้ใช้ทดลองของบริษัท DEMO (สร้างโดย tools/demo-check/seed-year.mjs ${new Date().toISOString().slice(0, 10)}) — ใช้กับข้อมูลทดลองเท่านั้น\n\n${creds.join('\n\n')}\n`, 'utf8');
  const R = (menu_code, v) => ({ menu_code, can_read: '', can_add: '', can_edit: '', can_cancel: '', can_delete: '', can_print: '', can_approve: '', ...v });
  const full = { can_read: 'Y', can_add: 'Y', can_edit: 'Y', can_cancel: 'Y', can_print: 'Y' };
  await ok('PUT', '/api/v1/permissions', { subject_type: 'G', subject_id: groups['DEMO-SALES'], rows: [
    R('SA', full), R('FI.AR.BI', full), R('FI.AR.BD', full), R('FI.AR.DR', full), R('FI.AR.SR', full), R('IC.STOCK', { can_read: 'Y', can_print: 'Y' }), R('IC.ITEM', { can_read: 'Y' }), R('IC.PRICE', { can_read: 'Y' }), R('RP.SA', { can_read: 'Y', can_print: 'Y' }) ] });
  await ok('PUT', '/api/v1/permissions', { subject_type: 'G', subject_id: groups['DEMO-ACCT'], rows: [
    R('PU', full), R('FI', full), R('FI.AR', full), R('FI.AP', full), R('FI.BK', full), R('TX', full), R('GL', { ...full, can_approve: 'Y' }), R('RP', { can_read: 'Y', can_print: 'Y' }), R('IC', { can_read: 'Y', can_print: 'Y' }), R('SA', { can_read: 'Y', can_print: 'S' }) ] });
}

/* ================================================================== 2. แฟ้มหลัก */
console.log('▶ แฟ้มหลัก');
const SLM_DEF = [
  ['SP01', 'นายวิชัย ขายเก่ง', 'ผู้จัดการฝ่ายขาย', 'IN', 'BKK', 1.5, '081-234-5678'],
  ['SP02', 'นางสาวพิมพ์ชนก รุ่งเรือง', 'พนักงานขายภาคสนาม', 'OUT', 'SPK', 2, '089-765-4321'],
  ['SP03', 'นายอนุชา ศรีสวัสดิ์', 'พนักงานขายภาคสนาม', 'OUT', 'EST', 2, '086-555-1212'],
];
const SLM = {};
for (const [i, [code, name, pos, type, area, com, phone]] of SLM_DEF.entries()) {
  const targets = PERIODS.map((p) => ({ period_id: p.id, amount: [420000, 300000, 220000][i] + p.period_no * 5000 }));
  SLM[code] = (await ok('POST', '/api/v1/salespersons', { code, name, position: pos, salesperson_type: type, sales_area_code: area, commission_rate: com, phone, tax_id: taxId(`31012${String(23456 + i * 1111).padStart(7, '0')}`.slice(0, 12)),
    address: 'กรุงเทพมหานคร', fiscal_year_id: FY2026, targets })).id;
}

// ลูกค้า: [รหัส, คำนำหน้า, ชื่อ, ชื่ออังกฤษ, ประเภท, เขต, พนักงานขาย, เครดิต(วัน), วงเงิน, ที่อยู่1, ที่อยู่2, จังหวัด/รหัส, โทร, วิธีรับเงิน]
const CUS_DEF = [
  ['C001', 'บริษัท', 'สยามคอนสตรัคชั่นซัพพลาย จำกัด', 'Siam Construction Supply Co., Ltd.', 'CORP', 'BKK', 'SP01', 30, 1500000, '125 ถนนพระราม 9', 'แขวงห้วยขวาง เขตห้วยขวาง', 'กรุงเทพมหานคร 10310', '02-245-1100', 'CQ'],
  ['C002', 'บริษัท', 'กรีนเอนเนอร์ยี่ โซลูชั่น จำกัด', 'Green Energy Solution Co., Ltd.', 'CORP', 'BKO', 'SP01', 30, 800000, '55/12 ถนนรามอินทรา', 'แขวงคันนายาว เขตคันนายาว', 'กรุงเทพมหานคร 10230', '02-519-2200', 'TK'],
  ['C003', 'บริษัท', 'ไทยพัฒนาการพิมพ์ จำกัด', 'Thai Pattana Printing Co., Ltd.', 'CORP', 'BKK', 'SP01', 45, 1200000, '88 ซอยลาดพร้าว 101', 'แขวงคลองจั่น เขตบางกะปิ', 'กรุงเทพมหานคร 10240', '02-377-8800', 'CQ'],
  ['C004', 'โรงเรียน', 'อนุบาลบ้านรักวิทยา', 'Baan Rak Kindergarten School', 'EDU', 'NBI', 'SP02', 30, 600000, '9/9 ถนนรัตนาธิเบศร์', 'ตำบลบางกระสอ อำเภอเมืองนนทบุรี', 'นนทบุรี 11000', '02-526-3300', 'TK'],
  ['C005', 'บริษัท', 'เมืองทองการบัญชี จำกัด', 'Muang Thong Accounting Co., Ltd.', 'CORP', 'NBI', 'SP02', 30, 800000, '99/1 ถนนแจ้งวัฒนะ', 'ตำบลบ้านใหม่ อำเภอปากเกร็ด', 'นนทบุรี 11120', '02-583-4400', 'TK'],
  ['C006', 'บริษัท', 'แอดวานซ์ เมดิคอล ซัพพลาย จำกัด', 'Advance Medical Supply Co., Ltd.', 'MED', 'BKK', 'SP01', 30, 900000, '300 ถนนพหลโยธิน', 'แขวงสามเสนใน เขตพญาไท', 'กรุงเทพมหานคร 10400', '02-615-5500', 'TK'],
  ['C007', 'สำนักงาน', 'กฎหมาย ธนากร แอนด์ พาร์ทเนอร์ส', 'Thanakorn & Partners Law Office', 'CORP', 'BKK', 'SP01', 30, 500000, '1 อาคารสาทรซิตี้ ชั้น 12 ถนนสาทรใต้', 'แขวงทุ่งมหาเมฆ เขตสาทร', 'กรุงเทพมหานคร 10120', '02-286-6600', 'TB'],
  ['C008', 'บริษัท', 'โกลเด้นไรซ์ เทรดดิ้ง จำกัด', 'Golden Rice Trading Co., Ltd.', 'CORP', 'NBI', 'SP02', 45, 1500000, '77 หมู่ 4 ถนนติวานนท์', 'ตำบลบางพูด อำเภอปากเกร็ด', 'นนทบุรี 11120', '02-960-7700', 'CQ'],
  ['C009', 'บริษัท', 'บางนาโลจิสติกส์ จำกัด', 'Bangna Logistics Co., Ltd.', 'CORP', 'SPK', 'SP02', 30, 900000, '45 หมู่ 12 ถนนบางนา-ตราด กม.19', 'ตำบลบางโฉลง อำเภอบางพลี', 'สมุทรปราการ 10540', '02-312-8800', 'TK'],
  ['C010', 'สำนักงาน', 'เขตบางกะปิ', 'Bang Kapi District Office', 'GOV', 'BKO', 'SP01', 60, 900000, '1 ถนนนวมินทร์', 'แขวงคลองจั่น เขตบางกะปิ', 'กรุงเทพมหานคร 10240', '02-377-9900', 'TB'],
  ['C011', 'บริษัท', 'ซีวิว รีสอร์ท แอนด์ สปา จำกัด', 'Seaview Resort & Spa Co., Ltd.', 'CORP', 'EST', 'SP03', 30, 600000, '222 หมู่ 9 ถนนเลียบชายหาด', 'ตำบลหนองปรือ อำเภอบางละมุง', 'ชลบุรี 20150', '038-411-100', 'TK'],
  ['C012', 'บริษัท', 'พรีเมียร์ ออโต้พาร์ท จำกัด', 'Premier Autoparts Co., Ltd.', 'CORP', 'SPK', 'SP02', 45, 1000000, '18 ซอยเทพารักษ์ 5', 'ตำบลบางปลา อำเภอบางพลี', 'สมุทรปราการ 10540', '02-750-1200', 'CQ'],
  ['C013', 'ห้างหุ้นส่วนจำกัด', 'ศรีสมบูรณ์ค้าวัสดุ', 'Sri Somboon Materials Ltd., Part.', 'SHOP', 'NBI', 'SP02', 30, 600000, '9 หมู่ 2 ถนนลำลูกกา', 'ตำบลคูคต อำเภอลำลูกกา', 'ปทุมธานี 12130', '02-987-1300', 'TK'],
  ['C014', 'บริษัท', 'ดิจิทัลวิชั่น มีเดีย จำกัด', 'Digital Vision Media Co., Ltd.', 'CORP', 'BKK', 'SP01', 30, 700000, '191 อาคารสีลมคอมเพล็กซ์ ชั้น 20', 'แขวงสีลม เขตบางรัก', 'กรุงเทพมหานคร 10500', '02-231-1400', 'TK'],
  ['C015', 'บริษัท', 'นนทบุรีฟาร์มา จำกัด', 'Nonthaburi Pharma Co., Ltd.', 'MED', 'NBI', 'SP02', 30, 800000, '66 ถนนงามวงศ์วาน', 'ตำบลบางเขน อำเภอเมืองนนทบุรี', 'นนทบุรี 11000', '02-580-1500', 'TK'],
  ['C016', 'บริษัท', 'ไทยฟู้ด โปรดักส์ จำกัด (มหาชน)', 'Thai Food Products PCL.', 'CORP', 'BKO', 'SP01', 60, 3000000, '999 ถนนเพชรเกษม', 'แขวงบางแค เขตบางแค', 'กรุงเทพมหานคร 10160', '02-454-1600', 'CQ'],
  ['C017', 'คลินิก', 'ทันตกรรมยิ้มสวย', 'Yim Suay Dental Clinic', 'MED', 'BKK', 'SP01', 0, 0, '12/3 ซอยอารีย์', 'แขวงสามเสนใน เขตพญาไท', 'กรุงเทพมหานคร 10400', '02-279-1700', 'CA'],
  ['C018', 'บริษัท', 'สมาร์ทโฮม เทคโนโลยี จำกัด', 'Smart Home Technology Co., Ltd.', 'CORP', 'BKO', 'SP01', 30, 800000, '400 ถนนศรีนครินทร์', 'แขวงหนองบอน เขตประเวศ', 'กรุงเทพมหานคร 10250', '02-721-1800', 'TK'],
  ['C019', 'บริษัท', 'อีสเทิร์นซีบอร์ด อินดัสทรี จำกัด', 'Eastern Seaboard Industry Co., Ltd.', 'CORP', 'EST', 'SP03', 45, 2000000, '700/9 หมู่ 5 นิคมอุตสาหกรรมอมตะซิตี้', 'ตำบลบ้านเก่า อำเภอพานทอง', 'ชลบุรี 20160', '038-213-190', 'CQ'],
  ['C020', 'โรงพยาบาล', 'สัตว์เพ็ทแคร์', 'Pet Care Animal Hospital', 'MED', 'BKO', 'SP01', 0, 0, '58 ถนนรามคำแหง', 'แขวงหัวหมาก เขตบางกะปิ', 'กรุงเทพมหานคร 10240', '02-318-2000', 'CA'],
  ['C021', 'บริษัท', 'ราชพฤกษ์ อสังหาริมทรัพย์ จำกัด', 'Ratchaphruek Property Co., Ltd.', 'CORP', 'NBI', 'SP02', 30, 900000, '3 ถนนราชพฤกษ์', 'ตำบลบางรักน้อย อำเภอเมืองนนทบุรี', 'นนทบุรี 11000', '02-921-2100', 'CQ'],
  ['C022', 'บริษัท', 'เอเชีย ทราเวล เซอร์วิส จำกัด', 'Asia Travel Service Co., Ltd.', 'CORP', 'BKK', 'SP01', 30, 700000, '15 ถนนราชดำริ', 'แขวงลุมพินี เขตปทุมวัน', 'กรุงเทพมหานคร 10330', '02-252-2200', 'TB'],
  ['C023', 'ร้าน', 'เจริญพาณิชย์', 'Charoen Panich Shop', 'SHOP', 'SPK', 'SP02', 30, 500000, '19/2 ถนนสุขุมวิท', 'ตำบลปากน้ำ อำเภอเมืองสมุทรปราการ', 'สมุทรปราการ 10270', '02-702-2300', 'CA'],
  ['C024', 'บริษัท', 'คิวซี แล็บ เทสติ้ง จำกัด', 'QC Lab Testing Co., Ltd.', 'CORP', 'EST', 'SP03', 30, 600000, '88 หมู่ 1 ถนนสุขุมวิท', 'ตำบลเนินพระ อำเภอเมืองระยอง', 'ระยอง 21000', '038-694-240', 'TK'],
  ['C025', '', 'ลูกค้าเงินสดทั่วไป', 'Walk-in Customer', 'SHOP', 'BKK', 'SP01', 0, 0, 'หน้าร้าน สำนักงานใหญ่', null, null, null, 'CA'],
];
const CUS = {};
for (const [i, c] of CUS_DEF.entries()) {
  const [code, title, name, en, type, area, sp, cd, cl, a1, a2, a3, phone, pay] = c;
  const walkIn = code === 'C025';
  const body = { code, title: title || null, name, name_en: en, customer_type: type, sales_area_code: area, salesperson_id: SLM[sp], credit_days: cd, credit_limit: cl,
    address_1: a1, address_2: a2, address_3: a3?.replace(/ \d{5}$/, '') ?? null, zip_code: a3?.match(/\d{5}$/)?.[0] ?? null, phone, email: walkIn ? null : `account@${en.toLowerCase().replace(/[^a-z]+/g, '').slice(0, 14)}.co.th`,
    contact: walkIn ? null : pick(['คุณสมศรี', 'คุณวรรณา', 'คุณประเสริฐ', 'คุณกิตติ', 'คุณนันทนา', 'คุณมาลี']), tax_id: walkIn ? null : taxId(`01055${String(46000 + i * 137).padStart(7, '0')}`), tax_branch_no: walkIn ? null : '00000',
    ship_via_code: area === 'EST' ? 'KRY' : 'OWN', price_level: ['1', '1', '2', '3'][i % 4], payment_terms: cd ? `เครดิต ${cd} วัน` : 'เงินสด', status: 'A',
    wht_form: ['C006', 'C014', 'C018'].includes(code) ? 'S53' : null, wht_rate: ['C006', 'C014', 'C018'].includes(code) ? 3 : null,
    ship_tos: ['C009', 'C016', 'C019'].includes(code) ? [{ code: 'WH1', address_1: `คลังสินค้า ${en}`, address_2: a2, address_3: a3, contact: 'หัวหน้าคลังสินค้า', phone }] : [],
    contacts: walkIn ? [] : [{ name: pick(['คุณสมศรี ใจงาม', 'คุณวรรณา สุขสวัสดิ์', 'คุณประเสริฐ มั่นคง', 'คุณกิตติ ทองดี']), position: 'ฝ่ายจัดซื้อ', phone, email: `purchase${i + 1}@example.co.th`, is_primary: true },
      ...(i % 3 === 0 ? [{ name: 'คุณนันทนา บัญชีดี', position: 'ฝ่ายบัญชี', phone, email: `ap${i + 1}@example.co.th`, is_primary: false }] : [])] };
  CUS[code] = { id: (await ok('POST', '/api/v1/customers', body)).id, code, name: `${title}${title ? ' ' : ''}${name}`, area, sp, cd, pay, wht: !!body.wht_form };
}
// ผู้จำหน่าย: [รหัส, คำนำหน้า, ชื่อ, อังกฤษ, ประเภท, เครดิต, ภาษีหัก(แบบ,ประเภทเงินได้,อัตรา), ธนาคาร, ราคา]
const SUP_DEF = [
  ['S001', 'บริษัท', 'สยามเปเปอร์ มิลล์ จำกัด', 'Siam Paper Mill Co., Ltd.', 'MFG', 45, null, 'BBL'],
  ['S002', 'บริษัท', 'ควอนตั้ม สเตชันเนอรี่ จำกัด', 'Quantum Stationery Co., Ltd.', 'DIS', 30, null, 'KBANK'],
  ['S003', 'บริษัท', 'ไอทีซิตี้ ดิสทริบิวชั่น จำกัด', 'IT City Distribution Co., Ltd.', 'DIS', 30, null, 'SCB'],
  ['S004', 'บริษัท', 'พริ้นท์เทค ซัพพลาย จำกัด', 'Printech Supply Co., Ltd.', 'DIS', 45, null, 'BBL'],
  ['S005', 'บริษัท', 'เนสท์ บิวเวอเรจ เทรดดิ้ง จำกัด', 'Nest Beverage Trading Co., Ltd.', 'DIS', 0, null, 'KBANK'],
  ['S006', 'บริษัท', 'คลีนพลัส เคมีคอล จำกัด', 'Clean Plus Chemical Co., Ltd.', 'MFG', 30, null, 'KTB'],
  ['S007', 'นาย', 'สมชาย ใจดี', 'Mr. Somchai Jaidee', 'IND', 0, ['S03', 'ค่าเช่า', 5], 'KBANK'],
  ['S008', '', 'การไฟฟ้านครหลวง', 'Metropolitan Electricity Authority', 'UTL', 0, null, null],
  ['S009', '', 'การประปานครหลวง', 'Metropolitan Waterworks Authority', 'UTL', 0, null, null],
  ['S010', 'บริษัท', 'สปีดเน็ต บรอดแบนด์ จำกัด', 'Speednet Broadband Co., Ltd.', 'SRV', 0, ['S53', 'ค่าบริการอินเทอร์เน็ต', 3], 'SCB'],
  ['S011', 'บริษัท', 'ขนส่งด่วนทันใจ จำกัด', 'Tanjai Express Transport Co., Ltd.', 'SRV', 30, ['S53', 'ค่าขนส่ง', 1], 'KBANK'],
  ['S012', 'บริษัท', 'ครีเอทีฟ แอด เอเจนซี่ จำกัด', 'Creative Ad Agency Co., Ltd.', 'SRV', 0, ['S53', 'ค่าโฆษณา', 2], 'BAY'],
  ['S013', 'บริษัท', 'ช่างดีเซอร์วิส จำกัด', 'Changdee Service Co., Ltd.', 'SRV', 0, ['S53', 'ค่าซ่อมแซม (ค่าบริการ)', 3], 'TTB'],
  ['S014', 'บริษัท', 'วีระพงษ์ ออดิท แอนด์ แอคเคาน์ติ้ง จำกัด', 'Weerapong Audit & Accounting Co., Ltd.', 'SRV', 0, ['S53', 'ค่าบริการทางบัญชี', 3], 'BBL'],
  ['S015', 'บริษัท', 'ไอทีซัพพอร์ต โซลูชั่น จำกัด', 'IT Support Solution Co., Ltd.', 'SRV', 0, ['S53', 'ค่าบริการดูแลระบบไอที', 3], 'KBANK'],
];
const SUP = {};
for (const [i, s] of SUP_DEF.entries()) {
  const [code, title, name, en, type, cd, wht, bank] = s;
  const tid = type === 'IND' ? taxId('310150012345') : type === 'UTL' ? taxId(`0994000${String(16500 + i * 7).padStart(5, '0')}`) : taxId(`01055${String(82000 + i * 211).padStart(7, '0')}`);
  const body = { code, title: title || null, name, name_en: en, supplier_type: type, credit_days: cd, payment_terms: cd ? `เครดิต ${cd} วัน` : 'ชำระทันที', tax_id: tid, tax_branch_no: '00000',
    price_type: type === 'IND' ? '0' : '2', vat_rate: type === 'IND' ? 0 : 7, address_1: `${100 + i * 7} ถนน${pick(['ลาดพร้าว', 'พระราม 3', 'บางนา-ตราด', 'วิภาวดีรังสิต', 'เพชรบุรีตัดใหม่'])}`, address_2: 'กรุงเทพมหานคร', zip_code: `10${pad(110 + i * 10)}`.slice(0, 5),
    phone: `02-${ri(200, 999)}-${ri(1000, 9999)}`, contact: pick(['คุณสุนทร', 'คุณจันทร์เพ็ญ', 'คุณอรุณ', 'คุณทวีศักดิ์']), credit_limit: cd ? 2000000 : 0, ship_via_code: 'OWN',
    wht_form: wht?.[0] ?? null, wht_income_desc: wht?.[1] ?? null, wht_rate: wht?.[2] ?? null, wht_condition: wht ? '1' : null,
    banks: bank ? [{ bank_code: bank, branch: 'สำนักงานใหญ่', account_no: `${ri(100, 999)}-${ri(1, 9)}-${ri(10000, 99999)}-${ri(0, 9)}`, account_name: `${title} ${name}`.trim(), is_default: true }] : [],
    contacts: [{ name: pick(['คุณสุนทร วงศ์ใหญ่', 'คุณจันทร์เพ็ญ ศรีสุข', 'คุณอรุณ แสงทอง']), position: type === 'SRV' ? 'ผู้ประสานงาน' : 'ฝ่ายขาย', phone: `08${ri(1, 9)}-${ri(100, 999)}-${ri(1000, 9999)}`, is_primary: true }] };
  SUP[code] = { id: (await ok('POST', '/api/v1/suppliers', body)).id, code, name: `${title}${title ? ' ' : ''}${name}`, cd, wht };
}

// สินค้า: [รหัส, ชื่อไทย, อังกฤษ, หมวด, หน่วย, หน่วยขาย/ตัวคูณ, หน่วยซื้อ/ตัวคูณ, ทุน, ราคา1, ความต้องการ/เดือน, ผู้จำหน่าย, กลุ่ม, Serial]
const ITEM_DEF = [
  ['11-PAPR-A480', 'กระดาษถ่ายเอกสาร A4 80 แกรม', 'Copy Paper A4 80gsm', 'PAP', 'REAM', null, ['CTN', 5], '98', '125', 900, 'S001', 'GD'],
  ['11-PAPR-A470', 'กระดาษถ่ายเอกสาร A4 70 แกรม', 'Copy Paper A4 70gsm', 'PAP', 'REAM', null, ['CTN', 5], '85', '110', 600, 'S001', 'GD'],
  ['11-PAPR-F14', 'กระดาษถ่ายเอกสาร F14 80 แกรม', 'Copy Paper F14 80gsm', 'PAP', 'REAM', null, ['CTN', 5], '120', '155', 150, 'S001', 'GD'],
  ['11-PAPR-STK', 'กระดาษสติ๊กเกอร์ A4 (50 แผ่น)', 'A4 Sticker Paper (50 sheets)', 'PAP', 'PACK', null, null, '145', '195', 80, 'S001', 'GD'],
  ['11-ENVL-DL', 'ซองจดหมายสีขาว DL (แพ็ค 500)', 'White DL Envelopes (500 pack)', 'PAP', 'PACK', null, null, '210', '285', 40, 'S001', 'GD'],
  ['12-PENB-BLUE', 'ปากกาลูกลื่น 0.5 มม. สีน้ำเงิน', 'Ballpoint Pen 0.5mm Blue', 'STA', 'PCS', ['BOX', 12], ['BOX', 12], '4.50', '7', 2400, 'S002', 'GD'],
  ['12-PENB-RED', 'ปากกาลูกลื่น 0.5 มม. สีแดง', 'Ballpoint Pen 0.5mm Red', 'STA', 'PCS', ['BOX', 12], ['BOX', 12], '4.50', '7', 900, 'S002', 'GD'],
  ['12-MARK-PERM', 'ปากกาเคมี 2 หัว สีดำ', 'Permanent Marker Twin Tip Black', 'STA', 'PCS', ['DZ', 12], ['BOX', 12], '12', '18', 500, 'S002', 'GD'],
  ['12-HILT-YELL', 'ปากกาเน้นข้อความ สีเหลือง', 'Highlighter Yellow', 'STA', 'PCS', ['DZ', 12], ['BOX', 12], '14', '22', 400, 'S002', 'GD'],
  ['12-STPL-NO10', 'เครื่องเย็บกระดาษ เบอร์ 10', 'Stapler No.10', 'STA', 'PCS', null, null, '65', '95', 60, 'S002', 'GD'],
  ['12-STPS-NO10', 'ลวดเย็บกระดาษ เบอร์ 10', 'Staples No.10', 'STA', 'PCS', ['DZ', 12], ['BOX', 12], '6', '10', 800, 'S002', 'GD'],
  ['12-FILE-A4BL', 'แฟ้มสันกว้าง 3 นิ้ว สีน้ำเงิน', 'Lever Arch File 3" Blue', 'STA', 'PCS', null, ['BOX', 12], '48', '69', 300, 'S002', 'GD'],
  ['12-NOTE-3X3', 'กระดาษโน้ตกาวในตัว 3x3 นิ้ว', 'Sticky Notes 3x3"', 'STA', 'PACK', null, null, '22', '35', 350, 'S002', 'GD'],
  ['12-TAPE-OPP', 'เทปใส OPP 2 นิ้ว', 'OPP Clear Tape 2"', 'STA', 'ROLL', null, null, '28', '42', 600, 'S002', 'GD'],
  ['13-MOUS-WL01', 'เมาส์ไร้สาย', 'Wireless Mouse', 'ITA', 'PCS', null, null, '210', '329', 60, 'S003', 'GD'],
  ['13-KEYB-USB1', 'คีย์บอร์ด USB ภาษาไทย', 'USB Keyboard (Thai)', 'ITA', 'PCS', null, null, '260', '390', 40, 'S003', 'GD'],
  ['13-USBD-64GB', 'แฟลชไดร์ฟ 64GB', 'USB Flash Drive 64GB', 'ITA', 'PCS', null, null, '145', '229', 80, 'S003', 'GD'],
  ['13-HDMI-2M', 'สาย HDMI 2 เมตร', 'HDMI Cable 2m', 'ITA', 'PCS', null, null, '85', '149', 50, 'S003', 'GD'],
  ['13-UPSB-1KVA', 'เครื่องสำรองไฟ 1000VA', 'UPS 1000VA', 'ITA', 'PCS', null, null, '2150', '2990', 10, 'S003', 'GD', true],
  ['13-MONI-24IN', 'จอมอนิเตอร์ 24 นิ้ว IPS', 'Monitor 24" IPS', 'ITA', 'PCS', null, null, '3350', '4590', 12, 'S003', 'GD', true],
  ['14-PRNT-LJ211', 'เครื่องพิมพ์เลเซอร์ขาวดำ ไร้สาย', 'Mono Laser Printer Wireless', 'PRN', 'PCS', null, null, '4200', '5690', 6, 'S004', 'GF', true],
  ['14-TONR-136A', 'ตลับหมึกเลเซอร์ 136A สีดำ', 'Laser Toner 136A Black', 'PRN', 'PCS', null, null, '1650', '2290', 40, 'S004', 'GF'],
  ['14-TONR-26A', 'ตลับหมึกเลเซอร์ 26A สีดำ', 'Laser Toner 26A Black', 'PRN', 'PCS', null, null, '2450', '3290', 15, 'S004', 'GF'],
  ['14-INKB-003', 'หมึกเติมอิงค์เจ็ท 003 สีดำ', 'Ink Refill 003 Black', 'PRN', 'BTL', null, null, '160', '250', 120, 'S004', 'GF'],
  ['15-COFF-3IN1', 'กาแฟปรุงสำเร็จ 3in1 (27 ซอง)', 'Coffee 3in1 (27 sachets)', 'BEV', 'PACK', null, null, '118', '159', 200, 'S005', 'GD'],
  ['15-WATR-600', 'น้ำดื่ม 600 มล. (แพ็ค 12 ขวด)', 'Drinking Water 600ml (12-pack)', 'BEV', 'PACK', null, null, '42', '59', 300, 'S005', 'GD'],
  ['15-TEAB-GRN', 'ชาเขียวชนิดซอง (25 ซอง)', 'Green Tea Bags (25)', 'BEV', 'PACK', null, null, '65', '95', 100, 'S005', 'GD'],
  ['16-TISS-ROLL', 'กระดาษชำระ (แพ็ค 6 ม้วน)', 'Toilet Tissue (6 rolls)', 'CLN', 'PACK', null, null, '72', '99', 250, 'S006', 'GD'],
  ['16-SOAP-HAND', 'สบู่เหลวล้างมือ 500 มล.', 'Liquid Hand Soap 500ml', 'CLN', 'BTL', null, null, '55', '85', 120, 'S006', 'GD'],
  ['16-CLNR-FLOR', 'น้ำยาถูพื้น 3.8 ลิตร', 'Floor Cleaner 3.8L', 'CLN', 'BTL', null, null, '135', '189', 60, 'S006', 'GD'],
];
const DEMAND_SCALE = 1.4;
const ITEMS = [];
const ITEM = {};
for (const [i, it] of ITEM_DEF.entries()) {
  const [code, th, en, cat, unit, su, pu, cost, price, demand, sup, grp, serial] = it;
  const p = D(price);
  const body = { code, barcode: ean13(`885${String(1234000 + i * 37).padStart(9, '0')}`), name_th: th, name_en: en, category_code: cat, account_group_id: IAG[grp], base_unit_id: UNIT[unit],
    sales_unit_id: su ? UNIT[su[0]] : null, sales_factor: su ? su[1] : null, purchase_unit_id: pu ? UNIT[pu[0]] : null, purchase_factor: pu ? pu[1] : null, count_unit_id: UNIT[unit], count_factor: 1,
    std_cost: cost, price_1: m2(p), price_2: m2(p.times(0.97)), price_3: m2(p.times(0.95)), price_4: m2(p.times(0.92)), price_5: m2(p.times(0.9)),
    default_supplier_id: SUP[sup].id, packing: su ? `1x${su[1]}` : null, remark: serial ? 'สินค้ามีหมายเลขเครื่อง (Serial No.) รับประกัน 1 ปี' : null, status: 'A' };
  const id = (await ok('POST', '/api/v1/items', body)).id;
  const o = { id, code, name: th, cat, unit, cost: D(cost), price: p, demand: Math.round(demand * DEMAND_SCALE), sup, grp, serial: !!serial, box: su?.[0] === 'BOX' || su?.[0] === 'DZ' ? { unit: UNIT[su[0]], f: su[1] } : null };
  ITEMS.push(o); ITEM[code] = o;
}
// สินค้าชุด
const KIT_DEF = [
  ['20-SETO-STRT', 'ชุดเครื่องเขียนพนักงานใหม่', 'New Employee Stationery Set', '249', [['12-PENB-BLUE', 2], ['12-PENB-RED', 1], ['12-HILT-YELL', 1], ['12-STPL-NO10', 1], ['12-STPS-NO10', 2], ['12-NOTE-3X3', 1]]],
  ['20-SETC-GIFT', 'ชุดของขวัญกาแฟและชา', 'Coffee & Tea Gift Set', '399', [['15-COFF-3IN1', 2], ['15-TEAB-GRN', 1]]],
  ['20-SETI-COMP', 'ชุดอุปกรณ์คอมพิวเตอร์ (เมาส์ คีย์บอร์ด แฟลชไดร์ฟ)', 'Computer Accessories Set', '890', [['13-MOUS-WL01', 1], ['13-KEYB-USB1', 1], ['13-USBD-64GB', 1]]],
];
const KIT = {};
for (const [code, th, en, price, bom] of KIT_DEF) {
  const cost = bom.reduce((s, [c, q]) => s.plus(ITEM[c].cost.times(q)), D(0));
  const id = (await ok('POST', '/api/v1/kits', { code, name_th: th, name_en: en, item_type: '1', item_level: '1', category_code: 'SET', account_group_id: IAG.GD, base_unit_id: UNIT.SET,
    std_cost: m2(cost), price_1: price, price_2: m2(D(price).times(0.95)), status: 'A',
    bom: bom.map(([c, q]) => ({ component_item_id: ITEM[c].id, qty: q, std_cost: m2(ITEM[c].cost), sell_price: m2(ITEM[c].price) })) })).id;
  KIT[code] = { id, code, name: th, price: D(price), bom: bom.map(([c, q]) => ({ item: ITEM[c], qty: q })) };
}
// บริการ / รายได้อื่น / ค่าใช้จ่ายอื่น
const SRV = {};
for (const [code, th, en, unit, price, acc] of [
  ['30-SERV-INSTL', 'ค่าบริการติดตั้งอุปกรณ์', 'Equipment Installation Service', 'JOB', '350', '4400-03'],
  ['30-SERV-MAINT', 'ค่าบริการบำรุงรักษาเครื่องพิมพ์รายเดือน', 'Monthly Printer Maintenance Service', 'MON', '2500', '4400-03'],
  ['30-SERV-NETWK', 'ค่าบริการติดตั้งระบบเครือข่าย', 'Network Setup Service', 'JOB', '4500', '4400-03'],
  ['30-SERV-TRAIN', 'ค่าอบรมการใช้งานอุปกรณ์', 'Equipment Training Service', 'JOB', '3000', '4400-03'],
  ['30-SERV-DELIV', 'ค่าขนส่งสินค้า', 'Delivery Charge', 'TRIP', '500', '4200-08'],
]) SRV[code] = { id: (await ok('POST', '/api/v1/services', { code, name_th: th, name_en: en, category_code: 'SRV', base_unit_id: UNIT[unit], price_1: price, status: 'A', accounts: { revenue: A(acc), revenue_return: A(acc) } })).id, price: D(price) };
const INC = {};
for (const [code, th, en, acc] of [['40-INCO-SCRAP', 'รายได้จากการขายเศษกระดาษ/กล่อง', 'Scrap Sales', '4200-05'], ['40-INCO-RENT', 'รายได้ค่าเช่าพื้นที่ติดตั้งป้าย', 'Signage Space Rental Income', '4200-06'], ['40-INCO-COMM', 'รายได้ค่านายหน้า/ส่วนแบ่งการขาย', 'Commission Income', '4200-09']])
  INC[code] = (await ok('POST', '/api/v1/other-incomes', { code, name_th: th, name_en: en, status: 'A', accounts: { revenue: A(acc) } })).id;
const EXP = {};
for (const [code, th, en, acc] of [
  ['50-EXPN-RENT', 'ค่าเช่าสำนักงาน', 'Office Rent', '5420-05'], ['50-EXPN-ELEC', 'ค่าไฟฟ้า', 'Electricity', '5430-02'], ['50-EXPN-WATER', 'ค่าน้ำประปา', 'Water Supply', '5430-03'],
  ['50-EXPN-NET', 'ค่าอินเทอร์เน็ต', 'Internet', '5430-05'], ['50-EXPN-TRANS', 'ค่าขนส่งสินค้า', 'Freight / Transport', '5300-05'], ['50-EXPN-ADVT', 'ค่าโฆษณาและประชาสัมพันธ์', 'Advertising', '5300-02'],
  ['50-EXPN-REPAIR', 'ค่าซ่อมแซมบำรุงรักษา', 'Repairs & Maintenance', '5420-02'], ['50-EXPN-PROF', 'ค่าบริการวิชาชีพ (บัญชี/ตรวจสอบ)', 'Professional Fees', '5420-08'],
  ['50-EXPN-ITSUP', 'ค่าบริการดูแลระบบไอที', 'IT Support Service', '5420-09'], ['50-EXPN-PHONE', 'ค่าโทรศัพท์', 'Telephone', '5430-01'],
  ['50-EXPN-FACOM', 'ซื้อคอมพิวเตอร์ (ทรัพย์สิน)', 'Computer Purchase (Fixed Asset)', '1410-06'], ['50-EXPN-FAFUR', 'ซื้อเฟอร์นิเจอร์/ชั้นวาง (ทรัพย์สิน)', 'Furniture Purchase (Fixed Asset)', '1410-04'],
]) EXP[code] = (await ok('POST', '/api/v1/other-expenses', { code, name_th: th, name_en: en, status: 'A', accounts: { expense: A(acc) } })).id;

// ตารางราคา + จุดสั่งซื้อ + หมายเหตุแฟ้มหลัก
await ok('PUT', `/api/v1/items/${ITEM['11-PAPR-A480'].id}/prices`, { sales_unit_id: null, sales_factor: 1, price_1: '125.00', price_2: '121.25', price_3: '118.75', price_4: '115.00', price_5: '112.50',
  breaks: [{ unit_id: UNIT.REAM, factor: 1, min_qty: 50, price_1: '120.00', price_2: '118.00' }, { unit_id: UNIT.CTN, factor: 5, min_qty: 20, price_1: '585.00', price_2: '575.00' }, { unit_id: UNIT.REAM, factor: 1, min_qty: 200, price_1: '115.00', start_date: '2026-06-01', end_date: '2026-08-31' }] });
await ok('PUT', `/api/v1/items/${ITEM['12-PENB-BLUE'].id}/prices`, { sales_unit_id: UNIT.BOX, sales_factor: 12, price_1: '7.00', price_2: '6.80', price_3: '6.60', price_4: '6.40', price_5: '6.30',
  breaks: [{ unit_id: UNIT.BOX, factor: 12, min_qty: 10, price_1: '78.00' }, { unit_id: UNIT.BOX, factor: 12, min_qty: 50, price_1: '72.00' }] });
await ok('PUT', `/api/v1/items/${ITEM['14-TONR-136A'].id}/prices`, { sales_unit_id: null, sales_factor: 1, price_1: '2290.00', price_2: '2220.00', price_3: '2180.00', price_4: '2100.00', price_5: '2050.00',
  breaks: [{ unit_id: null, factor: 1, min_qty: 10, is_percent: true, price_1: '5', price_2: '5' }] });
await ok('PUT', `/api/v1/items/${ITEM['15-WATR-600'].id}/prices`, { sales_unit_id: null, sales_factor: 1, price_1: '59.00', price_2: '57.00', price_3: '56.00', price_4: '55.00', price_5: '54.00',
  breaks: [{ unit_id: null, factor: 1, min_qty: 100, price_1: '55.00' }] });
for (const it of ITEMS) {
  const rows = [{ warehouse_id: WH['01'], start_mmdd: '0101', min_qty: String(Math.round(it.demand * 0.8)), max_qty: String(Math.round(it.demand * 2)), order_qty: String(Math.round(it.demand * 1.2)), projected_sales: String(it.demand) }];
  if (it.demand >= 100) rows.push({ warehouse_id: WH['01'], start_mmdd: '1001', min_qty: String(Math.round(it.demand)), max_qty: String(Math.round(it.demand * 2.4)), order_qty: String(Math.round(it.demand * 1.5)), projected_sales: String(Math.round(it.demand * 1.2)) });
  rows.push({ warehouse_id: WH['02'], start_mmdd: '0101', min_qty: String(Math.round(it.demand * 0.15)), max_qty: String(Math.round(it.demand * 0.4)), order_qty: null, projected_sales: String(Math.round(it.demand * 0.2)) });
  await ok('PUT', `/api/v1/items/${it.id}/reorder`, { rows });
}
await ok('PUT', `/api/v1/master-notes/item/${ITEM['14-PRNT-LJ211'].id}`, { notes: ['รับประกันศูนย์ 1 ปี (On-site) นับจากวันที่ส่งของ', 'บันทึก Serial No. ทุกเครื่องในทะเบียนหมายเลขสินค้า', 'แถมสาย USB 1 เส้น'] });
await ok('PUT', `/api/v1/master-notes/item/${ITEM['13-MONI-24IN'].id}`, { notes: ['รับประกัน 3 ปี กรณี Dead pixel เปลี่ยนเครื่องใหม่ภายใน 7 วัน'] });
await ok('PUT', `/api/v1/master-notes/item/${ITEM['11-PAPR-A480'].id}`, { notes: ['สั่งขั้นต่ำ 20 ลัง ได้ราคาพิเศษ', 'จัดเก็บห่างจากความชื้น'] });
await ok('PUT', `/api/v1/master-notes/customer/${CUS.C016.id}`, { notes: ['วางบิลทุกวันที่ 25 ที่แผนกบัญชีเจ้าหนี้ ชั้น 3', 'รับเช็คทุกวันศุกร์ที่ 2 ของเดือน'] });
await ok('PUT', `/api/v1/master-notes/customer/${CUS.C023.id}`, { notes: ['ชำระช้าบ่อย — ติดตามหนี้ก่อนส่งของรอบใหม่'] });
await ok('PUT', `/api/v1/master-notes/supplier/${SUP.S001.id}`, { notes: ['สั่งซื้อทาง LINE: @siampaper ส่งของภายใน 3 วันทำการ'] });
await ok('PUT', `/api/v1/master-notes/supplier/${SUP.S007.id}`, { notes: ['สัญญาเช่าสำนักงาน 3 ปี (1 ม.ค. 2568 – 31 ธ.ค. 2570) ค่าเช่าเดือนละ 35,000 บาท หัก ณ ที่จ่าย 5%'] });

/* ================================================================== 3. ยอดยกมา ณ 1 ม.ค. 2569 */
console.log('▶ ยอดยกมา');
// ลูกหนี้ยกมา
const AR_OPEN = [['C001', 'IV68/1101', '2025-11-28', '85600.00', 45], ['C003', 'IV68/1115', '2025-12-03', '128400.00', 45], ['C006', 'IV68/1122', '2025-12-10', '42800.00', 30],
  ['C008', 'IV68/1131', '2025-12-12', '96300.00', 45], ['C012', 'IV68/1140', '2025-12-15', '64200.00', 45], ['C016', 'IV68/1148', '2025-11-20', '213000.00', 60],
  ['C019', 'IV68/1156', '2025-12-19', '77040.00', 45], ['C021', 'IV68/1163', '2025-12-24', '58850.00', 30], ['C023', 'IV68/0987', '2025-09-30', '18750.00', 30]];
for (const [c, no, date, amt, cd] of AR_OPEN) await ok('POST', '/api/v1/ar-opening', { party_id: CUS[c].id, doc_no: no, doc_date: date, credit_days: cd, price_type: '2', amount: amt, vat_rate: 7, vat_date: date, remark: 'ยอดคงค้างยกมาจากโปรแกรมเดิม' });
const AP_OPEN = [['S001', 'RR68/0912', '2025-12-05', '145000.00', 'SPM-25-8812', 45], ['S002', 'RR68/0920', '2025-12-10', '62000.00', 'QS681210', 30], ['S003', 'RR68/0925', '2025-12-15', '118500.00', 'ITC-INV-77120', 30],
  ['S004', 'RR68/0930', '2025-12-18', '96000.00', 'PT-6812-045', 45], ['S006', 'RR68/0934', '2025-12-22', '21400.00', 'CP-2512-77', 30], ['S011', 'RR68/0938', '2025-12-28', '6800.00', 'TJ-1225', 30]];
for (const [s, no, date, amt, ref, cd] of AP_OPEN) await ok('POST', '/api/v1/ap-opening', { party_id: SUP[s].id, doc_no: no, doc_date: date, ref_no: ref, credit_days: cd, price_type: '2', amount: amt, vat_rate: 7, vat_date: date, remark: 'ยอดคงค้างยกมาจากโปรแกรมเดิม' });
const arOpenTotal = D((await get('/api/v1/ar-opening')).total);
const apOpenTotal = D((await get('/api/v1/ap-opening')).total);
// สินค้ายกมา (ล็อตหลัก 31 ธ.ค. 2568 + ล็อตหมึกพิมพ์ FIFO อีกล็อต 15 พ.ย. 2568)
const OPEN_COST = { '14-TONR-136A': '1610.00', '14-TONR-26A': '2390.00', '14-INKB-003': '155.00' };
const lot1 = [], lot0 = [];
let stockOpenValue = D(0);
for (const it of ITEMS) {
  const q1 = Math.max(6, Math.round(it.demand * 1.6)), q2 = Math.round(it.demand * 0.3);
  if (OPEN_COST[it.code]) {
    const qa = Math.round(q1 * 0.4);
    lot0.push({ item_id: it.id, warehouse_id: WH['01'], qty: String(qa), value: m2(D(OPEN_COST[it.code]).times(qa)) }); stockOpenValue = stockOpenValue.plus(m2(D(OPEN_COST[it.code]).times(qa)));
    lot1.push({ item_id: it.id, warehouse_id: WH['01'], qty: String(q1 - qa), value: m2(it.cost.times(q1 - qa)) }); stockOpenValue = stockOpenValue.plus(m2(it.cost.times(q1 - qa)));
  } else { lot1.push({ item_id: it.id, warehouse_id: WH['01'], qty: String(q1), value: m2(it.cost.times(q1)) }); stockOpenValue = stockOpenValue.plus(m2(it.cost.times(q1))); }
  if (q2 > 0 && !['14-PRNT-LJ211', '13-UPSB-1KVA'].includes(it.code)) { lot1.push({ item_id: it.id, warehouse_id: WH['02'], qty: String(q2), value: m2(it.cost.times(q2)) }); stockOpenValue = stockOpenValue.plus(m2(it.cost.times(q2))); }
}
await ok('POST', '/api/v1/stock-opening', { doc_no: 'LOT-2568-11', doc_date: '2025-11-15', remark: 'ล็อตหมึกพิมพ์รับเข้า พ.ย. 2568', lines: lot0 });
await ok('POST', '/api/v1/stock-opening', { doc_no: 'ยอดยกมา-2568', doc_date: '2025-12-31', remark: 'ตรวจนับสินค้าคงเหลือ ณ 31 ธ.ค. 2568', lines: lot1 });
// เช็ครับในมือยกมา
const OPEN_CHQ = [['C005', 'KB-0045871', '2026-01-06', '2025-12-29', '45000.00', 'KBANK'], ['C013', 'SCB-1123044', '2026-01-12', '2025-12-30', '23540.00', 'SCB']];
let openChq = D(0);
for (const [c, no, cdate, rdate, amt, bank] of OPEN_CHQ) { await ok('POST', '/api/v1/cheques', { direction: 'R', cheque_no: no, cheque_date: cdate, received_date: rdate, bank_id: BANK[bank], bank_branch: 'สำนักงานใหญ่', customer_id: CUS[c].id, amount: amt, remark: 'เช็คในมือยกมา' }); openChq = openChq.plus(amt); }

// ทรัพย์สินถาวร
const FAG = {};
for (const [code, th, en, a, e, ac] of [['COM', 'คอมพิวเตอร์และอุปกรณ์อิเล็กทรอนิกส์', 'Computers & Electronics', '1410-06', '5440-06', '1420-06'], ['FUR', 'เครื่องตกแต่งสำนักงาน', 'Furniture & Fixtures', '1410-04', '5440-04', '1420-04'],
  ['OFE', 'อุปกรณ์สำนักงาน', 'Office Equipment', '1410-03', '5440-03', '1420-03'], ['VEH', 'ยานพาหนะ', 'Vehicles', '1410-05', '5440-05', '1420-05']])
  FAG[code] = { id: (await ok('POST', '/api/v1/asset-account-groups', { code, name_th: th, name_en: en, asset_account_id: A(a), depr_expense_account_id: A(e), accum_depr_account_id: A(ac) })).id, asset: a, accum: ac };
/** ค่าเสื่อมสะสมก่อน 1 ม.ค. 2569 แบบเส้นตรงรายวัน (ประมาณแบบ Express: ต่อปี ÷ 365 × วันใช้งาน) */
function accumBf(cost, life, start) {
  const annual = D(cost).minus(1).div(life).toDecimalPlaces(2);
  const days = Math.round((Date.UTC(2026, 0, 1) - Date.parse(start + 'T00:00:00Z')) / 86400000);
  return Decimal.min(annual.div(365).times(days).toDecimalPlaces(2), D(cost).minus(1));
}
const FA_DEF = [
  ['FA-COM-001', 'คอมพิวเตอร์โน้ตบุ๊ก ฝ่ายบัญชี', 'Notebook – Accounting', 'COM', '03', '32500.00', 3, '2023-03-15', 'NB-DL-2023-0315'],
  ['FA-COM-002', 'คอมพิวเตอร์ตั้งโต๊ะ ฝ่ายขาย 4 เครื่อง', 'Desktop PCs – Sales (4 units)', 'COM', '02', '98000.00', 3, '2024-07-01', 'PC-SAL-2407'],
  ['FA-FUR-001', 'ชุดโต๊ะทำงานและเก้าอี้สำนักงาน', 'Office Desks & Chairs', 'FUR', '01', '145000.00', 5, '2023-01-10', null],
  ['FA-OFE-001', 'เครื่องถ่ายเอกสารมัลติฟังก์ชัน', 'Multifunction Copier', 'OFE', '01', '89000.00', 5, '2024-02-20', 'MFP-24-0220'],
  ['FA-VEH-001', 'รถกระบะบรรทุกสินค้า ทะเบียน ผค 4521 กรุงเทพมหานคร', 'Pickup Truck (delivery)', 'VEH', '04', '785000.00', 5, '2024-09-01', 'MMTJJKK10RH045210'],
  ['FA-OFE-002', 'เครื่องปรับอากาศ 24,000 BTU 2 เครื่อง', 'Air Conditioners 24,000 BTU (2 units)', 'OFE', '01', '68000.00', 5, '2025-05-15', null],
];
const FA = {};
const faOpen = new Map();   // บัญชี → { cost, accum }
for (const [code, th, en, g, dep, cost, life, start, sn] of FA_DEF) {
  const bf = accumBf(cost, life, start);
  FA[code] = (await ok('POST', '/api/v1/fa/assets', { code, name_th: th, name_en: en, category_code: g, account_group_id: FAG[g].id, serial_no: sn, department_id: DEP[dep], is_depreciable: true,
    purchase_date: start, cost, salvage_value: '1', method: '1', start_date: start, useful_life_years: life, depr_monthly: true, accum_depr_bf: m2(bf), accum_bf_date: '2026-01-01' })).id;
  const a = faOpen.get(g) ?? { cost: D(0), accum: D(0) }; a.cost = a.cost.plus(cost); a.accum = a.accum.plus(bf); faOpen.set(g, a);
}

// ยอดยกมาบัญชีแยกประเภท
const OPEN_FIXED = { '1111-01': '85000.00', '1111-02': '20000.00', '1112-00': BANKACC_DEF[0].open, '1113-02': BANKACC_DEF[1].open, '1113-01': BANKACC_DEF[2].open,
  '1158-00': '18500.00', '1500-05': '105000.00', '1151-03': '0.00' };
const OPEN_LIAB = { '2131-04': '13500.00', '2132-01': '9800.00', '2132-03': '6450.00', '2137-00': '38600.00', '2131-09': '25000.00', '2210-00': '1200000.00', '3100-00': '5000000.00' };
const glOpen = [];
for (const [no, v] of Object.entries(OPEN_FIXED)) if (D(v).gt(0)) glOpen.push({ account_id: A(no), debit: v, credit: '0' });
glOpen.push({ account_id: A('1130-01'), debit: m2(arOpenTotal), credit: '0' });
glOpen.push({ account_id: A('1130-02'), debit: m2(openChq), credit: '0' });
glOpen.push({ account_id: A('1140-02'), debit: m2(stockOpenValue), credit: '0' });
for (const [g, v] of faOpen) { glOpen.push({ account_id: A(FAG[g].asset), debit: m2(v.cost), credit: '0' }); glOpen.push({ account_id: A(FAG[g].accum), debit: '0', credit: m2(v.accum) }); }
glOpen.push({ account_id: A('2120-01'), debit: '0', credit: m2(apOpenTotal) });
for (const [no, v] of Object.entries(OPEN_LIAB)) glOpen.push({ account_id: A(no), debit: '0', credit: v });
const net0 = glOpen.reduce((s, r) => s.plus(r.debit).minus(r.credit), D(0));
const RE_OPEN = net0;   // กำไรสะสม = สินทรัพย์ − หนี้สิน − ทุน
glOpen.push({ account_id: A('3200-00'), debit: '0', credit: m2(RE_OPEN) });
await ok('PUT', '/api/v1/gl/opening', { period_start: '2026-01-01', rows: glOpen });
const OPEN_BAL = new Map(glOpen.map((r) => [accounts.find((a) => a.id === r.account_id).account_no, D(r.debit).minus(r.credit)]));
console.log(`  ลูกหนี้ยกมา ${m2(arOpenTotal)} · เจ้าหนี้ยกมา ${m2(apOpenTotal)} · สินค้ายกมา ${m2(stockOpenValue)} · กำไรสะสม ${m2(RE_OPEN)}`);

// ยอดปีที่แล้ว (2568) — ต้องทำหลังยอดยกมาลูกหนี้/เจ้าหนี้/สินค้า (สร้างปีบัญชี 2568 ทำให้วันเริ่มใช้เลื่อน)
const PL25 = { '4100-01': [-1050000, 0.08], '4100-03': [9000, 0.3], '4400-03': [-38000, 0.15], '5110-00': [735000, 0.08], '5411-01': [118000, 0.02], '5300-11': [62000, 0.05], '5412-14': [6000, 0],
  '5420-05': [35000, 0], '5430-02': [9200, 0.15], '5430-03': [750, 0.2], '5430-05': [1990, 0], '5300-02': [9000, 0.4], '5300-05': [6500, 0.3], '5440-05': [13083, 0], '5440-04': [2417, 0], '5440-03': [2600, 0.1],
  '5440-06': [3600, 0], '5460-04': [380, 0.4], '5470-03': [6100, 0.05], '4200-01': [-1100, 0.2] };
let profit25 = D(0);
for (const [no, [base, vol]] of Object.entries(PL25)) {
  const periods = [];
  for (let p = 1; p <= 12; p++) {
    const v = D(base).times(1 + (rnd() * 2 - 1) * vol).times(1 + (p - 6) * 0.01).toDecimalPlaces(2);
    periods.push({ period_no: p, debit: v.gt(0) ? m2(v) : '0', credit: v.lt(0) ? m2(v.neg()) : '0' });
    profit25 = profit25.minus(v);
  }
  await ok('PUT', '/api/v1/gl/prior-year/entry', { account_id: A(no), opening: { debit: '0', credit: '0' }, periods });
}
for (const no of ['1111-01', '1112-00', '1113-01', '1113-02', '1130-01', '1140-02', '2120-01', '2210-00', '1410-05', '1420-05', '3100-00', '3200-00']) {
  const close = OPEN_BAL.get(no) ?? D(0);
  let open, periods = [];
  if (no === '3200-00') open = close.plus(profit25);   // กำไรปี 2568 ปิดเข้ากำไรสะสมตอนสิ้นปี
  else if (no === '3100-00' || no === '1410-05') open = close;
  else if (no === '2210-00') open = close.minus(300000);
  else if (no === '1420-05') open = close.plus(157000);
  else open = close.times(0.82).toDecimalPlaces(2);
  const move = close.minus(open);
  if (!move.isZero()) {
    let left = move;
    for (let p = 1; p <= 12; p++) {
      const v = p === 12 ? left : move.div(12).times(rf(0.6, 1.4)).toDecimalPlaces(2);
      left = left.minus(v);
      periods.push({ period_no: p, debit: v.gt(0) ? m2(v) : '0', credit: v.lt(0) ? m2(v.neg()) : '0' });
    }
  }
  await ok('PUT', '/api/v1/gl/prior-year/entry', { account_id: A(no), opening: { debit: open.gt(0) ? m2(open) : '0', credit: open.lt(0) ? m2(open.neg()) : '0' }, periods });
}
// งบประมาณ 2569
const BUDGET = { '4100-01': 1250000, '4400-03': 12000, '4200-08': 2500, '5110-00': 900000, '5411-01': 125000, '5300-11': 72000, '5412-14': 6750, '5420-05': 35000, '5430-02': 10000, '5430-03': 900,
  '5430-05': 1990, '5300-02': 12000, '5300-05': 6000, '5420-02': 2500, '5420-08': 6000, '5420-09': 4500, '5460-04': 450, '5470-03': 5000, '5440-05': 13100 };
for (const [no, base] of Object.entries(BUDGET))
  await ok('PUT', '/api/v1/gl/budget/entry', { fiscal_year_id: FY2026, account_id: A(no), periods: Array.from({ length: 12 }, (_, i) => ({ period_no: i + 1, amount: m2(D(base).times([0.9, 0.92, 1, 0.97, 1, 1.03, 0.98, 1, 1.04, 1.08, 1.12, 1.18][i])) })) });

/* ================================================================== 4. รายการประจำวันทั้งปี */
console.log('▶ รายการประจำวัน ม.ค.–ธ.ค. 2569');
const stock = new Map();
const sk = (itemId, whId) => `${itemId}|${whId}`;
async function syncStock() { stock.clear(); for (const r of (await get('/api/v1/stock/balances?limit=5000')).rows) stock.set(sk(r.item_id, r.warehouse_id), Number(r.qty)); }
const qtyOf = (itemId, whId) => stock.get(sk(itemId, whId)) ?? 0;
const take = (itemId, whId, q) => stock.set(sk(itemId, whId), qtyOf(itemId, whId) - q);
const CREDIT_CUS = Object.values(CUS).filter((c) => c.cd > 0);
const CASH_CUS = ['C025', 'C025', 'C017', 'C020', 'C025'].map((c) => CUS[c]);
const whFor = (c) => (['SPK', 'EST'].includes(c.area) ? WH['02'] : WH['01']);
const state = { ivs: [], rrs: [], poPending: new Map(), aeOpen: null, aiOpen: null, serialN: 0, chqN: 1000, payChqN: 5000, cnN: 0, returnedDone: false, assetSold: false };
const SEASON = [0.85, 0.9, 1.0, 0.95, 1.0, 1.05, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2];
const glCache = new Map();
/** ยอดคงเหลือบัญชี ณ วันที่ (จากงบทดลอง — คำนวณสดจากใบสำคัญ) */
async function glBal(no, asOf) {
  if (asOf < '2026-01-01') return OPEN_BAL.get(no) ?? D(0);
  if (!glCache.has(asOf)) glCache.set(asOf, new Map((await get(`/api/v1/reports/trial-balance?from=2026-01-01&to=${asOf}`)).rows.map((r) => [r.account_no, D(r.closing)])));
  return glCache.get(asOf).get(no) ?? D(0);
}
const invalidate = () => glCache.clear();
const docCount = new Map();
const bump = (k) => docCount.set(k, (docCount.get(k) ?? 0) + 1);

/** สร้างบรรทัดขายจากรายการที่วางแผนไว้ (ตัดตามสต๊อกจริง ณ ตอนบันทึก) */
function saleLines(plan, wh, priceType, opt = {}) {
  const lines = [];
  for (const p of plan) {
    if (p.kit) {
      const k = p.kit;
      let q = p.qty;
      for (const b of k.bom) q = Math.min(q, Math.floor(qtyOf(b.item.id, wh) / b.qty));
      if (q <= 0) continue;
      for (const b of k.bom) take(b.item.id, wh, b.qty * q);
      const price = priceType === '1' ? m2(k.price.times(1.07)) : m2(k.price);
      lines.push({ item_id: k.id, qty: String(q), unit_price: price, warehouse_id: wh });
      continue;
    }
    const it = p.item;
    let w = wh, avail = qtyOf(it.id, w);
    if (avail < p.qty && w !== WH['01'] && qtyOf(it.id, WH['01']) > avail) { w = WH['01']; avail = qtyOf(it.id, w); }
    let q = Math.min(p.qty, Math.max(0, avail - (opt.keep ?? 0)));
    if (it.box && q >= it.box.f * 2 && !opt.base) {
      const boxes = Math.floor(q / it.box.f);
      take(it.id, w, boxes * it.box.f);
      const bp = it.price.times(it.box.f).times(0.97);
      lines.push({ item_id: it.id, qty: String(boxes), unit_id: it.box.unit, factor: String(it.box.f), unit_price: priceType === '1' ? m2(bp.times(1.07)) : m2(bp), warehouse_id: w });
      continue;
    }
    if (q <= 0) continue;
    take(it.id, w, q);
    const disc = p.disc ?? null;
    lines.push({ item_id: it.id, qty: String(q), unit_price: priceType === '1' ? m2(it.price.times(1.07)) : m2(it.price), warehouse_id: w, ...(disc ? { discount_text: disc } : {}) });
  }
  return lines;
}
const exVat = (lines) => lines.reduce((s, l) => s.plus(D(l.qty).times(l.unit_price)), D(0));

/* ---------------- งานขาย */
function planSales(m) {
  const chunks = [];
  for (const it of ITEMS) {
    const total = Math.round(it.demand * SEASON[m - 1] * rf(0.85, 1.12));
    const n = it.demand >= 300 ? ri(4, 7) : it.demand >= 50 ? ri(2, 4) : ri(1, 3);
    let left = total;
    for (let k = 0; k < n && left > 0; k++) {
      const q = k === n - 1 ? left : Math.max(1, Math.round((total / n) * rf(0.6, 1.4)));
      chunks.push({ item: it, qty: Math.min(q, left) }); left -= Math.min(q, left);
    }
  }
  // ช่องเอกสาร: ขายเชื่อ 10 (3 ใบผ่านใบเสนอราคา→ใบสั่งขาย) · ขายสด 5
  const ivSlots = Array.from({ length: 10 }, (_, k) => ({ kind: 'IV', day: 3 + k * 2 + ri(0, 1), cus: pick(CREDIT_CUS.filter((c) => !['C016'].includes(c.code) || k === 4)), plan: [], viaSO: k % 3 === 1 }));
  const hsSlots = Array.from({ length: 5 }, (_, k) => ({ kind: 'HS', day: 4 + k * 5 + ri(0, 2), cus: CASH_CUS[k], plan: [] }));
  for (const c of chunks) {
    const toHS = chance(0.18) && c.item.price.lt(1000);
    const slot = toHS ? pick(hsSlots) : pick(ivSlots);
    slot.plan.push({ item: c.item, qty: c.qty, disc: !toHS && chance(0.08) ? pick(['3%', '5%', '2+1%']) : null });
  }
  // สินค้าชุด
  pick(hsSlots).plan.push({ kit: KIT['20-SETC-GIFT'], qty: m >= 11 ? ri(8, 15) : ri(2, 5) });
  pick(hsSlots).plan.push({ kit: KIT['20-SETO-STRT'], qty: ri(2, 6) });
  pick(ivSlots).plan.push({ kit: KIT['20-SETI-COMP'], qty: ri(1, 4) });
  if (m >= 11) pick(ivSlots).plan.push({ kit: KIT['20-SETC-GIFT'], qty: ri(20, 40) });
  for (const s of ivSlots) {
    const date = wday(m, s.day);
    if (s.viaSO) scheduleQuote(m, date, s);
    else at(date, 20, `ขายเชื่อ ${s.cus.code}`, (d) => createIV(d, s.cus, s.plan));
  }
  for (const s of hsSlots) at(wday(m, s.day), 20, `ขายเงินสด ${s.cus.code}`, (d) => createHS(d, s.cus, s.plan));
  // ใบเสนอราคาที่ไม่ได้งาน 1 ใบ/เดือน
  at(wday(m, 12), 15, 'ใบเสนอราคา (ไม่ได้งาน)', async (d) => {
    const c = pick(CREDIT_CUS);
    const r = await tryOk('QT ไม่ได้งาน', 'POST', '/api/v1/quotations', { doc_type_id: dt('QT'), doc_date: d, party_id: c.id, salesperson_id: SLM[c.sp], price_type: '2', vat_rate: 7, remark: 'ยืนราคา 30 วัน',
      lines: [{ item_id: ITEM['13-MONI-24IN'].id, qty: String(ri(5, 15)), unit_price: '4450.00' }, { item_id: ITEM['13-UPSB-1KVA'].id, qty: String(ri(5, 15)), unit_price: '2890.00' }, { item_id: SRV['30-SERV-INSTL'].id, qty: '1', unit_price: '3500.00' }] });
    if (r) { bump('QT'); await tryOk('สถานะใบเสนอราคา', 'PUT', `/api/v1/doc-status/doc/${r.id}`, { status_code: m >= 11 ? '1' : '3' }); }
  });
  // ค่าบริการบำรุงรักษารายเดือน (C006 C014 C018)
  for (const [k, c] of ['C006', 'C014', 'C018'].entries()) at(wday(m, 1 + k), 18, `ค่าบริการรายเดือน ${c}`, async (d) => {
    const lines = [{ item_id: SRV['30-SERV-MAINT'].id, qty: '1', unit_price: '2500.00', description: `ค่าบริการบำรุงรักษาเครื่องพิมพ์ประจำเดือน ${pad(m)}/${2026 + 543}` }];
    if (c === 'C014' && m % 3 === 0) lines.push({ item_id: SRV['30-SERV-NETWK'].id, qty: '1', unit_price: '4500.00' });
    const r = await tryOk(`IV บริการ ${c}`, 'POST', '/api/v1/sales-invoices', { doc_type_id: dt('IV'), doc_date: d, party_id: CUS[c].id, salesperson_id: SLM[CUS[c].sp], department_id: DEP['02'], price_type: '2', vat_rate: 7, lines });
    if (r) { bump('IV'); state.ivs.push({ id: r.id, no: r.doc_no, date: d, cus: CUS[c], lines, service: exVat(lines) }); }
  });
}
async function createIV(d, c, plan, extra = {}) {
  await syncStock();
  const wh = whFor(c);
  const lines = saleLines(plan, wh, '2');
  if (!lines.length) return;
  let service = D(0);
  const units = lines.filter((l) => [ITEM['13-MONI-24IN'].id, ITEM['13-UPSB-1KVA'].id, ITEM['14-PRNT-LJ211'].id].includes(l.item_id)).reduce((s, l) => s + Number(l.qty), 0);
  if (units) { lines.push({ item_id: SRV['30-SERV-INSTL'].id, qty: String(units), unit_price: '350.00' }); service = service.plus(D(350).times(units)); }
  if (chance(0.25)) lines.push({ item_id: SRV['30-SERV-DELIV'].id, qty: '1', unit_price: m2(D(ri(3, 12) * 100)) });
  const body = { doc_type_id: dt('IV'), doc_date: d, party_id: c.id, salesperson_id: SLM[c.sp], department_id: DEP['02'], price_type: '2', vat_rate: 7, your_ref: `PO-${c.code}-${d.slice(2, 4)}${d.slice(5, 7)}${ri(10, 99)}`,
    ship_via_code: c.area === 'EST' ? 'KRY' : 'OWN', discount_text: chance(0.1) ? '1%' : null, lines, ...extra };
  if (state.aiOpen && state.aiOpen.cus === c.code && !extra.deposits) {
    const base = exVat(lines).times(0.6).toDecimalPlaces(2);
    const amt = Decimal.min(state.aiOpen.left, base);
    if (amt.gt(0)) { body.deposits = [{ header_id: state.aiOpen.id, amount: m2(amt) }]; state.aiOpen.left = state.aiOpen.left.minus(amt); if (state.aiOpen.left.lte(0)) state.aiOpen = null; }
  }
  const r = await tryOk(`IV ${c.code}`, 'POST', '/api/v1/sales-invoices', body);
  if (!r) return null;
  bump('IV');
  state.ivs.push({ id: r.id, no: r.doc_no, date: d, cus: c, lines, service });
  // หมายเลขเครื่องของเครื่องพิมพ์ที่ขาย
  const pr = lines.find((l) => l.item_id === ITEM['14-PRNT-LJ211'].id);
  if (pr) for (let k = 0; k < Number(pr.qty); k++) {
    const sn = `VNB3R${String(41000 + ++state.serialN).padStart(6, '0')}`;
    await tryOk('ทะเบียนหมายเลขสินค้า', 'POST', '/api/v1/serials', { serial_no: sn, machine_no: 'M211dw', ref_code: r.doc_no, item_id: ITEM['14-PRNT-LJ211'].id, category_code: 'PRN', description: 'เครื่องพิมพ์เลเซอร์ขาวดำ ไร้สาย',
      sale_date: d, warranty_end: `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`, customer_id: c.id, salesperson_id: SLM[c.sp],
      services: state.serialN % 3 === 1 ? [{ service_date: addDays(d, 2), service_by: 'ช่างวิทยา', detail: 'ติดตั้งและตั้งค่า Wi-Fi ที่หน้างาน ทดสอบพิมพ์ผ่าน' }] : [] });
  }
  if (state.ivs.length % 9 === 0) await tryOk('หมายเหตุเอกสาร', 'PUT', `/api/v1/notes/doc/${r.id}`, { doc: ['ส่งของที่คลังสินค้าลูกค้า ติดต่อก่อนเข้าส่ง 1 วัน', 'แนบสำเนาใบสั่งซื้อของลูกค้าพร้อมใบวางบิล'], lines: {} });
  return r;
}
async function createHS(d, c, plan) {
  await syncStock();
  const lines = saleLines(plan, WH['01'], '1');
  if (!lines.length) return;
  const net = exVat(lines);
  const body = { doc_type_id: dt('HS'), doc_date: d, party_id: c.id, salesperson_id: SLM[c.sp], department_id: DEP['02'], price_type: '1', vat_rate: 7, lines, payments: [] };
  const mode = ri(0, 2);
  if (mode === 1) body.payments = [{ payment_method_id: PMR.TB, amount: m2(net), reference_no: `TRF${d.replace(/-/g, '').slice(2)}${ri(100, 999)}` }];
  else if (mode === 2 && net.gt(2000)) body.payments = [{ payment_method_id: PMR.TK, amount: m2(net.div(2).toDecimalPlaces(0)), reference_no: `QR${ri(100000, 999999)}` }];
  const r = await tryOk(`HS ${c.code}`, 'POST', '/api/v1/cash-sales', body);
  if (!r) return;
  bump('HS');
  // ทุก ๆ 15 ใบ: พนักงานป้อนผิด ยกเลิกแล้วออกใบใหม่ (เอกสารสถานะ C ใบสำคัญ C สต๊อกคืน)
  if (docCount.get('HS') % 15 === 0) {
    if (await tryOk('ยกเลิกขายสด', 'POST', `/api/v1/cash-sales/${r.id}/cancel`, { reason: 'ป้อนราคาผิด ยกเลิกแล้วออกใบใหม่' })) {
      bump('ยกเลิกเอกสาร');
      if (await tryOk(`HS ใบใหม่ ${c.code}`, 'POST', '/api/v1/cash-sales', { ...body, remark: `ออกแทน ${r.doc_no} ที่ยกเลิก` })) bump('HS');
    }
  }
}
function scheduleQuote(m, ivDate, s) {
  const qd = addDays(ivDate, -7) < monthStart(m) ? monthStart(m) : addDays(ivDate, -7);
  const qDate = wday(m, Number(qd.slice(8, 10)));
  const ctx = {};
  at(qDate, 12, `ใบเสนอราคา ${s.cus.code}`, async (d) => {
    const lines = s.plan.filter((p) => p.item && p.qty > 0).map((p) => ({ item_id: p.item.id, qty: String(p.qty), unit_price: m2(p.item.price), ...(p.disc ? { discount_text: p.disc } : {}) }));
    if (!lines.length) return;
    const r = await tryOk(`QT ${s.cus.code}`, 'POST', '/api/v1/quotations', { doc_type_id: dt('QT'), doc_date: d, party_id: s.cus.id, salesperson_id: SLM[s.cus.sp], price_type: '2', vat_rate: 7, remark: 'ยืนราคา 30 วัน ส่งของภายใน 7 วันหลังได้รับใบสั่งซื้อ', lines });
    if (!r) return;
    bump('QT'); ctx.qt = r;
    at(addDays(d, 2) > ivDate ? d : addDays(d, 2), 13, `แปลงเป็นใบสั่งขาย ${s.cus.code}`, async (d2) => {
      const so = await tryOk(`QT→SO ${s.cus.code}`, 'POST', `/api/v1/quotations/${ctx.qt.id}/convert`, { doc_date: d2, delivery_date: ivDate });
      if (!so) return;
      bump('SO'); ctx.so = so;
      await tryOk('สถานะใบเสนอราคา', 'PUT', `/api/v1/doc-status/doc/${ctx.qt.id}`, { status_code: '2' });
    });
  });
  at(ivDate, 21, `ขายเชื่อตามใบสั่งขาย ${s.cus.code}`, async (d) => {
    if (!ctx.so) return createIV(d, s.cus, s.plan);
    await syncStock();
    const open = (await get(`/api/v1/orders/open?cls=SO&party_id=${s.cus.id}`)).rows.filter((o) => o.header_id === ctx.so.id);
    const wh = whFor(s.cus);
    const lines = [];
    for (const o of open) {
      const avail = Math.max(qtyOf(o.item_id, wh), qtyOf(o.item_id, WH['01']));
      const w = qtyOf(o.item_id, wh) >= qtyOf(o.item_id, WH['01']) ? wh : WH['01'];
      const q = Math.min(Number(o.remaining_qty), avail);
      if (q <= 0) continue;
      take(o.item_id, w, q);
      lines.push({ item_id: o.item_id, qty: String(q), unit_price: o.unit_price, discount_text: o.discount_text, warehouse_id: w, source_line_id: o.line_id });
    }
    if (!lines.length) return;
    const r = await tryOk(`IV อ้าง SO ${s.cus.code}`, 'POST', '/api/v1/sales-invoices', { doc_type_id: dt('IV'), doc_date: d, party_id: s.cus.id, salesperson_id: SLM[s.cus.sp], department_id: DEP['02'], price_type: '2', vat_rate: 7, your_ref: ctx.so.doc_no, lines });
    if (r) { bump('IV'); state.ivs.push({ id: r.id, no: r.doc_no, date: d, cus: s.cus, lines, service: D(0) }); }
    // ส่งไม่ครบ: ยกเลิกยอดค้างที่เหลือ (ลูกค้าขอยกเลิก)
    const left = (await get(`/api/v1/orders/open?cls=SO&party_id=${s.cus.id}`)).rows.filter((o) => o.header_id === ctx.so.id);
    for (const o of left) await tryOk('ยกเลิกยอดค้างส่ง', 'POST', `/api/v1/sales-orders/${ctx.so.id}/lines/${o.line_id}/cancel`, { qty: o.remaining_qty, reason_code: '02', date: d });
  });
}
/* ---------------- งานซื้อ */
async function replenish(d) {
  await syncStock();
  const bySup = new Map();
  for (const it of ITEMS) {
    const have = qtyOf(it.id, WH['01']) + qtyOf(it.id, WH['02']) + (state.poPending.get(it.id) ?? 0);
    const reorder = it.demand * 1.05;
    if (have >= reorder) continue;
    let q = Math.ceil(it.demand * 1.5 - have);
    const pack = ITEM_DEF.find((x) => x[0] === it.code)[6]?.[1] ?? (it.demand >= 100 ? 10 : 1);
    q = Math.ceil(q / pack) * pack;
    if (!bySup.has(it.sup)) bySup.set(it.sup, []);
    bySup.get(it.sup).push({ it, q });
  }
  for (const [sup, rows] of bySup) {
    const s = SUP[sup];
    const lines = rows.map(({ it, q }) => ({ item_id: it.id, qty: String(q), unit_price: m2(it.cost.times(rf(0.97, 1.03))), warehouse_id: WH['01'] }));
    if (sup === 'S005') {   // ผู้จำหน่ายเครื่องดื่มขายเงินสด
      // ยอดเกิน 5,000 โอนจากบัญชีกสิกร (บางครั้งจ่ายเงินสดบางส่วน) · ยอดเล็กจ่ายเงินสด
      const total = exVat(lines).times(1.07).toDecimalPlaces(2);
      const pay = total.gt(5000) ? [{ payment_method_id: PMP.TK, amount: m2(chance(0.3) ? total.minus(2000) : total), reference_no: `KTRF${ri(100000, 999999)}` }] : [];
      const r = await tryOk(`HP ${sup}`, 'POST', '/api/v1/cash-purchases', { doc_type_id: dt('HP'), doc_date: d, party_id: s.id, price_type: '2', vat_rate: 7, ref_no: `NB${d.replace(/-/g, '').slice(2)}${ri(10, 99)}`, ref_date: d, department_id: DEP['04'], lines, payments: pay });
      if (r) bump('HP');
      continue;
    }
    const po = await tryOk(`PO ${sup}`, 'POST', '/api/v1/purchase-orders', { doc_type_id: dt('PO'), doc_date: d, party_id: s.id, price_type: '2', vat_rate: 7, delivery_date: addDays(d, 4), department_id: DEP['04'], remark: 'ส่งของที่คลังสำนักงานใหญ่ ก่อน 16.00 น.', lines });
    if (!po) continue;
    bump('PO');
    for (const { it, q } of rows) state.poPending.set(it.id, (state.poPending.get(it.id) ?? 0) + q);
    const partial = chance(0.12);
    at(addDays(d, ri(3, 5)), 10, `รับสินค้าตามใบสั่งซื้อ ${sup}`, (d2) => receivePO(d2, s, po, partial ? 0.7 : 1));
  }
}
async function receivePO(d, s, po, frac) {
  const open = (await get(`/api/v1/orders/open?cls=PO&party_id=${s.id}`)).rows.filter((o) => o.header_id === po.id);
  if (!open.length) return;
  const lines = open.map((o) => ({ item_id: o.item_id, qty: String(frac < 1 ? Math.max(1, Math.floor(Number(o.remaining_qty) * frac)) : Number(o.remaining_qty)), unit_price: o.unit_price, warehouse_id: WH['01'], source_line_id: o.line_id }));
  const body = { doc_type_id: dt('RR'), doc_date: d, party_id: s.id, price_type: '2', vat_rate: 7, ref_no: `${s.code}-INV-${d.slice(2, 4)}${d.slice(5, 7)}${ri(100, 999)}`, ref_date: d, your_ref: po.doc_no, department_id: DEP['04'], lines };
  if (state.aeOpen && state.aeOpen.sup === s.code) {
    const amt = Decimal.min(state.aeOpen.left, exVat(lines).times(0.5).toDecimalPlaces(2));
    if (amt.gt(0)) { body.deposits = [{ header_id: state.aeOpen.id, amount: m2(amt) }]; state.aeOpen.left = state.aeOpen.left.minus(amt); if (state.aeOpen.left.lte(0)) state.aeOpen = null; }
  }
  const r = await tryOk(`RR ${s.code}`, 'POST', '/api/v1/purchase-invoices', body);
  if (!r) return;
  bump('RR');
  for (const l of lines) state.poPending.set(l.item_id, Math.max(0, (state.poPending.get(l.item_id) ?? 0) - Number(l.qty)));
  state.rrs.push({ id: r.id, no: r.doc_no, date: d, sup: s, lines });
  if (frac < 1) {
    if (chance(0.5)) at(addDays(d, 6), 10, `รับสินค้าส่วนที่เหลือ ${s.code}`, (d2) => receivePO(d2, s, po, 1));
    else at(addDays(d, 2), 11, `ยกเลิกยอดค้างรับ ${s.code}`, async (d2) => {
      for (const o of (await get(`/api/v1/orders/open?cls=PO&party_id=${s.id}`)).rows.filter((x) => x.header_id === po.id)) {
        if (await tryOk('ยกเลิกยอดค้างรับ', 'POST', `/api/v1/purchase-orders/${po.id}/lines/${o.line_id}/cancel`, { qty: o.remaining_qty, reason_code: '01', date: d2 }))
          state.poPending.set(o.item_id, Math.max(0, (state.poPending.get(o.item_id) ?? 0) - Number(o.remaining_qty)));
      }
    });
  }
}
/* ---------------- รับชำระ / จ่ายชำระ */
const chqNo = (prefix) => `${prefix}${String(++state.chqN).padStart(7, '0')}`;
async function receipts(d, m, group) {
  const cutoff = monthEnd(m);
  for (const c of CREDIT_CUS.filter((_, i) => i % 2 === group)) {
    const open = (await get(`/api/v1/ar-receipts/open-items?party_id=${c.id}`)).rows;
    let sel = open.filter((o) => (o.due_date ? String(o.due_date).slice(0, 10) : String(o.doc_date).slice(0, 10)) <= cutoff && String(o.doc_date).slice(0, 10) < d);
    if (c.code === 'C023') sel = sel.filter((o) => String(o.doc_date).slice(0, 10) < addDays(d, -75));   // ลูกค้าชำระช้า
    if (!sel.length) continue;
    const sign = (o) => (o.doc_class === 'CN' ? -1 : 1);
    const billed = sel.reduce((s, o) => s.plus(D(o.outstanding).times(sign(o))), D(0));
    if (billed.lte(0)) continue;
    const svc = state.ivs.filter((x) => sel.some((o) => o.header_id === x.id)).reduce((s, x) => s.plus(x.service), D(0));
    const wht = c.wht && svc.gt(0) ? svc.times(0.03).toDecimalPlaces(2) : D(0);
    const disc = c.code === 'C005' ? billed.times(0.01).toDecimalPlaces(2) : D(0);
    const due = billed.minus(wht).minus(disc);
    const body = { doc_type_id: dt('RE'), doc_date: d, party_id: c.id, salesperson_id: SLM[c.sp], department_id: DEP['03'], settlements: sel.map((o) => ({ invoice_header_id: o.header_id, amount: o.outstanding })),
      wht_amount: m2(wht), cash_discount_amount: m2(disc), payments: [] };
    if (c.pay === 'CQ') body.payments = [{ payment_method_id: PMR.CQ, amount: m2(due), reference_no: chqNo(pick(['', 'B', 'K'])), cheque_date: addDays(d, ri(0, 10)), bank_id: BANK[pick(['BBL', 'KBANK', 'SCB', 'KTB', 'BAY'])], bank_branch: pick(['สีลม', 'อโศก', 'บางนา', 'งามวงศ์วาน', 'ชลบุรี']) }];
    else if (c.pay === 'TK' || c.pay === 'TB') body.payments = [{ payment_method_id: PMR[c.pay], amount: m2(due), reference_no: `T${d.replace(/-/g, '').slice(2)}${ri(1000, 9999)}` }];
    const r = await tryOk(`RE ${c.code}`, 'POST', '/api/v1/ar-receipts', body);
    if (r) bump('RE');
  }
}
async function payments(d, m) {
  for (const s of Object.values(SUP).filter((x) => x.cd > 0)) {
    const open = (await get(`/api/v1/ap-payments/open-items?party_id=${s.id}`)).rows;
    const sel = open.filter((o) => (o.due_date ? String(o.due_date).slice(0, 10) : String(o.doc_date).slice(0, 10)) <= monthEnd(m) && String(o.doc_date).slice(0, 10) < d);
    if (!sel.length) continue;
    const billed = sel.reduce((t, o) => t.plus(D(o.outstanding).times(o.doc_class === 'DN' ? -1 : 1)), D(0));
    if (billed.lte(0)) continue;
    const body = { doc_type_id: dt('PS'), doc_date: d, party_id: s.id, department_id: DEP['03'], settlements: sel.map((o) => ({ invoice_header_id: o.header_id, amount: o.outstanding })), payments: [], wht: [] };
    let due = billed;
    if (s.wht) {
      const base = sel.reduce((t, o) => t.plus(D(o.net_amount).minus(o.vat_amount).times(o.doc_class === 'DN' ? -1 : 1)), D(0)).toDecimalPlaces(2);
      const tax = base.times(s.wht[2]).div(100).toDecimalPlaces(2);
      body.wht = [{ form_type: s.wht[0], income_type: s.wht[1], rate: String(s.wht[2]), paid_amount: m2(base), tax_amount: m2(tax), condition: '1' }];
      due = due.minus(tax);
    }
    if (['S001', 'S004'].includes(s.code)) body.payments = [{ payment_method_id: PMP.CQ, amount: m2(due), reference_no: `BBL${String(++state.payChqN).padStart(7, '0')}`, cheque_date: addDays(d, ri(0, 5)) }];
    else body.payments = [{ payment_method_id: PMP.TK, amount: m2(due), reference_no: `KTRF${d.replace(/-/g, '').slice(2)}${ri(100, 999)}` }];
    const r = await tryOk(`PS ${s.code}`, 'POST', '/api/v1/ap-payments', body);
    if (r) bump('PS');
  }
}
/* ---------------- เช็ค */
async function depositCheques(d, bank) {
  const rows = (await get(`/api/v1/cheques?direction=R&status=00,02&to=${d}`)).rows.filter((c) => !c.deposit_header_id);
  if (!rows.length) return;
  const slip = await tryOk('ใบนำฝากเช็ค', 'POST', '/api/v1/cheque-deposits', { cheque_ids: rows.map((c) => c.id), bank_account_id: BA[bank].id, doc_date: d, doc_type_id: DT.BQ ?? null, charge: rows.length > 3 ? '20.00' : '0', remark: `นำฝากเช็ค ${rows.length} ใบ` });
  if (!slip) return;
  bump('BQ');
  at(addDays(d, ri(1, 3)), 30, 'ผ่านเช็คทั้งใบนำฝาก', async (d2) => { if (await tryOk('ผ่านเช็คใบนำฝาก', 'POST', `/api/v1/cheque-deposits/${slip.id}/pass`, { pass_date: d2 })) bump('เช็ครับผ่าน (ใบนำฝาก)'); });
}
async function passPaidCheques(d) {
  const rows = (await get(`/api/v1/cheques?direction=P&status=05&to=${addDays(d, -2)}`)).rows;
  if (!rows.length) return;
  if (await tryOk('ผ่านเช็คจ่าย', 'POST', '/api/v1/cheques/pass', { cheque_ids: rows.map((c) => c.id), pass_date: d })) for (const _ of rows) bump('เช็คจ่ายผ่าน');
}
/* ---------------- สมุดรายวัน */
async function jv(d, book, description, lines, reference) {
  const L = lines.filter((l) => !D(l.debit ?? 0).isZero() || !D(l.credit ?? 0).isZero()).map((l) => ({ account_id: l.account_id, department_id: l.department_id ?? null, description: l.description ?? null, debit: m2(l.debit ?? 0), credit: m2(l.credit ?? 0) }));
  if (L.length < 2) return null;
  const r = await tryOk(`JV ${description}`, 'POST', '/api/v1/gl/journals', { journal_book_id: BOOK[book], voucher_date: d, description, reference: reference ?? null, lines: L });
  if (r) { bump('ใบสำคัญทั่วไป (JV)'); invalidate(); }
  return r;
}
const BANK_GL = '1112-00';

/* ---------------- วางแผนรายเดือน */
function planMonth(m) {
  const me = monthEnd(m);
  const thaiMonth = `${pad(m)}/${2026 + 543}`;
  // เติมสต๊อกรายสัปดาห์ + โอนย้ายไปคลังบางนา
  for (const dd of [2, 9, 16, 23]) at(wday(m, dd), 5, 'สั่งซื้อเติมสต๊อก', (d) => replenish(d));
  at(wday(m, 3), 6, 'โอนสินค้าไปคลังบางนา', async (d) => {
    await syncStock();
    const lines = [];
    for (const it of ITEMS) {
      const target = Math.round(it.demand * 0.3), have = qtyOf(it.id, WH['02']), src = qtyOf(it.id, WH['01']);
      const q = Math.min(target - have, Math.floor(src * 0.3));
      if (q > 0 && have < target * 0.6) lines.push({ item_id: it.id, qty: String(q) });
    }
    if (!lines.length) return;
    if (await tryOk('RL โอนย้ายคลัง', 'POST', '/api/v1/stock-transfers', { doc_type_id: dt('RL'), doc_date: d, warehouse_id: WH['01'], to_warehouse_id: WH['02'], department_id: DEP['04'], remark: `เติมสินค้าคลังบางนา ${thaiMonth}`, lines })) bump('RL');
  });
  planSales(m);
  // รับชำระ 2 รอบ / จ่ายชำระ 2 รอบ
  at(wday(m, 10), 40, 'รับชำระหนี้ รอบ 1', (d) => receipts(d, m, 0));
  at(wday(m, 24), 40, 'รับชำระหนี้ รอบ 2', (d) => receipts(d, m, 1));
  at(wday(m, 12), 41, 'จ่ายชำระหนี้ รอบ 1', (d) => payments(d, m));
  at(wday(m, 27), 41, 'จ่ายชำระหนี้ รอบ 2', (d) => payments(d, m));
  // เช็ค
  for (const dd of [6, 13, 20, 27]) at(wday(m, dd), 45, 'นำฝากเช็ค', (d) => depositCheques(d, dd === 20 ? 'B02' : 'B01'));
  for (const dd of [8, 18, 28]) at(wday(m, dd), 46, 'ผ่านเช็คจ่าย', (d) => passPaidCheques(d));
  if (m === 6) {
    // เช็คคืน: นำฝากเป็นใบ ๆ แล้วธนาคารคืนเช็ค → ลูกค้าเปลี่ยนเช็คใบใหม่ → นำฝากใหม่
    at(wday(m, 24), 42, 'เช็คคืน', async (d) => {
      const c = (await get(`/api/v1/cheques?direction=R&status=00`)).rows.filter((x) => !x.deposit_header_id).sort((x, y) => String(x.cheque_date).localeCompare(String(y.cheque_date)))[0];
      if (!c) return;
      if (!(await tryOk('นำฝากเช็คเป็นใบ', 'POST', '/api/v1/cheques/deposit', { cheque_ids: [c.id], bank_account_id: BA.B01.id, deposit_date: d }))) return;
      if (!(await tryOk('บันทึกเช็คคืน', 'POST', `/api/v1/cheques/${c.id}/return`, { return_date: addDays(d, 2), reason: 'เงินในบัญชีไม่พอจ่าย (โปรดติดต่อผู้สั่งจ่าย)' }))) return;
      bump('เช็คคืน');
      await tryOk('เปลี่ยนเช็คใบใหม่', 'PUT', `/api/v1/cheques/${c.id}`, { cheque_no: `${c.cheque_no}R`, cheque_date: addDays(d, 7), remark: `ลูกค้าเปลี่ยนเช็คใบใหม่แทน ${c.cheque_no} ที่คืน` });
    });
  }
  if (m === 9) at(wday(m, 9), 44, 'ผ่านเช็ครับเป็นใบ ๆ', async (d) => {
    const c = (await get(`/api/v1/cheques?direction=R&status=00&to=${d}`)).rows.find((x) => !x.deposit_header_id);
    if (c && await tryOk('ผ่านเช็ครับ (ไม่ใช้ใบนำฝาก)', 'POST', '/api/v1/cheques/pass', { cheque_ids: [c.id], pass_date: d, bank_account_id: BA.B03.id })) bump('เช็ครับผ่าน (เป็นใบ)');
  });
  // ลดหนี้ / เพิ่มหนี้
  at(wday(m, 21), 25, 'ลดหนี้/รับคืน', async (d) => {
    const iv = [...state.ivs].reverse().find((x) => x.date < d && x.lines.some((l) => !l.unit_id && Object.values(ITEM).some((it) => it.id === l.item_id)));
    if (!iv) return;
    const l = iv.lines.find((x) => !x.unit_id && Object.values(ITEM).some((it) => it.id === x.item_id));
    const ret = m % 2 === 1;
    const q = ret ? String(Math.max(1, Math.min(Number(l.qty), ri(1, 4)))) : '1';
    const lines = [{ item_id: l.item_id, qty: q, unit_price: ret ? l.unit_price : m2(D(l.unit_price).times(Number(l.qty)).times(0.05).toDecimalPlaces(0).plus(1)), warehouse_id: l.warehouse_id, return_to_stock: ret,
      description: ret ? undefined : 'ส่วนลดเพิ่มเติมเนื่องจากสินค้าส่งล่าช้า' }];
    const r = await tryOk('CN', 'POST', '/api/v1/ar-credit-notes', { doc_type_id: dt('CN'), doc_date: d, party_id: iv.cus.id, salesperson_id: SLM[iv.cus.sp], price_type: '2', vat_rate: 7, ref_header_id: iv.id, remark: ret ? 'ลูกค้าคืนสินค้าชำรุด' : 'ลดราคาให้ลูกค้า', lines });
    if (r) bump('CN');
  });
  if (m % 3 === 2) at(wday(m, 17), 25, 'ใบเพิ่มหนี้', async (d) => {
    const iv = [...state.ivs].reverse().find((x) => x.date < d && x.cus.code !== 'C006');
    if (!iv) return;
    const r = await tryOk('DR', 'POST', '/api/v1/ar-debit-notes', { doc_type_id: dt('DR'), doc_date: d, party_id: iv.cus.id, salesperson_id: SLM[iv.cus.sp], price_type: '2', vat_rate: 7, ref_header_id: iv.id, remark: 'ค่าขนส่งด่วนเพิ่มเติมตามที่ลูกค้าขอ',
      lines: [{ item_id: SRV['30-SERV-DELIV'].id, qty: '1', unit_price: m2(D(ri(5, 15) * 100)) }] });
    if (r) bump('DR');
  });
  // มัดจำรับ (ก.พ. พ.ค. ส.ค. พ.ย.) → หักในบิลถัดไปของ C016
  if (m % 3 === 2) {
    at(wday(m, 6), 22, 'รับเงินมัดจำ', async (d) => {
      const r = await tryOk('AI', 'POST', '/api/v1/ar-deposits', { doc_type_id: dt('AI'), doc_date: d, party_id: CUS.C016.id, salesperson_id: SLM.SP01, price_type: '2', vat_rate: 7,
        lines: [{ description: `เงินมัดจำค่าอุปกรณ์สำนักงานโครงการขยายสาขา (${thaiMonth})`, amount: '40000.00' }], payments: [{ payment_method_id: PMR.TK, amount: '42800.00', reference_no: `TFD${ri(100000, 999999)}` }] });
      if (r) { bump('AI'); state.aiOpen = { id: r.id, cus: 'C016', left: D(40000) }; }
    });
    at(wday(m, 19), 23, 'ขายเชื่อหักมัดจำ C016', (d) => createIV(d, CUS.C016, [{ item: ITEM['13-MONI-24IN'], qty: ri(4, 8) }, { item: ITEM['13-UPSB-1KVA'], qty: ri(3, 6) }, { item: ITEM['11-PAPR-A480'], qty: ri(100, 200) }]));
  }
  // มัดจำจ่าย (มี.ค. มิ.ย. ก.ย. ธ.ค.) ให้ S003 → หักในบิลซื้อถัดไป
  if (m % 3 === 0) at(wday(m, 4), 4, 'จ่ายเงินมัดจำ', async (d) => {
    const r = await tryOk('AE', 'POST', '/api/v1/ap-deposits', { doc_type_id: dt('AE'), doc_date: d, party_id: SUP.S003.id, price_type: '2', vat_rate: 7, ref_no: `ITC-DEP-${pad(m)}`, ref_date: d,
      lines: [{ description: 'จ่ายมัดจำค่าจอมอนิเตอร์และเครื่องสำรองไฟ (สั่งจองล่วงหน้า)', amount: '30000.00' }], payments: [{ payment_method_id: PMP.TK, amount: '32100.00', reference_no: `KDEP${ri(10000, 99999)}` }] });
    if (r) { bump('AE'); state.aeOpen = { id: r.id, sup: 'S003', left: D(30000) }; }
  });
  // รายได้อื่น
  at(wday(m, 20), 26, 'รายได้อื่น', async (d) => {
    const scrap = m % 2 === 1;
    const body = scrap
      ? { doc_type_id: dt('OI'), doc_date: d, party_name: 'ร้านรับซื้อของเก่า ส.เจริญ', price_type: '2', vat_rate: 7, lines: [{ item_id: INC['40-INCO-SCRAP'], amount: m2(D(ri(12, 30) * 100)) }], payments: [] }
      : { doc_type_id: dt('OI'), doc_date: d, party_id: CUS.C011.id, price_type: '2', vat_rate: 7, lines: [{ item_id: INC['40-INCO-RENT'], amount: '6000.00', description: `ค่าเช่าพื้นที่ติดตั้งป้ายโฆษณา 2 เดือน (${thaiMonth})` }], wht_amount: '300.00', payments: [{ payment_method_id: PMR.TK, amount: '6120.00', reference_no: `RENT${pad(m)}` }] };
    if (await tryOk('OI', 'POST', '/api/v1/other-income-docs', body)) bump('OI');
  });
  if (m === 12) at(wday(m, 15), 26, 'รายได้ค่านายหน้า', async (d) => {
    if (await tryOk('OI ค่านายหน้า', 'POST', '/api/v1/other-income-docs', { doc_type_id: dt('OI'), doc_date: d, party_id: CUS.C018.id, price_type: '2', vat_rate: 7, lines: [{ item_id: INC['40-INCO-COMM'], amount: '15000.00', description: 'ส่วนแบ่งยอดขายระบบบ้านอัจฉริยะ ปี 2569' }], wht_amount: '450.00', payments: [{ payment_method_id: PMR.TB, amount: '15600.00', reference_no: 'COMM2569' }] })) bump('OI');
  });
  // ค่าใช้จ่ายอื่น
  const oe = async (d, sup, code, amt, opt = {}) => {
    const s = SUP[sup];
    const vat = opt.vat ?? 7;
    const base = D(amt);
    const body = { doc_type_id: dt('OE'), doc_date: d, party_id: s.id, price_type: vat ? '2' : '0', vat_rate: vat, ref_no: opt.ref ?? `${sup}-${d.slice(2, 4)}${d.slice(5, 7)}`, ref_date: d, department_id: DEP[opt.dep ?? '01'],
      lines: [{ item_id: EXP[code], amount: m2(base), description: opt.desc ?? null, department_id: DEP[opt.dep ?? '01'] }], wht: [], payments: [] };
    let pay = base.times(1 + vat / 100).toDecimalPlaces(2);
    if (s.wht) { const tax = base.times(s.wht[2]).div(100).toDecimalPlaces(2); body.wht = [{ form_type: s.wht[0], income_type: s.wht[1], rate: String(s.wht[2]), paid_amount: m2(base), tax_amount: m2(tax), condition: '1' }]; pay = pay.minus(tax); }
    if (opt.method === 'CQ') body.payments = [{ payment_method_id: PMP.CQ, amount: m2(pay), reference_no: `BBL${String(++state.payChqN).padStart(7, '0')}`, cheque_date: d }];
    else if (opt.method !== 'CA') body.payments = [{ payment_method_id: PMP[opt.method ?? 'TK'], amount: m2(pay), reference_no: `${opt.method ?? 'TK'}${d.replace(/-/g, '').slice(2)}${ri(10, 99)}` }];
    if (await tryOk(`OE ${code}`, 'POST', '/api/v1/other-expense-docs', body)) bump('OE');
  };
  at(wday(m, 2), 30, 'ค่าเช่าสำนักงาน', (d) => oe(d, 'S007', '50-EXPN-RENT', '35000', { vat: 0, method: 'CQ', desc: `ค่าเช่าสำนักงานประจำเดือน ${thaiMonth}`, ref: `RENT-${pad(m)}` }));
  at(wday(m, 8), 30, 'ค่าไฟฟ้า', (d) => oe(d, 'S008', '50-EXPN-ELEC', m2(D(ri(8200, 11800)).times(m >= 3 && m <= 6 ? 1.2 : 1)), { method: 'TB', desc: `ค่าไฟฟ้าเดือน ${pad(m === 1 ? 12 : m - 1)}` }));
  at(wday(m, 8), 31, 'ค่าน้ำประปา', (d) => oe(d, 'S009', '50-EXPN-WATER', m2(D(ri(620, 980))), { method: 'CA' }));
  at(wday(m, 10), 30, 'ค่าอินเทอร์เน็ต', (d) => oe(d, 'S010', '50-EXPN-NET', '1990', { dep: '03' }));
  at(wday(m, 14), 30, 'ค่าโฆษณา', (d) => oe(d, 'S012', '50-EXPN-ADVT', m2(D(ri(80, 160) * 100)), { dep: '02', desc: 'โฆษณาออนไลน์ Facebook/Google' }));
  if (m % 2 === 0) at(wday(m, 16), 30, 'ค่าซ่อมแซม', (d) => oe(d, 'S013', '50-EXPN-REPAIR', m2(D(ri(20, 65) * 100)), { dep: pick(['01', '04']), desc: pick(['ซ่อมเครื่องปรับอากาศ', 'ซ่อมรถกระบะ เปลี่ยนยาง', 'ซ่อมประตูม้วนคลังสินค้า']) }));
  at(wday(m, 20), 30, 'ค่าบริการทางบัญชี', (d) => oe(d, 'S014', '50-EXPN-PROF', '6000', { dep: '03' }));
  at(wday(m, 22), 30, 'ค่าดูแลระบบไอที', (d) => oe(d, 'S015', '50-EXPN-ITSUP', '4500', { dep: '03' }));
  if (m === 3) at(wday(m, 16), 30, 'ซื้อคอมพิวเตอร์ (ทรัพย์สิน)', async (d) => {
    await oe(d, 'S003', '50-EXPN-FACOM', '38900', { method: 'TK', desc: 'คอมพิวเตอร์โน้ตบุ๊ก ฝ่ายบริหาร 1 เครื่อง' });
    if (await tryOk('ทรัพย์สินใหม่', 'POST', '/api/v1/fa/assets', { code: 'FA-COM-003', name_th: 'คอมพิวเตอร์โน้ตบุ๊ก ฝ่ายบริหาร', name_en: 'Notebook – Administration', category_code: 'COM', account_group_id: FAG.COM.id, serial_no: 'NB-ADM-2603', department_id: DEP['01'],
      is_depreciable: true, purchase_date: d, cost: '38900.00', salvage_value: '1', method: '1', start_date: d, useful_life_years: 3, depr_monthly: true })) bump('ทรัพย์สินใหม่');
  });
  if (m === 6) at(wday(m, 10), 30, 'ซื้อชั้นวางสินค้า (ทรัพย์สิน)', async (d) => {
    await oe(d, 'S002', '50-EXPN-FAFUR', '56000', { method: 'TK', dep: '04', desc: 'ชั้นวางสินค้าเหล็ก คลังบางนา 8 ชุด' });
    if (await tryOk('ทรัพย์สินใหม่', 'POST', '/api/v1/fa/assets', { code: 'FA-FUR-002', name_th: 'ชั้นวางสินค้าเหล็ก คลังบางนา 8 ชุด', name_en: 'Steel Racking – Bang Na (8 sets)', category_code: 'FUR', account_group_id: FAG.FUR.id, department_id: DEP['04'],
      is_depreciable: true, purchase_date: d, cost: '56000.00', salvage_value: '1', method: '1', start_date: d, useful_life_years: 5, depr_monthly: true })) bump('ทรัพย์สินใหม่');
  });
  if (m === 9) at(wday(m, 15), 30, 'ขายทรัพย์สิน', async (d) => {
    const a = await get(`/api/v1/fa/assets/${FA['FA-COM-001']}`);
    if (!(await tryOk('บันทึกขายทรัพย์สิน', 'POST', `/api/v1/fa/assets/${FA['FA-COM-001']}/sell`, { sold_date: d, sold_amount: '3000.00' }))) return;
    bump('ขายทรัพย์สิน');
    const acc = D(a.accumulated);
    await jv(d, '00', 'ขายคอมพิวเตอร์โน้ตบุ๊ก FA-COM-001 (ตัดจำหน่ายทรัพย์สิน)', [
      { account_id: A('1111-01'), debit: '3000.00', department_id: DEP['03'] }, { account_id: A('1420-06'), debit: m2(acc), department_id: DEP['03'] },
      { account_id: A('1410-06'), credit: '32500.00', department_id: DEP['03'] }, { account_id: A('4200-02'), credit: m2(D(3000).plus(acc).minus(32500)), department_id: DEP['03'] }], 'FA-COM-001');
  });
  // ค่าขนส่งเครดิต (S011) บิลซื้อรายเดือน → จ่ายพร้อมหักภาษี 1%
  at(wday(m, 26), 32, 'ค่าขนส่งรายเดือน (เครดิต)', async (d) => {
    const trips = ri(6, 12);
    const r = await tryOk('RR ค่าขนส่ง', 'POST', '/api/v1/purchase-invoices', { doc_type_id: dt('RR'), doc_date: d, party_id: SUP.S011.id, price_type: '2', vat_rate: 7, ref_no: `TJ-${d.slice(2, 4)}${d.slice(5, 7)}`, ref_date: d, department_id: DEP['04'],
      lines: [{ item_id: EXP['50-EXPN-TRANS'], qty: String(trips), unit_price: '450.00', description: `ค่าขนส่งสินค้าไปลูกค้าต่างจังหวัด ${trips} เที่ยว` }] });
    if (r) bump('RR');
  });
  // ส่งคืนสินค้า / เพิ่มหนี้เจ้าหนี้
  if (m % 3 === 2) at(wday(m, 18), 33, 'ส่งคืนสินค้า', async (d) => {
    const rr = [...state.rrs].reverse().find((x) => x.sup.code === 'S004' && x.date < d);
    if (!rr) return;
    await syncStock();
    const l = rr.lines.find((x) => qtyOf(x.item_id, WH['01']) >= 3) ?? rr.lines[0];
    const r = await tryOk('DN', 'POST', '/api/v1/ap-credit-notes', { doc_type_id: dt('DN'), doc_date: d, party_id: rr.sup.id, price_type: '2', vat_rate: 7, ref_header_id: rr.id, ref_no: `PT-CN-${pad(m)}`, ref_date: d, remark: 'ส่งคืนตลับหมึกชำรุด รั่ว',
      lines: [{ item_id: l.item_id, qty: '2', unit_price: l.unit_price, warehouse_id: WH['01'], return_to_stock: true }] });
    if (r) bump('DN');
  });
  if ([3, 7, 11].includes(m)) at(wday(m, 19), 33, 'ใบเพิ่มหนี้เจ้าหนี้', async (d) => {
    const rr = [...state.rrs].reverse().find((x) => x.sup.code === 'S001' && x.date < d);
    if (!rr) return;
    const r = await tryOk('CP', 'POST', '/api/v1/ap-debit-notes', { doc_type_id: dt('CP'), doc_date: d, party_id: rr.sup.id, price_type: '2', vat_rate: 7, ref_header_id: rr.id, ref_no: `SPM-DN-${pad(m)}`, ref_date: d, remark: 'ค่าขนส่งเพิ่มเติม (ส่งด่วน)',
      lines: [{ item_id: EXP['50-EXPN-TRANS'], qty: '1', unit_price: '1200.00' }] });
    if (r) bump('CP');
  });
  // เงินสดย่อย: จ่าย 4 ครั้ง + เบิกชดเชยสิ้นเดือน
  for (const dd of [5, 12, 19, 25]) at(wday(m, dd), 34, 'จ่ายเงินสดย่อย', async (d) => {
    const lines = [];
    const opts = [['5420-01', 'ค่าเครื่องเขียน/ถ่ายเอกสาร', 150, 900, '01'], ['5430-04', 'ค่าไปรษณีย์ส่งเอกสาร', 60, 450, '03'], ['5300-09', 'ค่าแท็กซี่/ทางด่วน พนักงานขาย', 120, 800, '02'], ['5411-11', 'ค่าอาหารว่างประชุม', 200, 1200, '01'], ['5420-03', 'วัสดุสิ้นเปลืองในสำนักงาน', 100, 600, '04']];
    for (const [acc, desc, lo, hi, dep] of opts) if (chance(0.55)) lines.push({ account_id: A(acc), department_id: DEP[dep], description: desc, amount: m2(D(ri(lo, hi))) });
    if (!lines.length) lines.push({ account_id: A('5430-04'), department_id: DEP['03'], description: 'ค่าไปรษณีย์ส่งเอกสาร', amount: '85.00' });
    if (await tryOk('DP', 'POST', '/api/v1/petty-payments', { doc_type_id: dt('DP'), doc_date: d, remark: 'จ่ายจากเงินสดย่อย', lines })) bump('DP');
  });
  at(wday(m, 28), 60, 'เบิกชดเชยเงินสดย่อย', async (d) => {
    const open = (await get(`/api/v1/petty-payments?open=true&to=${d}&limit=500`)).rows.filter((x) => x.doc_status !== 'C');
    if (!open.length) return;
    if (await tryOk('VR', 'POST', '/api/v1/petty-reimbursements', { doc_type_id: dt('VR'), doc_date: d, remark: `เบิกชดเชยเงินสดย่อย ${thaiMonth}`, dp_ids: open.map((x) => x.id), payments: [] })) bump('VR');
  });
  // สินค้า: เบิกใช้ภายใน / ปรับปรุง / ต้นทุน / ตรวจนับ
  at(wday(m, 15), 35, 'เบิกสินค้าใช้ภายใน', async (d) => {
    await syncStock();
    const lines = [['11-PAPR-A480', ri(8, 15)], ['15-COFF-3IN1', ri(3, 6)], ['16-TISS-ROLL', ri(4, 8)], ['15-WATR-600', ri(5, 10)]].filter(([c, q]) => qtyOf(ITEM[c].id, WH['01']) >= q)
      .map(([c, q]) => ({ item_id: ITEM[c].id, warehouse_id: WH['01'], qty: String(q) }));
    if (lines.length && await tryOk('OU', 'POST', '/api/v1/stock-issues', { doc_type_id: dt('OU'), doc_date: d, department_id: DEP['01'], remark: `เบิกใช้ในสำนักงาน ${thaiMonth}`, lines })) bump('OU');
  });
  if (m === 4) at(wday(m, 22), 36, 'ปรับปรุงลดสินค้าชำรุด', async (d) => { if (await tryOk('JU ลด', 'POST', '/api/v1/stock-adjustments', { doc_type_id: dt('JU'), doc_date: d, department_id: DEP['04'], remark: 'น้ำดื่มแพ็คแตกเสียหายจากการขนย้าย', lines: [{ item_id: ITEM['15-WATR-600'].id, warehouse_id: WH['01'], qty: '-6' }] })) bump('JU'); });
  if (m === 8) at(wday(m, 22), 36, 'ปรับปรุงเพิ่มสินค้า', async (d) => { if (await tryOk('JU เพิ่ม', 'POST', '/api/v1/stock-adjustments', { doc_type_id: dt('JU'), doc_date: d, department_id: DEP['04'], remark: 'พบเทปใสตกค้างในคลังบางนา', lines: [{ item_id: ITEM['12-TAPE-OPP'].id, warehouse_id: WH['02'], qty: '12', unit_cost: '28.00' }] })) bump('JU'); });
  if (m === 7) at(wday(m, 10), 36, 'เพิ่มต้นทุนสินค้า', async (d) => { if (await tryOk('CA', 'POST', '/api/v1/cost-adjustments', { doc_type_id: dt('CA'), doc_date: d, department_id: DEP['04'], remark: 'ค่าขนส่งและภาษีนำเข้าจอมอนิเตอร์ล็อตเดือน มิ.ย.', lines: [{ item_id: ITEM['13-MONI-24IN'].id, warehouse_id: WH['01'], amount: '1850.00' }] })) bump('CA'); });
  if (m % 3 === 0) at(me, 80, 'ตรวจนับสินค้า', async (d) => {
    const prep = await tryOk('สร้างข้อมูลตรวจนับ', 'POST', '/api/v1/stock-counts/prepare', { count_date: d, replace: true, warehouse_from: '01', warehouse_to: '01' });
    if (!prep) return;
    const rows = (await get(`/api/v1/stock-counts?count_date=${d}&warehouse_id=${WH['01']}`)).rows;
    const diffIdx = new Set([ri(0, rows.length - 1), ri(0, rows.length - 1)]);
    const entries = rows.map((r, i) => { const sys = Number(r.system_qty); let c = sys; if (diffIdx.has(i)) c = Math.max(0, sys + pick([-3, -2, -1, 1, 2])); return { id: r.id, counted_qty: String(c), shelf: `${String.fromCharCode(65 + (i % 6))}-${pad((i % 12) + 1)}` }; });
    await tryOk('บันทึกยอดนับ', 'PUT', '/api/v1/stock-counts/entries', { rows: entries });
    if (await tryOk('ปรับปรุงยอดตามตรวจนับ', 'POST', '/api/v1/stock-counts/adjust', { count_date: d, warehouse_from: '01', warehouse_to: '01', remark: `ตรวจนับสิ้นไตรมาส ${thaiMonth}` })) bump('ตรวจนับ (JU)');
  });
  // ธนาคาร
  for (const dd of [7, 14, 21, 28]) at(wday(m, dd), 50, 'นำเงินสดฝากธนาคาร', async (d) => {
    invalidate();
    const cash = await glBal('1111-01', d);
    const amt = cash.minus(50000).div(1000).floor().times(1000);
    if (amt.gte(5000) && await tryOk('BD', 'POST', '/api/v1/bank-deposits', { doc_type_id: dt('BD'), doc_date: d, bank_account_id: BA.B02.id, amount: m2(amt), remark: 'นำเงินสดจากการขายฝากธนาคาร' })) { bump('BD'); invalidate(); }
  });
  if (m % 3 === 1) at(wday(m, 3), 50, 'ถอนเงินสด', async (d) => { if (await tryOk('BW', 'POST', '/api/v1/bank-withdrawals', { doc_type_id: dt('BW'), doc_date: d, bank_account_id: BA.B03.id, amount: '20000.00', remark: 'ถอนเงินสดสำรองจ่ายหน้าร้าน' })) bump('BW'); });
  // เติมเงินบัญชีกระแสรายวัน (จ่ายเช็ค เงินเดือน ภาษี) จากบัญชีกสิกรไทยเดือนละ 2 ครั้ง ให้มีอย่างน้อย 1 ล้านบาท
  for (const dd of [4, 22]) at(wday(m, dd), 3, 'โอนเงินระหว่างบัญชี', async (d) => {
    invalidate();
    const bbl = await glBal('1112-00', d), kb = await glBal('1113-02', d);
    let amt = D(1000000).minus(bbl).div(10000).ceil().times(10000);
    if (amt.lt(100000)) return;
    if (amt.gt(kb.minus(200000))) amt = kb.minus(200000).div(10000).floor().times(10000);
    if (amt.lte(0)) return;
    if (await tryOk('BT', 'POST', '/api/v1/bank-transfers', { doc_type_id: dt('BT'), doc_date: d, bank_account_id: BA.B02.id, to_bank_account_id: BA.B01.id, amount: m2(amt), fee: m2(D(amt.gt(500000) ? 35 : 25)), remark: 'โอนเติมเงินบัญชีกระแสรายวันเพื่อจ่ายเช็ค' })) { bump('BT'); invalidate(); }
  });
  at(me, 70, 'ดอกเบี้ยเงินฝาก', async (d) => {
    for (const b of ['B02', 'B03']) {
      const bal = await glBal(BA[b].gl, d);
      const int = bal.times(b === 'B02' ? 0.0045 : 0.005).div(12).toDecimalPlaces(2);
      if (int.gt(1) && await tryOk('BU', 'POST', '/api/v1/bank-incomes', { doc_type_id: dt('BU'), doc_date: d, bank_account_id: BA[b].id, amount: m2(int), wht: m2(int.times(0.01).toDecimalPlaces(2)), remark: `ดอกเบี้ยเงินฝากออมทรัพย์ ${thaiMonth}` })) bump('BU');
    }
  });
  at(me, 71, 'ค่าธรรมเนียมธนาคาร', async (d) => { if (await tryOk('BV', 'POST', '/api/v1/bank-expenses', { doc_type_id: DT.BV ?? dt('BV'), doc_date: d, bank_account_id: BA.B01.id, amount: m2(D(ri(15, 45) * 10)), remark: 'ค่าธรรมเนียมเช็ค/ค่าบริการรายเดือนบัญชีกระแสรายวัน' })) bump('BV'); });
  if (m % 6 === 0) at(me, 71, 'ดอกเบี้ยจ่าย (ธนาคาร)', async (d) => { if (await tryOk('BV ดอกเบี้ย', 'POST', '/api/v1/bank-expenses', { doc_type_id: DT.BC ?? dt('BV'), doc_date: d, bank_account_id: BA.B01.id, amount: '1250.00', remark: 'ดอกเบี้ยเงินเบิกเกินบัญชี (O/D) งวดครึ่งปี' })) bump('BV'); });
  // ใบวางบิล / นัดรับชำระ / ใบรับวางบิล
  at(wday(m, 26), 55, 'ใบวางบิล', async (d) => {
    let k = 0;
    for (const c of CREDIT_CUS) {
      const rows = (await get(`/api/v1/ar-bills/open-items?party_id=${c.id}`)).rows.filter((o) => String(o.doc_date).slice(0, 10) >= monthStart(m) && String(o.doc_date).slice(0, 10) <= d);
      if (!rows.length || chance(0.25)) continue;
      const b = await tryOk('BS', 'POST', '/api/v1/ar-bills', { doc_type_id: dt('BS'), doc_date: d, party_id: c.id, visit_date: d, payment_terms: `เครดิต ${c.cd} วัน`, salesperson_id: SLM[c.sp], items: rows.map((o) => ({ invoice_header_id: o.header_id })) });
      if (!b) continue;
      bump('BS');
      if (k++ % 2 === 0 && await tryOk('นัดรับชำระ', 'POST', `/api/v1/ar-bills/${b.id}/appointment`, { date: addDays(d, Math.min(c.cd, 30)) })) bump('นัดรับชำระ');
    }
  });
  at(wday(m, 27), 56, 'ใบรับวางบิล', async (d) => {
    for (const s of Object.values(SUP).filter((x) => x.cd > 0)) {
      const rows = (await get(`/api/v1/ap-bills/open-items?party_id=${s.id}`)).rows.filter((o) => String(o.doc_date).slice(0, 10) >= monthStart(m) && String(o.doc_date).slice(0, 10) <= d);
      if (!rows.length) continue;
      if (await tryOk('BR', 'POST', '/api/v1/ap-bills', { doc_type_id: dt('BR'), doc_date: d, party_id: s.id, visit_date: d, appointment_date: addDays(d, s.cd), payment_terms: `เครดิต ${s.cd} วัน`, items: rows.map((o) => ({ invoice_header_id: o.header_id })) })) bump('BR');
    }
  });
  // ใบสำคัญทั่วไป
  const prevEnd = m === 1 ? '2025-12-31' : monthEnd(m - 1);
  at(wday(m, 7), 52, 'นำส่งภาษีหัก ณ ที่จ่าย', async (d) => {
    const p1 = await glBal('2132-01', prevEnd), p3 = await glBal('2132-03', prevEnd);
    await jv(d, '01', `นำส่งภาษีหัก ณ ที่จ่าย ภ.ง.ด.1/3/53 เดือน ${pad(m === 1 ? 12 : m - 1)}`, [
      { account_id: A('2132-01'), debit: p1.neg() }, { account_id: A('2132-03'), debit: p3.neg() }, { account_id: A(BANK_GL), credit: p1.plus(p3).neg() }], `WHT-${pad(m)}`);
  });
  at(wday(m, 15), 52, 'นำส่งประกันสังคม/ภาษีมูลค่าเพิ่ม', async (d) => {
    const sso = await glBal('2131-04', prevEnd), vat = await glBal('2137-00', prevEnd);
    await jv(d, '01', `นำส่งเงินสมทบประกันสังคม เดือน ${pad(m === 1 ? 12 : m - 1)}`, [{ account_id: A('2131-04'), debit: sso.neg() }, { account_id: A(BANK_GL), credit: sso.neg() }], `SSO-${pad(m)}`);
    if (vat.lt(0)) await jv(d, '01', `ชำระภาษีมูลค่าเพิ่ม (ภ.พ.30) เดือน ${pad(m === 1 ? 12 : m - 1)}`, [{ account_id: A('2137-00'), debit: vat.neg() }, { account_id: A(BANK_GL), credit: vat.neg() }], `PP30-${pad(m)}`);
  });
  if (m === 2) at(wday(m, 20), 52, 'จ่ายค่าสอบบัญชีปี 2568', (d) => jv(d, '01', 'จ่ายค่าสอบบัญชีปี 2568 ที่ตั้งค้างจ่ายไว้', [{ account_id: A('2131-09'), debit: '25000.00', department_id: DEP['03'] }, { account_id: A(BANK_GL), credit: '25000.00' }], 'AUDIT-2568'));
  at(wday(m, 25), 52, 'เงินเดือน', (d) => {
    const g = { '01': 48000, '02': 58000, '03': 38000, '04': 30000 };
    const bonus = m === 12 ? 110000 : 0;
    const gross = Object.values(g).reduce((s, v) => s + v, 0) + bonus;
    const ss = 12 * 750 / 2 + 750 * 3;   // ลูกจ้าง 12 คน (เพดาน 750)
    const pnd1 = Math.round(gross * 0.035);
    return jv(d, '01', `บันทึกเงินเดือนประจำเดือน ${thaiMonth}`, [
      { account_id: A('5411-01'), debit: g['01'], department_id: DEP['01'], description: 'เงินเดือนฝ่ายบริหาร' }, { account_id: A('5300-11'), debit: g['02'], department_id: DEP['02'], description: 'เงินเดือนฝ่ายขาย' },
      { account_id: A('5411-01'), debit: g['03'], department_id: DEP['03'], description: 'เงินเดือนฝ่ายบัญชี' }, { account_id: A('5411-01'), debit: g['04'], department_id: DEP['04'], description: 'เงินเดือนฝ่ายคลังสินค้า' },
      ...(bonus ? [{ account_id: A('5411-03'), debit: bonus, department_id: DEP['01'], description: 'โบนัสประจำปี 2569' }] : []),
      { account_id: A('5412-14'), debit: ss, department_id: DEP['01'] }, { account_id: A('2131-04'), credit: ss * 2 }, { account_id: A('2132-01'), credit: pnd1 },
      { account_id: A(BANK_GL), credit: gross - ss - pnd1, description: 'โอนเงินเดือนเข้าบัญชีพนักงาน' }], `PAY-${pad(m)}`);
  });
  at(wday(m, 28), 53, 'ผ่อนชำระเงินกู้', async (d) => {
    const loan = (await glBal('2210-00', addDays(d, -1))).neg();
    const int = loan.times(0.055).div(12).toDecimalPlaces(2);
    await jv(d, '01', `ผ่อนชำระเงินกู้ธนาคารงวด ${thaiMonth}`, [{ account_id: A('2210-00'), debit: '25000.00' }, { account_id: A('5470-03'), debit: int, department_id: DEP['03'] }, { account_id: A(BANK_GL), credit: D(25000).plus(int) }], `LOAN-${pad(m)}`);
  });
  at(me, 72, 'ตั้งค้างจ่ายค่าสอบบัญชี', (d) => jv(d, '00', `ตั้งค่าสอบบัญชีค้างจ่าย ${thaiMonth}`, [{ account_id: A('5460-05'), debit: '4000.00', department_id: DEP['03'] }, { account_id: A('2131-09'), credit: '4000.00' }], `ACR-${pad(m)}`));
  // ค่าเสื่อม
  at(me, 74, 'คิดค่าเสื่อมราคา', async () => { if (await tryOk(`ค่าเสื่อม ${thaiMonth}`, 'POST', '/api/v1/fa/depreciate', { period_ids: [periodId(m)], mode: 'recalc', journal_book_id: BOOK['00'] })) { bump('ค่าเสื่อม (FA)'); invalidate(); } });
  // ปิดภาษีมูลค่าเพิ่มประจำเดือน (หลังทุกเอกสารของเดือน)
  at(me, 90, 'ปิดภาษีมูลค่าเพิ่ม', async (d) => {
    const vc = await get(`/api/v1/gl/vat-closing?month=2026-${pad(m)}`);
    if (!vc.lines?.length) return;
    await jv(vc.date, '00', vc.description, vc.lines.map((l) => ({ account_id: l.account_id, debit: l.debit, credit: l.credit, description: l.description })), `VAT-${pad(m)}`);
  });
  // กระทบยอดเงินฝาก (บัญชีกระแสรายวัน) ม.ค.–ต.ค.
  if (m <= 10) at(me, 95, 'กระทบยอดเงินฝาก', async (d) => {
    const rec = await get(`/api/v1/bank-recon?bank_account_id=${BA.B01.id}&statement_date=${d}`);
    const clear = rec.lines.filter((l) => !l.cleared && String(l.voucher_date).slice(0, 10) <= addDays(d, -3)).map((l) => l.id);
    if (clear.length) await tryOk('ติ๊กรายการกระทบยอด', 'POST', '/api/v1/bank-recon/clear', { bank_account_id: BA.B01.id, statement_date: d, line_ids: clear, cleared: true });
    const after = await get(`/api/v1/bank-recon?bank_account_id=${BA.B01.id}&statement_date=${d}`);
    if (await tryOk('ยอดตามใบแจ้งยอด', 'PUT', '/api/v1/bank-recon/statement', { bank_account_id: BA.B01.id, statement_date: d, closing_balance: after.adjusted_balance, remark: `Statement ธนาคารกรุงเทพ ${thaiMonth}` })) bump('กระทบยอดเงินฝาก');
  });
}

for (let m = 1; m <= 12; m++) {
  const t = Date.now();
  planMonth(m);
  await runUntil(monthEnd(m));
  console.log(`  เดือน ${pad(m)}/2569 เสร็จ (${((Date.now() - t) / 1000).toFixed(1)} วิ) · ล้มเหลวสะสม ${failures.length}`);
}

/* ================================================================== 5. งานท้ายปี: ยืนยันยอดสินค้า แบบงบ รายงานของผู้ใช้ แบบฟอร์มพิมพ์ คำขอ PDPA */
console.log('▶ งานท้ายปี (ไม่ประมวลผลสิ้นปี)');
// บรรทัดแบบงบ: A = กำไรสุทธิ, B = กำไรขั้นต้น (รายได้ + / ค่าใช้จ่าย −) — VAR แสดงยอดรวม
const PLBUD_LINES = [
  ['A/C', '4100-00', 'รายได้จากการขายสินค้า-สุทธิ', { A: '+', B: '+' }], ['A/C', '4400-00', 'รายได้บริการ', { A: '+', B: '+' }], ['A/C', '5100-00', 'ต้นทุนขาย', { A: '-', B: '-' }],
  ['---'], ['VAR', 'B', 'กำไรขั้นต้น'], ['A/C', '4200-00', 'รายได้อื่น', { A: '+' }], ['A/C', '5300-00', 'ค่าใช้จ่ายในการขาย', { A: '-' }], ['A/C', '5400-00', 'ค่าใช้จ่ายในการบริหาร', { A: '-' }],
  ['---'], ['VAR', 'A', 'กำไร(ขาดทุน)สุทธิ'], ['==='],
].map(([dt, src, th, acc], i) => ({ line_no: (i + 1) * 10, data_type: dt, source: src ?? null, accumulate: acc ?? {}, description_th: th ?? null }));
await tryOk('ยืนยันยอดสินค้าคงเหลือ (GL.INV)', 'POST', '/api/v1/gl/inventory/compute', { account_id: A('1140-02'), fiscal_year_id: FY2026, period: -1 });
await tryOk('แบบงบกำไรขาดทุนเทียบงบประมาณ', 'POST', '/api/v1/fs/layouts', { code: 'PLBUD', name: 'งบกำไรขาดทุนเทียบงบประมาณ', header_lines: ['\\NAME', 'งบกำไรขาดทุนเทียบงบประมาณ'], line_set_code: 'PLBUD',
  columns: [{ expr: 'BAL', head1: 'จริงสะสม' }, { expr: 'BUD', head1: 'งบประมาณสะสม' }, { expr: 'PTD', head1: 'เฉพาะเดือน' }, { expr: 'PTD BUD', head1: 'งบเดือนนี้' }],
  lines: PLBUD_LINES });
await tryOk('รายงานของผู้ใช้', 'POST', '/api/v1/rpt-custom', { code: 'ARAGE', base_code: '1.A.1', name: 'ลูกหนี้คงค้าง (ใช้ติดตามหนี้ประจำสัปดาห์)', params: {}, hidden_cols: [], landscape: true });
await tryOk('แบบฟอร์มพิมพ์ของบริษัท', 'PUT', '/api/v1/print-forms/IV/5', { name: 'ใบกำกับภาษี/ใบส่งของ (แบบบริษัท มีโลโก้)', base: 'grid', layout: {}, status: 'A' });
await tryOk('คำขอ PDPA', 'POST', '/api/v1/pdpa/requests', { request_type: 'RECTIFY', subject_type: 'CUSTOMER', subject_id: CUS.C017.id, received_on: '2026-08-12', status: 'D', completed_on: '2026-08-13' });
await tryOk('คำขอ PDPA', 'POST', '/api/v1/pdpa/requests', { request_type: 'ERASE', subject_type: 'CUSTOMER', subject_id: CUS.C020.id, received_on: '2026-10-05', status: 'R', reason: 'ยังมีภาระภาษี/บัญชีที่ต้องเก็บเอกสาร 5 ปีตามประมวลรัษฎากร', completed_on: '2026-10-07' });

/* ================================================================== 6. ปิดงวด ม.ค.–ก.ย. */
console.log('▶ ล็อคงวด ม.ค.–ก.ย. 2569');
for (let m = 1; m <= 9; m++) await tryOk(`ล็อคงวด ${m}`, 'POST', `/api/v1/gl/periods/${periodId(m)}/lock`, { locked: true });

/* ================================================================== 6. ตรวจ + สรุป */
console.log('\n▶ ตรวจความถูกต้อง');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const checks = [];
const check = (okk, msg) => { checks.push({ ok: !!okk, msg }); console.log(`${okk ? '✓' : '✗'} ${msg}`); };
const q = async (sqlText, params = [coId]) => (await db.query(sqlText, params)).rows;

const tb = await get('/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31');
check(tb.balanced, `งบทดลอง 1 ม.ค.–31 ธ.ค. 2569 ดุล (ยกมา Dr ${tb.totals.opening_debit} Cr ${tb.totals.opening_credit} · ระหว่างงวด Dr ${tb.totals.debit} Cr ${tb.totals.credit} · คงเหลือ Dr ${tb.totals.closing_debit} Cr ${tb.totals.closing_credit})`);
const unbalanced = await q(`SELECT j.voucher_no, j.source_module, sum(l.debit) dr, sum(l.credit) cr FROM gl_journal j JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL
  WHERE j.company_id = $1 AND j.doc_status = 'N' AND j.deleted_at IS NULL GROUP BY j.id, j.voucher_no, j.source_module HAVING sum(l.debit) <> sum(l.credit)`);
check(!unbalanced.length, `ใบสำคัญทุกใบดุล (ไม่ดุล ${unbalanced.length} ใบ${unbalanced.length ? ': ' + unbalanced.slice(0, 5).map((r) => r.voucher_no).join(', ') : ''})`);
const MUST_POST = ['IV', 'HS', 'DR', 'CN', 'RR', 'HP', 'CP', 'DN', 'RE', 'PS', 'AI', 'AE', 'OI', 'OE', 'VR', 'BD', 'BW', 'BT', 'BU', 'BV', 'OU', 'JU', 'CA'];
const noJournal = await q(`SELECT h.doc_class, count(*)::int n FROM doc_header h WHERE h.company_id = $1 AND h.deleted_at IS NULL AND h.doc_status <> 'C' AND NOT h.is_opening AND h.doc_class = ANY($2)
  AND NOT EXISTS (SELECT 1 FROM gl_journal j WHERE j.source_header_id = h.id AND j.doc_status = 'N' AND j.deleted_at IS NULL) GROUP BY 1 ORDER BY 1`, [coId, MUST_POST]);
check(!noJournal.length, `เอกสารที่ต้องลงบัญชีมีใบสำคัญครบ${noJournal.length ? ' — ขาด: ' + noJournal.map((r) => `${r.doc_class} ${r.n}`).join(', ') : ''}`);
const docUnbal = await q(`SELECT h.doc_no FROM doc_header h JOIN gl_journal j ON j.source_header_id = h.id AND j.doc_status = 'N' AND j.deleted_at IS NULL JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL
  WHERE h.company_id = $1 AND h.doc_status <> 'C' GROUP BY h.id, h.doc_no HAVING sum(l.debit) <> sum(l.credit)`);
check(!docUnbal.length, `ใบสำคัญของเอกสารทุกใบดุล (ไม่ดุล ${docUnbal.length})`);
const close = (no) => D(tb.rows.find((r) => r.account_no === no)?.closing ?? 0);
const arRoles = (await q(`SELECT DISTINCT g.account_no FROM gl_default_account d JOIN gl_account g ON g.id = d.account_id WHERE d.company_id = $1 AND d.role = 'AR' AND d.deleted_at IS NULL
  UNION SELECT g.account_no FROM md_customer c JOIN gl_account g ON g.id = c.ar_account_id WHERE c.company_id = $1 AND c.deleted_at IS NULL`)).map((r) => r.account_no);
const apRoles = (await q(`SELECT DISTINCT g.account_no FROM gl_default_account d JOIN gl_account g ON g.id = d.account_id WHERE d.company_id = $1 AND d.role = 'AP' AND d.deleted_at IS NULL
  UNION SELECT g.account_no FROM md_supplier s JOIN gl_account g ON g.id = s.ap_account_id WHERE s.company_id = $1 AND s.deleted_at IS NULL`)).map((r) => r.account_no);
const arSub = D((await q(`SELECT coalesce(sum(outstanding), 0) v FROM v_ar_outstanding WHERE company_id = $1`))[0].v);
const apSub = D((await q(`SELECT coalesce(sum(outstanding), 0) v FROM v_ap_outstanding WHERE company_id = $1`))[0].v);
const arGl = arRoles.reduce((s, n) => s.plus(close(n)), D(0)), apGl = apRoles.reduce((s, n) => s.plus(close(n)), D(0)).neg();
check(arSub.eq(arGl), `ลูกหนี้: สมุดย่อยค้างรับ (v_ar_outstanding) ${m2(arSub)} = บัญชีคุมลูกหนี้ ${arRoles.join(',')} ${m2(arGl)}`);
check(apSub.eq(apGl), `เจ้าหนี้: สมุดย่อยค้างจ่าย (v_ap_outstanding) ${m2(apSub)} = บัญชีคุมเจ้าหนี้ ${apRoles.join(',')} ${m2(apGl)}`);
const neg = await q(`SELECT i.code, w.code wh, b.qty FROM v_stock_balance b JOIN md_item i ON i.id = b.item_id JOIN md_warehouse w ON w.id = b.warehouse_id WHERE b.company_id = $1 AND b.qty < 0`);
check(!neg.length, `สต๊อกคงเหลือไม่ติดลบทุกสินค้า/คลัง (ติดลบ ${neg.length}${neg.length ? ': ' + neg.map((r) => `${r.code}@${r.wh} ${r.qty}`).join(', ') : ''})`);
const negRun = await q(`SELECT item_id, warehouse_id, min(run) mn FROM (SELECT m.item_id, m.warehouse_id, sum(m.qty) OVER (PARTITION BY m.item_id, m.warehouse_id ORDER BY m.doc_date, h.created_at, m.line_no) run
  FROM v_stock_move m JOIN doc_header h ON h.id = m.header_id WHERE m.company_id = $1) x GROUP BY 1, 2 HAVING min(run) < 0`);
check(!negRun.length, `สต๊อกไม่ติดลบตลอดปี (ยอดสะสมตามวันที่และลำดับที่บันทึก) — ติดลบ ${negRun.length} คู่`);
const cashRun = await q(`SELECT g.account_no, min(run)::numeric(14,2) mn FROM (SELECT l.account_id, sum(l.debit - l.credit) OVER (PARTITION BY l.account_id ORDER BY j.voucher_date, j.created_at, l.line_no) run
  FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id WHERE j.company_id = $1 AND j.doc_status = 'N' AND j.deleted_at IS NULL AND l.deleted_at IS NULL) x JOIN gl_account g ON g.id = x.account_id
  WHERE g.account_no IN ('1111-01', '1111-02', '1112-00', '1113-01', '1113-02') GROUP BY 1 ORDER BY 1`);
const cashNeg = cashRun.map((r) => ({ no: r.account_no, mn: D(r.mn).plus(OPEN_BAL.get(r.account_no) ?? 0) })).filter((r) => r.mn.lt(0));
check(!cashNeg.length, `เงินสด/เงินฝากไม่ติดลบตลอดปี (ยอดต่ำสุด: ${cashRun.map((r) => `${r.account_no} ${m2(D(r.mn).plus(OPEN_BAL.get(r.account_no) ?? 0))}`).join(' · ')})`);
const stockVal = D((await q(`SELECT coalesce(sum(value), 0) v FROM v_stock_balance WHERE company_id = $1`))[0].v);
console.log(`  (ข้อมูล) มูลค่าสต๊อก ${m2(stockVal)} · บัญชีสินค้าคงเหลือ 1140-02 ${m2(close('1140-02'))} · ต่าง ${m2(close('1140-02').minus(stockVal))}`);
const vatS = D((await q(`SELECT coalesce(sum(CASE WHEN h.doc_class IN ('CN','DN') THEN -e.vat_amount ELSE e.vat_amount END), 0) v FROM tax_vat_entry e LEFT JOIN doc_header h ON h.id = e.header_id WHERE e.company_id = $1 AND e.vat_kind = 'S' AND e.doc_status <> 'C' AND e.deleted_at IS NULL`))[0].v);
const vatP = D((await q(`SELECT coalesce(sum(CASE WHEN h.doc_class IN ('CN','DN') THEN -e.vat_amount ELSE e.vat_amount END), 0) v FROM tax_vat_entry e LEFT JOIN doc_header h ON h.id = e.header_id WHERE e.company_id = $1 AND e.vat_kind = 'P' AND e.doc_status <> 'C' AND e.deleted_at IS NULL`))[0].v);
const glVat = (no) => D(tb.rows.find((r) => r.account_no === no)?.[no === '2135-00' ? 'credit' : 'debit'] ?? 0);
console.log(`  (ข้อมูล) แฟ้มภาษีขายทั้งปี ${m2(vatS)} · แฟ้มภาษีซื้อทั้งปี ${m2(vatP)} · บัญชี 2135-00 ปิดสิ้นปี ${m2(close('2135-00'))} · 1154-00 ${m2(close('1154-00'))}`);
const pl = tb.rows.filter((r) => ['4', '5'].includes(r.account_group)).reduce((s, r) => s.plus(D(r.closing)), D(0)).neg();
const rev = tb.rows.filter((r) => r.account_group === '4').reduce((s, r) => s.plus(D(r.closing)), D(0)).neg();
console.log(`  (ข้อมูล) รายได้รวม ${m2(rev)} · กำไร(ขาดทุน)สุทธิ ${m2(pl)} · เงินสด ${m2(close('1111-01'))} · BBL ${m2(close('1112-00'))} · KBANK ${m2(close('1113-02'))} · KTB ${m2(close('1113-01'))}`);
// ศูนย์รายงาน: ทุกรายงานเปิดได้กับข้อมูลทั้งปี
{
  const codes = (await get('/api/v1/rpt/available')).codes;
  const bad = [];
  for (const c of codes) {
    const r = await call('POST', `/api/v1/rpt/${c}/run`, { params: { from: '2026-01-01', to: '2026-12-31', as_of: '2026-12-31', date: '2026-12-31', month: '2026-12', end: '2026-12-31' } });
    if (r.status !== 200) bad.push(`${c} (${r.body?.error?.message ?? r.status})`);
  }
  for (const p of ['/api/v1/fs/run?kind=BS&end=2026-12-31', '/api/v1/fs/run?kind=PL&end=2026-12-31', `/api/v1/bank-book?bank_account_id=${BA.B01.id}&from=2026-01-01&to=2026-12-31`,
    `/api/v1/stock/card?item_id=${ITEM['11-PAPR-A480'].id}&from=2026-01-01&to=2026-12-31`, '/api/v1/wht/efile?form=S53&month=2026-12', '/api/v1/vat/S?month=2026-12', '/api/v1/gl/budget', '/api/v1/gl/prior-year'])
    if ((await call('GET', p)).status !== 200) bad.push(p);
  check(!bad.length, `ศูนย์รายงาน ${codes.length} รายงาน + งบการเงิน/สมุดเงินฝาก/สต๊อกการ์ด/แฟ้มยื่นภาษี เปิดได้ทั้งหมด${bad.length ? ' — เปิดไม่ได้: ' + bad.join(', ') : ''}`);
}
// ผู้ใช้ทดลองเข้าระบบและเห็นบริษัท DEMO (สิทธิ์ตามกลุ่ม)
{
  const saved = cookie;
  for (const u of TEST_USERS) {
    cookie = '';
    const r = await call('POST', '/api/v1/auth/login', { username: u.username, password: u.pw, work_date: '2026-10-30' });
    const meU = r.status === 200 ? (await call('GET', '/api/v1/auth/me')).body : null;
    const sel = meU?.companies?.some((c) => c.id === coId) ? await call('POST', '/api/v1/auth/select', { company_id: coId, work_date: '2026-10-30' }) : null;
    const jn = sel?.status === 200 ? (await call('GET', '/api/v1/gl/journals?limit=1')).status : 0;
    check(sel?.status === 200 && (u.grp === 'DEMO-ACCT' ? jn === 200 : jn === 403), `ผู้ใช้ทดลอง ${u.username} เข้าระบบและเลือกบริษัท DEMO ได้ · สมุดรายวัน ${jn === 200 ? 'เปิดได้' : 'ถูกปฏิเสธ'} ตามสิทธิ์กลุ่ม ${u.grp}`);
    await call('POST', '/api/v1/auth/logout');
  }
  cookie = saved;
}
check(failures.length === 0, `เรียก API ไม่ล้มเหลวเลย (ล้มเหลว ${failures.length})`);

console.log('\n▶ จำนวนเอกสารตามหมวด (doc_header)');
const byClass = await q(`SELECT doc_class, count(*) FILTER (WHERE doc_status <> 'C')::int n, count(*) FILTER (WHERE doc_status = 'C')::int c, count(*) FILTER (WHERE is_opening)::int o FROM doc_header WHERE company_id = $1 AND deleted_at IS NULL GROUP BY 1 ORDER BY 1`);
console.log('  ' + byClass.map((r) => `${r.doc_class} ${r.n}${r.o ? ` (ยกมา ${r.o})` : ''}${r.c ? ` (ยกเลิก ${r.c})` : ''}`).join(' · '));
const jByMod = await q(`SELECT coalesce(source_module, 'GL') m, count(*)::int n FROM gl_journal WHERE company_id = $1 AND doc_status = 'N' AND deleted_at IS NULL GROUP BY 1 ORDER BY 1`);
console.log('  ใบสำคัญตามระบบ: ' + jByMod.map((r) => `${r.m} ${r.n}`).join(' · '));
console.log('  กิจกรรมที่สคริปต์ทำ: ' + [...docCount].map(([k, v]) => `${k} ${v}`).join(' · '));
const MASTER = { md_customer: 'ลูกค้า', md_supplier: 'ผู้จำหน่าย', md_salesperson: 'พนักงานขาย', md_item: 'สินค้า/บริการ/รหัสรายได้-ค่าใช้จ่าย', md_item_bom: 'ส่วนประกอบสินค้าชุด', md_item_price_break: 'ราคาเสริม',
  md_item_reorder: 'จุดสั่งซื้อ', md_serial: 'หมายเลขสินค้า', md_serial_service: 'ประวัติบริการ', md_note: 'หมายเหตุแฟ้มหลัก', doc_note: 'หมายเหตุเอกสาร', md_party_contact: 'ผู้ติดต่อ', md_customer_ship_to: 'สถานที่ส่งของ', md_supplier_bank: 'บัญชีธนาคารผู้จำหน่าย',
  md_sales_target: 'เป้าการขาย', md_department: 'แผนก', md_lookup: 'ตารางข้อมูล', md_unit: 'หน่วยนับ', md_warehouse: 'คลัง', md_bank: 'ธนาคาร', md_bank_account: 'บัญชีเงินฝาก', md_payment_method: 'วิธีรับ/จ่าย',
  md_item_account_group: 'กลุ่มบัญชีสินค้า', md_asset_account_group: 'กลุ่มบัญชีทรัพย์สิน', fa_asset: 'ทรัพย์สิน', fa_depreciation: 'ค่าเสื่อมรายงวด', fin_cheque: 'เช็ค', fin_cheque_event: 'ประวัติเช็ค', fin_bank_statement: 'ใบแจ้งยอดธนาคาร',
  tax_vat_entry: 'แฟ้มภาษีซื้อ/ขาย', tax_wht_entry: 'แฟ้มภาษีหัก ณ ที่จ่าย', inv_stock_count: 'ตรวจนับ', gl_template: 'ต้นแบบบันทึก', gl_budget: 'งบประมาณ', gl_prior_year_balance: 'ยอดปีที่แล้ว', gl_balance: 'ยอดยกมา GL', gl_journal: 'ใบสำคัญ',
  gl_journal_line: 'บรรทัดใบสำคัญ', sys_permission: 'สิทธิ์', sys_branch: 'สาขา', sys_setting: 'ค่าเริ่มต้น', sys_activity_log: 'บันทึกเหตุการณ์' };
const mc = [];
for (const [t, label] of Object.entries(MASTER)) try { mc.push(`${label} ${(await q(`SELECT count(*)::int n FROM ${t} WHERE company_id = $1${['md_note', 'doc_note', 'sys_activity_log', 'fin_cheque_event', 'gl_balance'].includes(t) ? '' : ' AND deleted_at IS NULL'}`))[0].n}`); } catch (e) { mc.push(`${label} ? (${e.message})`); }
console.log('▶ แฟ้มหลัก/ตาราง: ' + mc.join(' · '));

// เมนูที่ยังไม่มีข้อมูลหลัก
const DOCS = (cls, extra = '') => `SELECT count(*)::int n FROM doc_header WHERE company_id = $1 AND deleted_at IS NULL AND doc_class IN (${cls.map((c) => `'${c}'`).join(',')})${extra}`;
const CNT = (t, extra = '') => `SELECT count(*)::int n FROM ${t} WHERE company_id = $1${extra}`;
const MENU_DATA = {
  'PU.AE': DOCS(['AE']), 'PU.PO': DOCS(['PO']), 'PU.RR': DOCS(['RR', 'HP'], ' AND NOT is_opening'), 'PU.OE': DOCS(['OE']), 'PU.SUP': CNT('md_supplier'), 'PU.EXP': CNT('md_item', ` AND item_type = '5'`),
  'SA.QT': DOCS(['QT']), 'SA.AI': DOCS(['AI']), 'SA.SO': DOCS(['SO']), 'SA.IV': DOCS(['IV', 'HS'], ' AND NOT is_opening'), 'SA.OI': DOCS(['OI']), 'SA.CUS': CNT('md_customer'), 'SA.INC': CNT('md_item', ` AND item_type = '4'`), 'SA.SLM': CNT('md_salesperson'),
  'FI.AR.BI': DOCS(['BS']), 'FI.AR.BD': DOCS(['BS'], ' AND appointment_date IS NOT NULL'), 'FI.AR.DR': DOCS(['DR']), 'FI.AR.SR': DOCS(['CN']), 'FI.AR.RE': DOCS(['RE']), 'FI.AR.OB': DOCS(['IV'], ' AND is_opening'),
  'FI.AP.BR': DOCS(['BR']), 'FI.AP.CP': DOCS(['CP']), 'FI.AP.GR': DOCS(['DN']), 'FI.AP.PS': DOCS(['PS']), 'FI.AP.OB': DOCS(['RR'], ' AND is_opening'),
  'FI.BK.DQ': DOCS(['BQ']), 'FI.BK.CL': CNT('fin_cheque', ` AND direction = 'R' AND status = '10'`), 'FI.BK.CR': CNT('fin_cheque', ` AND direction = 'R'`), 'FI.BK.PC': CNT('fin_cheque', ` AND direction = 'P' AND status = '10'`),
  'FI.BK.CP': CNT('fin_cheque', ` AND direction = 'P'`), 'FI.BK.TX': DOCS(['BD', 'BW', 'BT', 'BU', 'BV']), 'FI.BK.BOOK': DOCS(['BD', 'BW', 'BT', 'BU', 'BV']), 'FI.BK.REC': CNT('fin_bank_statement'), 'FI.BK.ACC': CNT('md_bank_account'),
  'FI.VAT.IN': CNT('tax_vat_entry', ` AND vat_kind = 'P'`), 'FI.VAT.OUT': CNT('tax_vat_entry', ` AND vat_kind = 'S'`), 'FI.VAT.ETAX': DOCS(['IV', 'HS', 'DR', 'CN']), 'FI.WHT': CNT('tax_wht_entry'), 'FI.WHT.CERT': CNT('tax_wht_entry'),
  'IC.STOCK': CNT('v_stock_balance'), 'IC.TRN': DOCS(['OU', 'RL', 'JU', 'CA']), 'IC.ITEM': CNT('md_item', ` AND item_type = '0'`), 'IC.KIT': CNT('md_item', ` AND item_type IN ('1','2')`), 'IC.SRV': CNT('md_item', ` AND item_type = '3'`),
  'IC.PRICE': CNT('md_item_price_break', ' AND deleted_at IS NULL'), 'IC.OB': DOCS(['OS']), 'IC.COUNT': CNT('inv_stock_count', ' AND deleted_at IS NULL'), 'IC.SERIAL': CNT('md_serial', ' AND deleted_at IS NULL'), 'IC.REORDER': CNT('md_item_reorder', ' AND deleted_at IS NULL'),
  'GL.JNL': CNT('gl_journal', ` AND (source_module IS NULL OR source_module = 'GL')`), 'GL.ACC': CNT('gl_account'), 'GL.OB': CNT('gl_balance', ` AND opening <> 0`), 'GL.LY': CNT('gl_prior_year_balance', ' AND deleted_at IS NULL'), 'GL.BUD': CNT('gl_budget', ' AND deleted_at IS NULL'),
  'GL.INV': CNT('gl_inventory_balance', ' AND deleted_at IS NULL'), 'GL.PC': DOCS(['DP', 'VR']), 'GL.TPL': CNT('gl_template', ' AND deleted_at IS NULL'), 'GL.BOOK': CNT('gl_journal_book'), 'GL.FS': CNT('gl_fs_report', ' AND deleted_at IS NULL'),
  'FA.ASSET': CNT('fa_asset', ' AND deleted_at IS NULL'), 'FA.DEPR': CNT('fa_depreciation', ' AND deleted_at IS NULL'),
  'RP.FORM': CNT('sys_print_form', ' AND deleted_at IS NULL'), 'RP.CUSTOM': CNT('sys_report_custom', ' AND deleted_at IS NULL'),
  'SET.CO': `SELECT count(*)::int n FROM sys_company WHERE id = $1 AND tax_id IS NOT NULL`, 'SET.DEF': CNT('sys_setting', ' AND deleted_at IS NULL'), 'SET.IAG': CNT('md_item_account_group', ' AND NOT item_specific AND deleted_at IS NULL'),
  'SET.FAG': CNT('md_asset_account_group'), 'SET.PAYM': CNT('md_payment_method', ' AND deleted_at IS NULL'), 'SET.PRD': CNT('gl_period'), 'SET.TBL': CNT('md_lookup', ' AND deleted_at IS NULL'), 'SET.DEPT': CNT('md_department'),
  'SET.BRANCH': CNT('sys_branch'), 'SET.DOCNO': CNT('md_doc_type'), 'SET.LINK': CNT('gl_journal_route'), 'SET.SEC': CNT('sys_permission', ' AND deleted_at IS NULL'), 'SET.API': CNT('sys_api_key'), 'SET.PDPA': CNT('sys_pdpa_request'),
  'SET.DEVICE': CNT('sys_device'), 'OT.LOCK': CNT('gl_period', ' AND is_locked'), 'OT.LOG': CNT('sys_activity_log'),
};
// เมนูทุกตัวที่มีหน้าจอ (อ่านจาก packages/core/src/menu.ts)
const menuSrc = readFileSync('E:/BuddyAccount/packages/core/src/menu.ts', 'utf8');
const menuList = [...menuSrc.matchAll(/\bm\('([A-Z0-9.]+)', '([^']+)', 'P\d', '([^']+)'/g)].map((x) => ({ code: x[1], label: x[2], route: x[3] }));
const empty = [], derived = [];
for (const mi of menuList) {
  const sqlText = MENU_DATA[mi.code];
  if (!sqlText) { derived.push(mi.code); continue; }
  let n = 0;
  try { n = (await q(sqlText))[0].n; } catch { n = -1; }
  if (n <= 0) empty.push(`${mi.code} ${mi.label} (${mi.route})${n < 0 ? ' [ตรวจไม่ได้]' : ''}`);
}
console.log(`▶ เมนูที่ยังไม่มีข้อมูลหลัก (${empty.length}): ${empty.length ? '\n  - ' + empty.join('\n  - ') : '-'}`);
console.log(`  เมนูรายงาน/เครื่องมือที่ไม่มีข้อมูลของตัวเอง (ไม่ตรวจ): ${derived.join(', ')}`);
if (warningsSeen.length) console.log(`▶ คำเตือนจากโปรแกรม ${warningsSeen.length} รายการ:\n  - ${warningsSeen.slice(0, 12).join('\n  - ')}`);
if (failures.length) {
  console.log(`\n▶ เรียก API ล้มเหลว ${failures.length} ครั้ง:`);
  const grouped = new Map();
  for (const f of failures) { const k = f.error.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').replace(/\d[\d,.]*/g, '#'); const g = grouped.get(k) ?? { n: 0, first: f }; g.n++; grouped.set(k, g); }
  for (const [k, g] of grouped) console.log(`  [${g.n}×] ${g.first.label}: ${g.first.error}${g.first.body ? `\n      body: ${g.first.body}` : ''}`);
}
await db.end();
const failed = checks.filter((c) => !c.ok).length;
const calls = [...stats.values()].reduce((s, x) => s + x.ok + x.fail, 0);
console.log(`\nสรุป: ตรวจผ่าน ${checks.length - failed}/${checks.length} · เรียก API ${calls.toLocaleString()} ครั้ง (${stats.size} เส้นทาง) · ใช้เวลา ${((Date.now() - T0) / 60000).toFixed(1)} นาที`);
process.exit(failed ? 1 : 0);
