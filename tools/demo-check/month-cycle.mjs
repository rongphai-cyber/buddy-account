// ตรวจความพร้อมก่อนใช้งานจริง — ไล่งานประจำเดือนครบวงจร (พ.ย. 2569) บนสำเนา DEMO แล้วกระทบยอดสมุดย่อยกับบัญชีแยกประเภท
// ใช้กับสำเนาเท่านั้น (เขียนข้อมูลจริง):
//   node tools/local-pg/pg.mjs run -- node tools/demo-check/smoke-copy.mjs run -- node tools/demo-check/month-cycle.mjs
//   (ต้องมี server ของสำเนาเปิดอยู่ที่ BASE · PASS = รหัสผ่าน admin)
import pg from 'file:///E:/BuddyAccount/apps/server/node_modules/pg/lib/index.js';
import Decimal from 'file:///E:/BuddyAccount/packages/core/node_modules/decimal.js/decimal.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4100';
if (!process.env.DATABASE_URL?.includes('smoke')) { console.error('ใช้กับสำเนา buddy_smoke เท่านั้น'); process.exit(2); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const D = (x) => new Decimal(x ?? 0);
let cookie = '';
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const ok = async (method, path, body) => { const r = await call(method, path, body); if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${r.body?.error?.message ?? JSON.stringify(r.body).slice(0, 200)}`); return r.body; };

const findings = [];
const note = (level, area, msg) => { findings.push({ level, area, msg }); console.log(`${level === 'OK' ? '✓' : level === 'WARN' ? '⚠' : '✗'} [${area}] ${msg}`); };
const check = (cond, area, msg) => note(cond ? 'OK' : 'FAIL', area, msg);
const near = (a, b) => D(a).minus(D(b)).abs().lt('0.005');
async function step(area, fn) { try { await fn(); } catch (e) { note('FAIL', area, `หยุดกลางทาง: ${e.message}`); } }

// ---- เข้าระบบ + เลือก DEMO
await ok('POST', '/api/v1/auth/login', { username: 'admin', password: process.env.PASS, work_date: '2026-11-30' });
const me = await ok('GET', '/api/v1/auth/me');
const co = me.companies.find((c) => c.code === 'DEMO').id;
await ok('POST', '/api/v1/auth/select', { company_id: co, work_date: '2026-11-30' });
const typeOf = async (cls) => { const t = (await db.query(`SELECT id FROM md_doc_type WHERE company_id = $1 AND doc_class = $2 AND status = 'A' AND deleted_at IS NULL ORDER BY code LIMIT 1`, [co, cls])).rows[0]; if (!t) throw new Error(`ไม่มีประเภทเอกสาร ${cls}`); return t.id; };
const tid = (n) => { const b = `0105569${String(n).padStart(5, '0')}`; let s = 0; for (let i = 0; i < 12; i++) s += Number(b[i]) * (13 - i); return b + ((11 - (s % 11)) % 10); };
const stamp = Date.now().toString().slice(-5);
const mine = [];   // เอกสารที่สร้างในการตรวจนี้
const keep = (r, label) => { mine.push({ id: r.id, doc_no: r.doc_no ?? r.voucher_no, label }); return r; };

// ---- ข้อมูลพื้นฐาน
const item = (await db.query(`SELECT i.id, i.code, w.id AS wh FROM inv_stock_balance b JOIN md_item i ON i.id = b.item_id JOIN md_warehouse w ON w.id = b.warehouse_id
   WHERE b.company_id = $1 AND b.qty_on_hand > 500 AND i.item_type = '0' AND i.status = 'A' AND i.deleted_at IS NULL ORDER BY b.qty_on_hand DESC LIMIT 1`, [co])).rows[0];
const exp = (await db.query(`SELECT id, code FROM md_item WHERE company_id = $1 AND item_type = '5' AND status = 'A' AND deleted_at IS NULL ORDER BY code LIMIT 1`, [co])).rows[0];
const bankAccs = (await ok('GET', '/api/v1/bank-accounts')).filter?.((b) => b.status !== 'I') ?? (await ok('GET', '/api/v1/bank-accounts')).rows;
const pmR = await ok('GET', '/api/v1/payment-methods/R'), pmP = await ok('GET', '/api/v1/payment-methods/P');
const chqR = pmR.find((m) => m.creates_cheque), trP = pmP.find((m) => !m.creates_cheque) ?? pmP[0];
note('OK', 'เตรียม', `สินค้า ${item.code} · ค่าใช้จ่าย ${exp?.code} · บัญชีธนาคาร ${bankAccs.length} · วิธีรับเช็ค ${chqR?.code ?? '-'} · วิธีจ่าย ${trP?.code ?? '-'}`);
const cus = (await ok('POST', '/api/v1/customers', { code: `AUD-C${stamp}`, name: 'ลูกค้าตรวจระบบ', tax_id: tid(Number(stamp) % 90000 + 1), credit_days: 30 })).id;
const sup = (await ok('POST', '/api/v1/suppliers', { code: `AUD-S${stamp}`, name: 'ผู้จำหน่ายตรวจระบบ', tax_id: tid(Number(stamp) % 90000 + 2) })).id;
const stockQty = async () => D((await db.query(`SELECT coalesce(sum(base_qty * stock_effect), 0) AS q FROM doc_line l JOIN doc_header h ON h.id = l.header_id
   WHERE l.company_id = $1 AND l.item_id = $2 AND l.deleted_at IS NULL AND h.deleted_at IS NULL AND h.doc_status <> 'C'`, [co, item.id])).rows[0].q);
const qty0 = await stockQty();

// ---- 1. ซื้อ: ใบสั่งซื้อ → ซื้อเงินเชื่ออ้างใบสั่ง → ซื้อเงินสด → จ่ายชำระ
let rr, hp;
await step('ซื้อ', async () => {
  const po = keep(await ok('POST', '/api/v1/purchase-orders', { doc_type_id: await typeOf('PO'), doc_date: '2026-11-02', party_id: sup, price_type: '2', vat_rate: 7, lines: [{ item_id: item.id, qty: 100, unit_price: 10, warehouse_id: item.wh }] }), 'ใบสั่งซื้อ');
  const poLine = (await ok('GET', `/api/v1/purchase-orders/${po.id}`)).lines[0];
  rr = keep(await ok('POST', '/api/v1/purchase-invoices', { doc_type_id: await typeOf('RR'), doc_date: '2026-11-03', party_id: sup, price_type: '2', vat_rate: 7, ref_no: 'SUP-INV-1', lines: [{ item_id: item.id, qty: 100, unit_price: 10, warehouse_id: item.wh, source_line_id: poLine.id }] }), 'ซื้อเงินเชื่อ');
  check(rr.net_amount === '1070.00', 'ซื้อ', `ซื้อเงินเชื่อ ${rr.doc_no} ยอดรวม ${rr.net_amount} (คาด 1070.00)`);
  const left = (await ok('GET', `/api/v1/orders/open?cls=PO&party_id=${sup}`)).rows;
  check(!left.length, 'ซื้อ', `ใบสั่งซื้อรับครบแล้วไม่ค้างรับ (ค้าง ${left.length} บรรทัด)`);
  hp = keep(await ok('POST', '/api/v1/cash-purchases', { doc_type_id: await typeOf('HP'), doc_date: '2026-11-04', party_id: sup, price_type: '1', vat_rate: 7, lines: [{ item_id: item.id, qty: 5, unit_price: 107, warehouse_id: item.wh }] }), 'ซื้อเงินสด');
  check(hp.net_amount === '535.00', 'ซื้อ', `ซื้อเงินสด ${hp.doc_no} ราคารวม VAT 535.00 → ${hp.net_amount}`);
  const ps = keep(await ok('POST', '/api/v1/ap-payments', { doc_type_id: await typeOf('PS'), doc_date: '2026-11-20', party_id: sup, settlements: [{ invoice_header_id: rr.id, amount: 1070 }], payments: [{ payment_method_id: trP.id, amount: 1070, reference_no: 'TR-001' }] }), 'จ่ายชำระหนี้');
  check(!!ps.id, 'ซื้อ', `จ่ายชำระ ${ps.doc_no ?? ''} ตัดบิลซื้อ 1,070`);
});

// ---- 2. ขาย: ใบเสนอราคา → ใบสั่งขาย → ขายเชื่อ → ขายสด → ลดหนี้รับคืน → รับมัดจำ → ขายหักมัดจำ → รับชำระด้วยเช็ค
let iv, iv2, hs, cn, ai, re;
await step('ขาย', async () => {
  const qt = keep(await ok('POST', '/api/v1/quotations', { doc_type_id: await typeOf('QT'), doc_date: '2026-11-05', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: item.id, qty: 10, unit_price: 50 }] }), 'ใบเสนอราคา');
  const so = keep(await ok('POST', `/api/v1/quotations/${qt.id}/convert`, { doc_date: '2026-11-06' }), 'ใบสั่งขาย');
  const soLine = (await ok('GET', `/api/v1/sales-orders/${so.id}`)).lines[0];
  iv = keep(await ok('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2026-11-07', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: item.id, qty: 10, unit_price: 50, warehouse_id: item.wh, source_line_id: soLine.id }] }), 'ขายเงินเชื่อ');
  check(iv.net_amount === '535.00', 'ขาย', `ขายเชื่อ ${iv.doc_no} 10 × 50 + VAT = ${iv.net_amount} (คาด 535.00)`);
  check(!(await ok('GET', `/api/v1/orders/open?cls=SO&party_id=${cus}`)).rows.length, 'ขาย', 'ใบสั่งขายส่งของครบแล้วไม่ค้าง');
  hs = keep(await ok('POST', '/api/v1/cash-sales', { doc_type_id: await typeOf('HS'), doc_date: '2026-11-08', party_id: cus, price_type: '1', vat_rate: 7, lines: [{ item_id: item.id, qty: 2, unit_price: 107, warehouse_id: item.wh }] }), 'ขายเงินสด');
  check(hs.net_amount === '214.00', 'ขาย', `ขายสด ${hs.doc_no} ราคารวม VAT 214.00 → ${hs.net_amount}`);
  cn = keep(await ok('POST', '/api/v1/ar-credit-notes', { doc_type_id: await typeOf('CN'), doc_date: '2026-11-09', party_id: cus, price_type: '2', vat_rate: 7, ref_header_id: iv.id, lines: [{ item_id: item.id, qty: 1, unit_price: 50, warehouse_id: item.wh, return_to_stock: true }] }), 'ลดหนี้/รับคืน');
  check(cn.net_amount === '53.50', 'ขาย', `ลดหนี้ ${cn.doc_no} คืน 1 ชิ้น = ${cn.net_amount} (คาด 53.50)`);
  ai = keep(await ok('POST', '/api/v1/ar-deposits', { doc_type_id: await typeOf('AI'), doc_date: '2026-11-10', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ description: 'มัดจำงานตรวจระบบ', amount: 100 }], payments: [] }), 'รับเงินมัดจำ');
  iv2 = keep(await ok('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2026-11-12', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: item.id, qty: 4, unit_price: 50, warehouse_id: item.wh }], deposits: [{ header_id: ai.id, amount: 100 }] }), 'ขายหักมัดจำ');
  check(iv2.net_amount === '107.00', 'ขาย', `ขายหักมัดจำ ${iv2.doc_no}: (200 − มัดจำ 100) + VAT = ${iv2.net_amount} (คาด 107.00)`);
  const open = (await ok('GET', `/api/v1/ar-receipts/open-items?party_id=${cus}`)).rows;
  const due = open.reduce((t, o) => t.plus(D(o.outstanding).times(o.doc_class === 'CN' ? -1 : 1)), D(0));
  check(due.eq('588.50'), 'ขาย', `ยอดค้างรับลูกค้า 535 − 53.50 + 107 = ${due.toFixed(2)} (คาด 588.50)`);
  re = keep(await ok('POST', '/api/v1/ar-receipts', { doc_type_id: await typeOf('RE'), doc_date: '2026-11-15', party_id: cus,
    settlements: open.map((o) => ({ invoice_header_id: o.header_id, amount: Number(o.outstanding) })),
    payments: [{ payment_method_id: chqR.id, amount: 588.5, reference_no: `QA${stamp}`, cheque_date: '2026-11-16' }] }), 'รับชำระหนี้ (เช็ค)');
  check(!(await ok('GET', `/api/v1/ar-receipts/open-items?party_id=${cus}`)).rows.length, 'ขาย', `รับชำระ ${re.doc_no} ตัดครบ ไม่เหลือค้างรับ`);
});

// ---- 3. เช็ค: นำฝาก → ผ่าน
await step('เช็ค', async () => {
  const c = (await ok('GET', `/api/v1/cheques?direction=R&status=00&q=QA${stamp}`)).rows[0];
  check(!!c && c.amount === '588.50', 'เช็ค', `เช็ครับ QA${stamp} เข้าทะเบียนเช็คในมือ ${c?.amount}`);
  await ok('POST', '/api/v1/cheques/deposit', { cheque_ids: [c.id], bank_account_id: bankAccs[0].id, deposit_date: '2026-11-17' });
  await ok('POST', '/api/v1/cheques/pass', { cheque_ids: [c.id], pass_date: '2026-11-18' });
  const after = (await ok('GET', `/api/v1/cheques?direction=R&q=QA${stamp}`)).rows[0];
  check(after?.status === '20' || !!after?.pass_date, 'เช็ค', `นำฝาก + ผ่านเช็คแล้ว สถานะ ${after?.status} ผ่านวันที่ ${String(after?.pass_date ?? '').slice(0, 10)}`);
});

// ---- 4. ค่าใช้จ่ายอื่น + ภาษีหัก ณ ที่จ่าย 3% (ภ.ง.ด.53)
let oe;
await step('ค่าใช้จ่าย/ภาษีหัก', async () => {
  oe = keep(await ok('POST', '/api/v1/other-expense-docs', { doc_type_id: await typeOf('OE'), doc_date: '2026-11-21', party_id: sup, price_type: '2', vat_rate: 7, ref_no: 'SV-77', lines: [{ item_id: exp.id, amount: 2000 }],
    wht: [{ form_type: 'S53', income_type: 'ค่าบริการ', rate: 3, paid_amount: 2000, tax_amount: 60 }] }), 'ค่าใช้จ่ายอื่น + หัก 3%');
  check(!!oe.id, 'ค่าใช้จ่าย/ภาษีหัก', `บันทึกค่าใช้จ่าย ${oe.doc_no} 2,000 + VAT 140 หัก ณ ที่จ่าย 60`);
  const w = (await ok('GET', `/api/v1/wht?month=2026-11&q=${oe.doc_no}`)).rows ?? [];
  check(w.some((x) => x.tax_amount === '60.00'), 'ค่าใช้จ่าย/ภาษีหัก', `เข้าแฟ้มภาษีหัก ณ ที่จ่าย (ภ.ง.ด.53) ${w.length} รายการ`);
  const ef = await call('GET', '/api/v1/wht/efile?form=S53&month=2026-11');
  check(ef.status === 200 && String(ef.body).includes('60.00'), 'ค่าใช้จ่าย/ภาษีหัก', `แฟ้มยื่น ภ.ง.ด.53 ทางอินเทอร์เน็ต เดือน 11/2569 สร้างได้${ef.status !== 200 ? ` (${ef.body?.error?.message})` : ''}`);
});

// ---- 5. ธนาคาร + สต๊อก + ใบสำคัญทั่วไป
await step('ธนาคาร', async () => {
  if (bankAccs.length < 2) { note('WARN', 'ธนาคาร', 'มีบัญชีธนาคารบัญชีเดียว ข้ามการโอนระหว่างบัญชี'); return; }
  keep(await ok('POST', '/api/v1/bank-transfers', { doc_type_id: await typeOf('BT'), doc_date: '2026-11-22', bank_account_id: bankAccs[0].id, to_bank_account_id: bankAccs[1].id, amount: 500, fee: 10 }), 'โอนระหว่างบัญชี');
  const bk = await ok('GET', `/api/v1/bank-book?bank_account_id=${bankAccs[0].id}&from=2026-11-01&to=2026-11-30`);
  check(JSON.stringify(bk).includes('588.5') && JSON.stringify(bk).includes('510'), 'ธนาคาร', 'สมุดเงินฝากมีเช็คผ่าน 588.50 และโอนออก 500 + ค่าธรรมเนียม 10');
});
await step('สินค้า', async () => {
  keep(await ok('POST', '/api/v1/stock-issues', { doc_type_id: await typeOf('OU'), doc_date: '2026-11-23', remark: 'เบิกใช้ (ตรวจระบบ)', lines: [{ item_id: item.id, warehouse_id: item.wh, qty: 2 }] }), 'จ่ายสินค้าใช้ภายใน');
  const q = await stockQty();
  // +100 ซื้อเชื่อ +5 ซื้อสด −10 ขายเชื่อ −2 ขายสด +1 รับคืน −4 ขายหักมัดจำ −2 เบิกใช้ = +88
  check(q.minus(qty0).eq(88), 'สินค้า', `สต๊อก ${item.code} เปลี่ยน ${q.minus(qty0).toString()} (คาด +88)`);
  const card = await call('GET', `/api/v1/stock/card?item_id=${item.id}&from=2026-11-01&to=2026-11-30`);
  check(card.status === 200, 'สินค้า', `สต๊อกการ์ดเดือน พ.ย. เปิดได้${card.status !== 200 ? ` (${card.body?.error?.message})` : ''}`);
});
await step('สมุดรายวัน', async () => {
  const book = (await db.query(`SELECT id FROM gl_journal_book WHERE company_id = $1 AND deleted_at IS NULL ORDER BY code LIMIT 1`, [co])).rows[0].id;
  const acc = (await db.query(`SELECT id, account_no FROM gl_account WHERE company_id = $1 AND NOT is_control AND deleted_at IS NULL AND status = 'A' AND account_no LIKE '5%' ORDER BY account_no LIMIT 1`, [co])).rows[0];
  const acc2 = (await db.query(`SELECT id FROM gl_account WHERE company_id = $1 AND NOT is_control AND deleted_at IS NULL AND status = 'A' AND account_no LIKE '2%' ORDER BY account_no LIMIT 1`, [co])).rows[0];
  const dept = (await db.query(`SELECT id FROM md_department WHERE company_id = $1 AND deleted_at IS NULL ORDER BY code LIMIT 1`, [co])).rows[0]?.id ?? null;
  const j = await ok('POST', '/api/v1/gl/journals', { journal_book_id: book, voucher_date: '2026-11-30', description: 'ตั้งค้างจ่ายสิ้นเดือน (ตรวจระบบ)', lines: [{ account_id: acc.id, debit: '1234.56', department_id: dept }, { account_id: acc2.id, credit: '1234.56', department_id: dept }] });
  mine.push({ id: null, journal: j.id, label: 'ใบสำคัญทั่วไป' });
  check(!!j.id, 'สมุดรายวัน', `บันทึกใบสำคัญตั้งค้างจ่าย ${j.voucher_no ?? ''}`);
});

// ---- 6. ตรวจบัญชี: ทุกเอกสารลงบัญชีและดุล + สมุดย่อยตรงกับบัญชีแยกประเภทตามบทบาท
const ids = mine.filter((m) => m.id).map((m) => m.id);
const jl = (await db.query(`SELECT h.doc_no, h.doc_class, j.id AS jid, j.doc_status, l.posting_role, l.debit, l.credit FROM doc_header h
   LEFT JOIN gl_journal j ON j.source_header_id = h.id AND j.deleted_at IS NULL AND j.doc_status <> 'C'
   LEFT JOIN gl_journal_line l ON l.journal_id = j.id AND l.deleted_at IS NULL WHERE h.id = ANY($1::uuid[])`, [ids])).rows;
const byDoc = new Map();
for (const r of jl) { const e = byDoc.get(r.doc_no) ?? { cls: r.doc_class, j: !!r.jid, dr: D(0), cr: D(0) }; e.dr = e.dr.plus(D(r.debit)); e.cr = e.cr.plus(D(r.credit)); byDoc.set(r.doc_no, e); }
// ใบสั่ง/เสนอราคาไม่ลงบัญชี · ระบบสินค้าแบบสิ้นงวด (PERIODIC) ใบเบิก/โอนสินค้าไม่ลงบัญชีระหว่างงวด (เหมือน Express)
const periodic = (await db.query(`SELECT value FROM sys_setting WHERE company_id = $1 AND key = 'ic.posting_method' AND deleted_at IS NULL`, [co])).rows[0]?.value !== 'PERPETUAL';
const noPost = ['QT', 'SO', 'PO', ...(periodic ? ['OU', 'OT', 'OS', 'OR'] : [])];
for (const [no, e] of byDoc) {
  if (noPost.includes(e.cls)) { check(!e.j, 'ลงบัญชี', `${no} (${e.cls}) ไม่ลงบัญชีตามหลัก${periodic && e.cls.startsWith('O') ? ' (สินค้าแบบสิ้นงวด)' : ''}`); continue; }
  if (!e.j) { note('FAIL', 'ลงบัญชี', `${no} (${e.cls}) ยังไม่ลงบัญชี`); continue; }
  check(e.j && e.dr.eq(e.cr) && e.dr.gt(0), 'ลงบัญชี', `${no} (${e.cls}) ลงบัญชีแล้ว เดบิต ${e.dr.toFixed(2)} = เครดิต ${e.cr.toFixed(2)}`);
}
const role = (r) => jl.filter((x) => x.posting_role === r).reduce((t, x) => t.plus(D(x.debit)).minus(D(x.credit)), D(0));
const roles = [...new Set(jl.map((x) => x.posting_role).filter(Boolean))].sort();
note('OK', 'กระทบยอด', `บทบาทบัญชีที่พบ: ${roles.join(', ')}`);
const arOut = D((await db.query(`SELECT coalesce(sum(outstanding), 0) AS v FROM v_ar_outstanding WHERE company_id = $1 AND customer_id = $2`, [co, cus])).rows[0].v);
const apOut = D((await db.query(`SELECT coalesce(sum(outstanding), 0) AS v FROM v_ap_outstanding WHERE company_id = $1 AND supplier_id = $2`, [co, sup])).rows[0].v);
check(role('AR').eq(arOut), 'กระทบยอด', `ลูกหนี้: สมุดย่อยค้างรับ ${arOut.toFixed(2)} = บัญชีลูกหนี้ (เดบิต−เครดิต) ${role('AR').toFixed(2)}`);
check(role('AP').neg().eq(apOut), 'กระทบยอด', `เจ้าหนี้: สมุดย่อยค้างจ่าย ${apOut.toFixed(2)} = บัญชีเจ้าหนี้ (เครดิต−เดบิต) ${role('AP').neg().toFixed(2)}`);
const vat = (await db.query(`SELECT e.vat_kind AS kind, coalesce(sum(CASE WHEN h.doc_class IN ('CN','DN') THEN -e.vat_amount ELSE e.vat_amount END), 0) AS v FROM tax_vat_entry e JOIN doc_header h ON h.id = e.header_id WHERE e.company_id = $1 AND e.header_id = ANY($2::uuid[]) AND e.doc_status <> 'C' AND e.deleted_at IS NULL GROUP BY e.vat_kind`, [co, ids])).rows;
const vatOf = (k) => D(vat.find((x) => x.kind === k)?.v);
check(role('OUTPUT_VAT').neg().eq(vatOf('S')), 'กระทบยอด', `ภาษีขาย: แฟ้มภาษีขาย ${vatOf('S').toFixed(2)} = บัญชีภาษีขาย ${role('OUTPUT_VAT').neg().toFixed(2)} (ลดหนี้เก็บเป็นบวกในแฟ้ม จึงหักออก · คาด 35 + 14 − 3.50 + มัดจำ 7 + ขายหักมัดจำ 7 = 59.50)`);
check(role('INPUT_VAT').eq(vatOf('P')), 'กระทบยอด', `ภาษีซื้อ: แฟ้มภาษีซื้อ ${vatOf('P').toFixed(2)} = บัญชีภาษีซื้อ ${role('INPUT_VAT').toFixed(2)} (คาด 70 + 35 + 140 = 245)`);
const wht = D((await db.query(`SELECT coalesce(sum(tax_amount), 0) AS v FROM tax_wht_entry WHERE company_id = $1 AND header_id = ANY($2::uuid[]) AND doc_status <> 'C' AND deleted_at IS NULL`, [co, ids])).rows[0].v);
const whtRole = roles.find((r) => /WHT/.test(r) && !/REC|CREDIT/.test(r));
check(whtRole && role(whtRole).neg().eq(wht), 'กระทบยอด', `ภาษีหัก ณ ที่จ่ายค้างนำส่ง: แฟ้ม ${wht.toFixed(2)} = บัญชี ${whtRole} ${whtRole ? role(whtRole).neg().toFixed(2) : '-'}`);
const depOut = D((await db.query(`SELECT coalesce(sum(outstanding), 0) AS v FROM v_deposit_outstanding WHERE company_id = $1 AND customer_id = $2`, [co, cus])).rows[0].v);
check(depOut.eq(0), 'กระทบยอด', `มัดจำรับของลูกค้าหักหมดแล้ว คงเหลือ ${depOut.toFixed(2)}`);

// ---- 7. แฟ้มภาษีเดือน พ.ย. + ปิดภาษี + งบทดลอง/งบการเงิน + รายงานลูกหนี้
await step('ภาษีมูลค่าเพิ่ม', async () => {
  const s = await ok('GET', '/api/v1/vat/S?month=2026-11'), p = await ok('GET', '/api/v1/vat/P?month=2026-11');
  const has = (rows, no) => rows.some((r) => r.doc_no === no);
  check(has(s.rows, iv.doc_no) && has(s.rows, hs.doc_no) && has(s.rows, cn.doc_no), 'ภาษีมูลค่าเพิ่ม', `รายงานภาษีขาย 11/2569 มีขายเชื่อ ขายสด ลดหนี้ (${s.rows.length} รายการ)`);
  check(has(p.rows, rr.doc_no) && has(p.rows, oe.doc_no), 'ภาษีมูลค่าเพิ่ม', `รายงานภาษีซื้อ 11/2569 มีซื้อเชื่อ และค่าใช้จ่าย (${p.rows.length} รายการ)`);
  const vc = await call('GET', '/api/v1/gl/vat-closing?month=2026-11');
  check(vc.status === 200, 'ภาษีมูลค่าเพิ่ม', `ปิดภาษีเดือน 11/2569 (ภ.พ.30) คำนวณได้${vc.status !== 200 ? ` (${vc.body?.error?.message})` : ''}`);
});
await step('งบ', async () => {
  const tb = await ok('GET', '/api/v1/reports/trial-balance?from=2026-01-01&to=2026-11-30');
  const tot = (tb.rows ?? []).reduce((t, r) => ({ dr: t.dr.plus(D(r.closing_debit ?? r.debit ?? 0)), cr: t.cr.plus(D(r.closing_credit ?? r.credit ?? 0)) }), { dr: D(0), cr: D(0) });
  check(tb.balanced !== false && (tot.dr.eq(tot.cr) || tb.balanced === true), 'งบ', `งบทดลอง 1 ม.ค.–30 พ.ย. 2569 ดุล${tb.balanced === undefined ? ` (เดบิต ${tot.dr.toFixed(2)} เครดิต ${tot.cr.toFixed(2)})` : ''}`);
  const bs = await call('GET', '/api/v1/fs/run?kind=BS&end=2026-11-30'), pl = await call('GET', '/api/v1/fs/run?kind=PL&end=2026-11-30');
  check(bs.status === 200 && pl.status === 200, 'งบ', `งบแสดงฐานะการเงินและงบกำไรขาดทุน ณ 30 พ.ย. สร้างได้${bs.status !== 200 ? ` BS: ${bs.body?.error?.message}` : ''}${pl.status !== 200 ? ` PL: ${pl.body?.error?.message}` : ''}`);
  const ag = await call('POST', '/api/v1/rpt/1.A.1/run', { params: { as_of: '2026-11-30' } });
  check(ag.status === 200, 'งบ', `รายงานลูกหนี้คงค้าง ณ 30 พ.ย. เปิดได้${ag.status !== 200 ? ` (${ag.body?.error?.message})` : ''}`);
});

// ---- 8. ยกเลิกเอกสาร + ล็อคงวด
await step('ยกเลิก', async () => {
  const before = await stockQty();
  const x = keep(await ok('POST', '/api/v1/cash-sales', { doc_type_id: await typeOf('HS'), doc_date: '2026-11-25', party_id: cus, price_type: '1', vat_rate: 7, lines: [{ item_id: item.id, qty: 3, unit_price: 107, warehouse_id: item.wh }] }), 'ขายสดที่ยกเลิก');
  await ok('POST', `/api/v1/cash-sales/${x.id}/cancel`, { reason: 'ตรวจระบบ: ยกเลิก' });
  const h = (await db.query(`SELECT h.doc_status, (SELECT string_agg(DISTINCT doc_status, ',') FROM gl_journal WHERE source_header_id = h.id) AS j, (SELECT count(*)::int FROM tax_vat_entry WHERE header_id = h.id AND doc_status <> 'C' AND deleted_at IS NULL) AS v FROM doc_header h WHERE h.id = $1`, [x.id])).rows[0];
  check(h.doc_status === 'C' && h.j === 'C' && h.v === 0, 'ยกเลิก', `ยกเลิกขายสด ${x.doc_no}: เอกสาร ${h.doc_status} ใบสำคัญ ${h.j} ภาษีขายค้าง ${h.v} รายการ`);
  check((await stockQty()).eq(before), 'ยกเลิก', 'ยกเลิกแล้วสต๊อกกลับเท่าเดิม');
});
await step('ปิดงวด', async () => {
  const per = (await db.query(`SELECT id FROM gl_period WHERE company_id = $1 AND start_date = '2026-11-01' AND deleted_at IS NULL`, [co])).rows[0];
  await ok('POST', `/api/v1/gl/periods/${per.id}/lock`, { locked: true });
  const r = await call('POST', '/api/v1/sales-invoices', { doc_type_id: await typeOf('IV'), doc_date: '2026-11-28', party_id: cus, price_type: '2', vat_rate: 7, lines: [{ item_id: item.id, qty: 1, unit_price: 50, warehouse_id: item.wh }] });
  check(r.status === 400, 'ปิดงวด', `ล็อคงวด พ.ย. แล้วบันทึกเอกสารในงวดไม่ได้: ${r.body?.error?.message ?? r.status}`);
  const e = await call('POST', `/api/v1/cash-sales/${hs.id}/cancel`, { reason: 'ทดสอบหลังล็อคงวด' });
  check(e.status === 400, 'ปิดงวด', `ล็อคงวดแล้วยกเลิกเอกสารในงวดไม่ได้: ${e.body?.error?.message ?? e.status}`);
});

await db.end();
const fail = findings.filter((f) => f.level === 'FAIL'), warn = findings.filter((f) => f.level === 'WARN');
console.log(`\nสรุป: ผ่าน ${findings.length - fail.length - warn.length} · เตือน ${warn.length} · ไม่ผ่าน ${fail.length}`);
if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify({ findings, docs: mine }, null, 1));
process.exit(fail.length ? 1 : 0);
