/**
 * ตัวนำเข้า Express (.DBF) แบบ TypeScript (T0.12): ตัวอ่าน DBF, uuid5, การปัดเลขแบบ Python และการนำเข้าทั้งเส้นบน PGlite
 * ค่าที่คาดหวังของ uuid5/round/repr/sum มาจาก Python 3.12 (migrate_express.py ต้นฉบับ)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql } from 'kysely';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadConfig } from '../src/config.js';
import { openDbf, dbfRecords } from '../src/import/express/dbf.js';
import { importExpress, validateExpress, uuid5, pyRound, pyFloatRepr, pySum, NAMESPACE_URL, type DbfSource } from '../src/import/express/migrate.js';
import { COMPANY_STEPS } from '../src/modules/backup.js';

/* ------------------------------------------------------------------ ตัวเขียน DBF เล็ก ๆ สำหรับทดสอบ */
type FieldSpec = [name: string, type: 'C' | 'N' | 'D' | 'L' | 'B' | 'I' | 'Y' | 'M', len: number];
type Cell = string | number | boolean | null | Buffer;
/** อักษรไทย U+0E01–U+0E5B = ไบต์ 0xA1–0xFB ใน cp874, \xa0 = 0xA0 */
function cp874(s: string): Buffer {
  return Buffer.from([...s].map((ch) => {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) return c;
    if (c === 0xa0) return 0xa0;
    if (c >= 0x0e01 && c <= 0x0e5b) return c - 0x0e00 + 0xa0;
    throw new Error(`cp874 ไม่มี ${ch}`);
  }));
}
function writeDbf(fields: FieldSpec[], rows: Array<{ del?: boolean; v: Cell[] }>, opts: { truncate?: number } = {}): Buffer {
  const hl = 32 + 32 * fields.length + 1, rl = 1 + fields.reduce((s, f) => s + f[2], 0);
  const head = Buffer.alloc(hl);
  head[0] = 0x30; head.writeUInt32LE(rows.length, 4); head.writeUInt16LE(hl, 8); head.writeUInt16LE(rl, 10); head[29] = 0x7c;
  let off = 1;
  fields.forEach(([name, type, len], i) => {
    const p = 32 + 32 * i;
    head.write(name, p, 'ascii'); head[p + 11] = type.charCodeAt(0); head.writeUInt32LE(off, p + 12); head[p + 16] = len;
    off += len;
  });
  head[hl - 1] = 0x0d;
  const recs = rows.map(({ del, v }) => {
    const b = Buffer.alloc(rl, 0x20);
    b[0] = del ? 0x2a : 0x20;
    let o = 1;
    fields.forEach(([, type, len], i) => {
      const x = v[i];
      if (Buffer.isBuffer(x)) x.copy(b, o, 0, len);
      else if (x === null || x === undefined) { if (type === 'B' || type === 'I' || type === 'Y') b.fill(0, o, o + len); }
      else if (type === 'C' || type === 'M') cp874(String(x)).copy(b, o, 0, len);
      else if (type === 'N') b.write(String(x).padStart(len).slice(-len), o, 'latin1');
      else if (type === 'D') b.write(String(x).replace(/-/g, ''), o, 'latin1');
      else if (type === 'L') b.write(x ? 'T' : 'F', o, 'latin1');
      else if (type === 'B') b.writeDoubleLE(Number(x), o);
      else if (type === 'I') b.writeInt32LE(Number(x), o);
      else if (type === 'Y') b.writeBigInt64LE(BigInt(Math.round(Number(x) * 10000)), o);
      o += len;
    });
    return b;
  });
  const all = Buffer.concat([head, ...recs, Buffer.from([0x1a])]);
  return opts.truncate ? all.subarray(0, all.length - opts.truncate) : all;
}
const memSource = (files: Record<string, Buffer>): DbfSource => ({ list: () => Object.keys(files).sort(), read: (n) => files[n.toUpperCase()] ?? null });

/* ------------------------------------------------------------------ ตัวอ่าน DBF */
describe('DBF reader (FoxPro, cp874)', () => {
  const fields: FieldSpec[] = [['CODE', 'C', 10], ['NAME', 'C', 20], ['AMT', 'N', 12], ['DAT', 'D', 8], ['FLG', 'L', 1], ['BAL', 'B', 8], ['CNT', 'I', 4], ['CUR', 'Y', 8]];
  const buf = writeDbf(fields, [
    { v: ['A01', 'ลูกค้า\xa0ทดสอบ  ', '  1234.56', '2010-03-15', true, 0.1 + 0.2, -7, 12.3456] },
    { del: true, v: ['DEL', 'ถูกลบ', '1', '2010-01-01', false, 1, 1, 1] },
    { v: ['  B02', '', '', '', false, null, null, null] },
    { v: ['C03', Buffer.from([0x81, 0xdb, 0x41]), '**********', '20101345', 'Y' as unknown as boolean, -0, 0, 0] },
    { v: ['TRUNC', 'x', '1', '2010-01-01', true, 1, 1, 1] },
  ], { truncate: 30 });
  const recs = [...openDbf(buf).records()];

  it('skips deleted records and stops at a truncated record', () => {
    expect(recs.map((r) => r.CODE)).toEqual(['A01', '  B02', 'C03']);
    expect(openDbf(buf).fields.map((f) => `${f.name}:${f.type}`)).toEqual(['CODE:C', 'NAME:C', 'AMT:N', 'DAT:D', 'FLG:L', 'BAL:B', 'CNT:I', 'CUR:Y']);
  });
  it('decodes Thai cp874, \\xa0 → space, right-trims, blank → null', () => {
    expect(recs[0]!.NAME).toBe('ลูกค้า ทดสอบ');
    expect(recs[1]!.NAME).toBeNull();
    expect(recs[2]!.NAME).toBe('��A');   // ไบต์ที่ไม่มีใน cp874 → U+FFFD เหมือน decode('cp874', 'replace')
  });
  it('reads numbers, dates and logicals like the Python importer', () => {
    expect(recs[0]!.AMT).toBe(1234.56);
    expect(recs[1]!.AMT).toBeNull();          // ว่าง
    expect(recs[2]!.AMT).toBeNull();          // ล้นช่อง (*****) → float() ไม่ได้
    expect(recs[0]!.DAT).toBe('2010-03-15');  // วันที่ ISO ไม่มีเขตเวลา
    expect(recs[1]!.DAT).toBeNull();
    expect(recs[2]!.DAT).toBeNull();          // เดือน 13
    expect(recs[0]!.FLG).toBe(true);
    expect(recs[1]!.FLG).toBe(false);
    expect(recs[0]!.BAL).toBe(0.30000000000000004);
    expect(recs[0]!.CNT).toBe(-7);
    expect(recs[0]!.CUR).toBe(12.3456);
    expect(recs[1]!.BAL).toBe(0);
  });
  it('missing file = no records', () => { expect([...dbfRecords(null)]).toEqual([]); });
});

/* ------------------------------------------------------------------ uuid5 / ตัวเลขแบบ Python */
describe('Python parity helpers', () => {
  it('uuid5 matches Python uuid.uuid5', () => {
    const ns = uuid5(NAMESPACE_URL, 'express-migration/TESTRice');
    expect(ns).toBe('de79ee5d-3d49-59d3-83c4-c454c7ce4700');
    const U = (...p: string[]) => uuid5(ns, p.join('/'));
    expect(U('company')).toBe('035babbf-7fc6-5c25-bf9a-247645c580dd');
    expect(U('acc', '1111-01')).toBe('b9debc29-6418-50a0-aaa6-73120d444b84');
    expect(U('cus', 'ลูกค้า ทดสอบ')).toBe('f1286afa-aeb7-5862-986d-8417d17b7e73');
    expect(U('glopen', '5100', 'None')).toBe('6b50db55-3462-512e-8d9b-1afb354ca919');
    expect(U('vat', 'P', 'IV001', 'None', '2010-01-31', '3')).toBe('bad1cf24-9cb2-5427-a17b-04e13186652f');
    expect(uuid5(NAMESPACE_URL, 'express-import/abc')).toBe('8b20e0e4-a3d0-5d79-be2e-7784c9d79248');
  });
  it('round() is Python float rounding (exact binary value, ties to even)', () => {
    const cases: Array<[number, string, string]> = [[0.125, '0.12', '0.125'], [0.375, '0.38', '0.375'], [2.675, '2.67', '2.675'], [1.005, '1.0', '1.005'], [-0.125, '-0.12', '-0.125'],
      [-2.675, '-2.67', '-2.675'], [1234.565, '1234.57', '1234.565'], [0.0049999, '0.0', '0.005'], [0.005, '0.01', '0.005'], [-0.005, '-0.01', '-0.005'],
      [123456789.125, '123456789.12', '123456789.125'], [1e-7, '0.0', '0.0'], [99.995, '100.0', '99.995'], [0.285, '0.28', '0.285'], [1.115, '1.11', '1.115'], [8.345, '8.35', '8.345'], [-0.0001, '-0.0', '-0.0001']];
    for (const [v, r2, r4] of cases) {
      expect(pyFloatRepr(pyRound(v, 2)), `round(${v}, 2)`).toBe(r2);
      expect(pyFloatRepr(pyRound(v, 4)), `round(${v}, 4)`).toBe(r4);
    }
  });
  it('repr(float) and sum() (Neumaier, Python 3.12)', () => {
    expect([1e16, 1e15, 0.0001, 0.00001, 100000, -0, 1.5e-7, 123.456, 7, 1e22].map(pyFloatRepr))
      .toEqual(['1e+16', '1000000000000000.0', '0.0001', '1e-05', '100000.0', '-0.0', '1.5e-07', '123.456', '7.0', '1e+22']);
    expect(pySum(Array(10).fill(0.1))).toBe(1);
    expect(pySum([1e100, 1, -1e100])).toBe(1);
    expect(pyFloatRepr(pySum([0.1, 0.2, 0.3]))).toBe('0.6');
  });
});

/* ------------------------------------------------------------------ นำเข้าทั้งเส้นบน PGlite */
describe('importExpress on PGlite', () => {
  let database: Database;
  const files: Record<string, Buffer> = {};
  beforeAll(async () => {
    const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
    database = await openDatabase(cfg);
    await migrate(database, cfg.migrationsDir, () => {});
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    const last = (m: number) => new Date(Date.UTC(2010, m, 0)).getUTCDate();
    files.ISINFO = writeDbf([['THINAM', 'C', 40], ['YEARTHAI', 'C', 1], ['TAXID', 'C', 15], ['ACCNUM00', 'C', 12], ['VATRAT', 'N', 5]], [{ v: ['บริษัท ทดสอบ จำกัด', '1', '0105551234567XX', '1111', '7'] }]);
    files.ISPRD = writeDbf([...months.flatMap((m) => [[`BEG${m}`, 'D', 8], [`END${m}`, 'D', 8]] as FieldSpec[]), ['LOCK1', 'C', 1]],
      [{ v: [...months.flatMap((m) => [`2010-${String(m).padStart(2, '0')}-01`, `2010-${String(m).padStart(2, '0')}-${last(m)}`]), 'Y'] }]);
    const accF: FieldSpec[] = [['ACCNUM', 'C', 12], ['ACCNAM', 'C', 40], ['PARENT', 'C', 12], ['LEVEL', 'N', 2], ['GROUP', 'C', 1], ['ACCTYP', 'C', 1], ['NATURE', 'C', 1], ['STATUS', 'C', 1]];
    files.GLACC = writeDbf(accF, [{ v: ['1111', 'เงินสด', '', '1', '1', '0', '0', 'A'] }, { v: ['4100', 'รายได้จากการขาย', '', '1', '4', '0', '1', 'A'] }]);
    files.ISRUN = writeDbf([['DOCTYP', 'C', 2], ['DOCCOD', 'C', 2], ['PREFIX', 'C', 2], ['POSDES', 'C', 30]], [{ v: ['GL', '01', 'JV', 'สมุดรายวันทั่วไป'] }]);
    const jF: FieldSpec[] = [['VOUCHER', 'C', 12], ['JNLTYP', 'C', 2], ['VOUDAT', 'D', 8], ['DESCRP', 'C', 40], ['DOCSTAT', 'C', 1], ['TRNSTAT', 'C', 1]];
    files.GLJNL = writeDbf(jF, [{ v: ['JV001', '01', '2010-03-15', 'ขายสด', 'N', 'P'] }, { v: ['JV000', '01', '2008-05-01', 'ปีเก่า', 'N', 'P'] }]);
    const lF: FieldSpec[] = [['VOUCHER', 'C', 12], ['TRNTYP', 'C', 1], ['ACCNUM', 'C', 12], ['AMOUNT', 'N', 14], ['DESCRP', 'C', 20]];
    files.GLJNLIT = writeDbf(lF, [
      { v: ['JV001', '0', '1111', '100.125', 'เงินสด'] }, { v: ['JV001', '1', '4100', '100.125', ''] },
      { del: true, v: ['JV001', '0', '1111', '999', 'ลบแล้ว'] },
      { v: ['JV000', '0', '9999', '-5.5', ''] }, { v: ['JV000', '0', '1111', '5.5', ''] },
    ]);
  }, 180_000);
  afterAll(async () => { await database?.close(); });

  it('imports in one transaction (replica mode works on PGlite) with Python-identical ids and rounding', async () => {
    const steps: string[] = [];
    const rep = await importExpress(database.db, memSource(files), { code: 'TESTCO', tenantId: null, onProgress: (s) => steps.push(s) });
    expect(rep.company_id).toBe(uuid5(uuid5(NAMESPACE_URL, 'express-migration/TESTCO'), 'company'));
    expect(rep.name_th).toBe('บริษัท ทดสอบ จำกัด');
    expect(steps.at(-1)).toBe('เสร็จ');
    expect(rep.counts.gl_journal).toEqual({ rows: 2, source: 'GLJNL' });
    expect(rep.counts.gl_journal_line!.rows).toBe(4);
    expect(rep.quality.missing_gl_account).toEqual(['9999']);
    expect(rep.quality.periods_created_for_old_years).toEqual(['2008']);
    const co = await database.db.selectFrom('sys_company').selectAll().where('id', '=', rep.company_id).executeTakeFirstOrThrow();
    expect(co).toMatchObject({ code: 'TESTCO', tax_id: '0105551234567', year_system: 'B' });
    const j = await database.db.selectFrom('gl_journal').select(['voucher_no', 'total_debit', 'total_credit', 'created_by']).where('company_id', '=', rep.company_id).orderBy('voucher_no').execute();
    expect(j).toEqual([{ voucher_no: 'JV000', total_debit: '5.50', total_credit: '5.50', created_by: null }, { voucher_no: 'JV001', total_debit: '100.12', total_credit: '100.12', created_by: null }]);
    // บรรทัดยอดติดลบฝั่งเดบิต → เครดิต (เหมือน Python)
    const neg = await database.db.selectFrom('gl_journal_line').select(['debit', 'credit']).where('company_id', '=', rep.company_id).where('account_id', '=', uuid5(uuid5(NAMESPACE_URL, 'express-migration/TESTCO'), 'acc/9999')).executeTakeFirstOrThrow();
    expect(neg).toEqual({ debit: '0.00', credit: '5.50' });
    const s = await database.db.selectFrom('sys_setting').select(['key', 'value']).where('company_id', '=', rep.company_id).where('key', '=', 'gen.vat_rate').executeTakeFirstOrThrow();
    expect(s.value).toBe(7);
    const v = (await validateExpress(database.db, memSource(files), rep.company_id)) as Record<string, unknown>;
    expect(v.journals_total).toBe(2);
    expect(v.journals_unbalanced).toBe(0);
    expect(v.row_parity).toMatchObject({ GLJNLIT: [4, 4] });
  });

  it('HANDOFF 193: migrated journals are marked from_express; the backfill rule (uuid v5 + same transaction as the company) finds them again and never a hand-keyed journal', async () => {
    const co = uuid5(uuid5(NAMESPACE_URL, 'express-migration/TESTCO'), 'company');
    const flags = async (db: typeof database.db) => (await sql<{ v: string; f: boolean }>`SELECT voucher_no AS v, from_express AS f FROM gl_journal WHERE company_id = ${co} ORDER BY voucher_no`.execute(db)).rows;
    expect(await flags(database.db)).toEqual([{ v: 'JV000', f: true }, { v: 'JV001', f: true }]);
    class Rollback extends Error {}
    await database.db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
      // ใบที่คีย์เองใน Buddy (รหัสสุ่มรุ่น 4) แม้เวลาสร้างตรงกับบริษัทก็ไม่ถูกทำเครื่องหมาย
      await sql`INSERT INTO gl_journal (company_id, branch_id, journal_book_id, voucher_no, voucher_date, period_id, created_at)
        SELECT j.company_id, j.branch_id, j.journal_book_id, 'MAN001', j.voucher_date, j.period_id, c.created_at FROM gl_journal j JOIN sys_company c ON c.id = j.company_id WHERE j.company_id = ${co} LIMIT 1`.execute(tx);
      // ข้อมูลก่อน migration 0080 (ยังไม่มีเครื่องหมาย) — ไม่มีเอกสาร Express และไม่มีบันทึก IMPORT_EXPRESS (นำเข้าทางคำสั่ง) ก็ยังพบด้วยเวลาสร้างบริษัท
      await sql`UPDATE gl_journal SET from_express = false WHERE company_id = ${co}`.execute(tx);
      await sql`SELECT set_config('app.allow_locked_period', 'off', true)`.execute(tx);
      await COMPANY_STEPS.find((s) => s.n === 80)!.run(tx, co);   // งวดปิดอยู่ (ISPRD LOCK1) ก็ทำเครื่องหมายได้
      expect(await flags(tx)).toEqual([{ v: 'JV000', f: true }, { v: 'JV001', f: true }, { v: 'MAN001', f: false }]);
      expect((await sql<{ v: string }>`SELECT current_setting('app.allow_locked_period', true) AS v`.execute(tx)).rows[0]!.v).toBe('off');
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    expect(await flags(database.db)).toEqual([{ v: 'JV000', f: true }, { v: 'JV001', f: true }]);
  });

  it('second import with its own namespace/tenant/user does not touch the first company', async () => {
    const tenant = await database.db.insertInto('sys_tenant').values({ code: 'T2', name: 'ลูกค้าที่สอง' }).returning('id').executeTakeFirstOrThrow();
    const user = await database.db.insertInto('sys_user').values({ username: 'imp', display_name: 'ผู้นำเข้า', password_hash: 'x', tenant_id: tenant.id }).returning('id').executeTakeFirstOrThrow();
    const rep = await importExpress(database.db, memSource(files), { code: 'TESTCO2', tenantId: tenant.id, idNamespace: 'express-import/job-1', userId: user.id });
    expect(rep.company_id).toBe(uuid5(uuid5(NAMESPACE_URL, 'express-import/job-1'), 'company'));
    const co = await database.db.selectFrom('sys_company').select(['tenant_id']).where('id', '=', rep.company_id).executeTakeFirstOrThrow();
    expect(co.tenant_id).toBe(tenant.id);
    const j = await database.db.selectFrom('gl_journal').select(['created_by']).where('company_id', '=', rep.company_id).execute();
    expect(j).toHaveLength(2);
    expect(j.every((x) => x.created_by === user.id)).toBe(true);
    const all = await database.db.selectFrom('gl_journal').select(['company_id']).execute();
    expect(all).toHaveLength(4);   // บริษัทแรกยังมี 2 ใบเท่าเดิม
    // นำเข้าซ้ำด้วย namespace เดิม = ไม่เพิ่มแถว (ON CONFLICT DO NOTHING)
    await importExpress(database.db, memSource(files), { code: 'TESTCO2', tenantId: tenant.id, idNamespace: 'express-import/job-1', userId: user.id });
    expect(await database.db.selectFrom('gl_journal_line').select('id').where('company_id', '=', rep.company_id).execute()).toHaveLength(4);
  });

  it('HANDOFF 177: invoices and VAT rows get the customer name/address/tax id from ARMAS (Express ARTRN/ISVAT carry only the code)', async () => {
    const f2: Record<string, Buffer> = { ...files };
    f2.ARMAS = writeDbf([['CUSCOD', 'C', 10], ['PRENAM', 'C', 15], ['CUSNAM', 'C', 40], ['ADDR01', 'C', 30], ['ADDR02', 'C', 30], ['ZIPCOD', 'C', 5], ['TAXID', 'C', 15], ['STATUS', 'C', 1]],
      [{ v: ['OCIO', 'บริษัท', 'โอซีไอโอ ฮอสพิทาลิตี้ จำกัด', '99 ถนนทดสอบ', 'เมือง เชียงใหม่', '50000', '0505566016991', 'A'] }]);
    const trF: FieldSpec[] = [['DOCNUM', 'C', 12], ['RECTYP', 'C', 1], ['DOCDAT', 'D', 8], ['CUSCOD', 'C', 10], ['FLGVAT', 'C', 1], ['AMOUNT', 'N', 14], ['TOTAL', 'N', 14], ['VATRAT', 'N', 5], ['VATAMT', 'N', 14], ['NETAMT', 'N', 14], ['DOCSTAT', 'C', 1]];
    f2.ARTRN = writeDbf(trF, [{ v: ['IV100301001', '3', '2010-03-20', 'OCIO', '1', '1000', '1000', '7', '70', '1070', 'N'] }, { v: ['IV100301002', '3', '2010-03-21', 'OCIO', '0', '500', '500', '0', '0', '500', 'N'] }]);
    f2.ISVAT = writeDbf([['VATREC', 'C', 1], ['DOCNUM', 'C', 12], ['REFNUM', 'C', 15], ['VATDAT', 'D', 8], ['DOCDAT', 'D', 8], ['AMT01', 'N', 14], ['VAT01', 'N', 14], ['DESCRP', 'C', 40], ['DOCSTAT', 'C', 1]],
      [{ v: ['S', 'IV100301001', 'IV100301001', '2010-03-20', '2010-03-20', '1000', '70', 'ขายเชื่อ', 'N'] }]);
    const rep = await importExpress(database.db, memSource(f2), { code: 'TESTCO3', tenantId: null, idNamespace: 'express-import/h177' });
    const hs = await database.db.selectFrom('doc_header').select(['doc_no', 'party_name', 'party_address', 'party_tax_id', 'party_tax_branch_no', 'vat_amount'])
      .where('company_id', '=', rep.company_id).where('doc_no', 'like', 'IV1003%').orderBy('doc_no').execute();
    expect(hs).toEqual([
      { doc_no: 'IV100301001', party_name: 'บริษัท โอซีไอโอ ฮอสพิทาลิตี้ จำกัด', party_address: '99 ถนนทดสอบ เมือง เชียงใหม่ 50000', party_tax_id: '0505566016991', party_tax_branch_no: '00000', vat_amount: '70.00' },
      // ขายที่ไม่มี VAT ใน Express (VATAMT 0) = ช่อง "ภาษี" ในรายการว่าง (แสดงว่างเมื่อเป็นศูนย์) — ไม่ใช่ข้อมูลหาย
      { doc_no: 'IV100301002', party_name: 'บริษัท โอซีไอโอ ฮอสพิทาลิตี้ จำกัด', party_address: '99 ถนนทดสอบ เมือง เชียงใหม่ 50000', party_tax_id: '0505566016991', party_tax_branch_no: '00000', vat_amount: '0.00' },
    ]);
    const v = await database.db.selectFrom('tax_vat_entry').select(['party_name', 'party_tax_id', 'party_tax_branch_no']).where('company_id', '=', rep.company_id).execute();
    expect(v).toEqual([{ party_name: 'บริษัท โอซีไอโอ ฮอสพิทาลิตี้ จำกัด', party_tax_id: '0505566016991', party_tax_branch_no: '00000' }]);
    // บริษัทอื่นไม่ถูกแตะ
    expect((await database.db.selectFrom('doc_header').select('id').where('company_id', '<>', rep.company_id).where('party_name', 'is not', null).execute())).toHaveLength(0);
  });

  it('HANDOFF 196: one-off OCIO fix — Express docs numbered letters+NN move to branch 000NN with their journal/VAT/WHT/cheque; receipts follow invoices on one branch, cheque slips follow their cheques; HO numbers, Buddy-keyed docs and other companies stay; missing branch = skip + log (no abort); totals unchanged; re-run = 0; migration file = same SQL; restore step only for OCIO', async () => {
    const { OCIO_BRANCH_FIX_FUNCTION, OCIO_BRANCH_FIX_MIGRATION } = await import('../src/data-fixes/ocio-express-branch.js');
    const OCIO_BRANCH_FIX_SQL = OCIO_BRANCH_FIX_FUNCTION;   // สร้างฟังก์ชัน · fx() = เรียก
    const file = readFileSync(new URL('../../../db/migrations/0081_ocio_express_branch_fix.sql', import.meta.url), 'utf8');
    expect(file.endsWith(OCIO_BRANCH_FIX_MIGRATION)).toBe(true);
    const step = COMPANY_STEPS.find((s) => s.n === 81)!;
    const rep = await importExpress(database.db, memSource(files), { code: 'OCIO-0505566016991', tenantId: null });
    const co = rep.company_id;
    const other = uuid5(uuid5(NAMESPACE_URL, 'express-migration/TESTCO'), 'company');
    class Rollback extends Error {}
    await database.db.transaction().execute(async (tx) => {
      await sql`SELECT set_config('app.allow_locked_period', 'on', true)`.execute(tx);
      const q1 = async <T,>(s: { execute: (db: typeof tx) => Promise<{ rows: T[] }> }) => (await s.execute(tx)).rows[0]!;
      const mk = async (company: string, no: string, rectype: string | null, express = true) => {
        const t = await q1(sql<{ id: string; branch_id: string; journal_book_id: string; period_id: string; voucher_date: string }>`SELECT id, branch_id, journal_book_id, period_id, voucher_date::text FROM gl_journal WHERE company_id = ${company} AND voucher_no = 'JV001'`);
        const dt = await q1(sql<{ id: string }>`INSERT INTO md_doc_type (company_id, code, doc_class, module, name_th) VALUES (${company}, ${'T' + no.slice(-5)}, 'IV', 'AR', 'ขายเงินเชื่อ (ทดสอบ)') RETURNING id`);
        const h = (await q1(sql<{ id: string }>`INSERT INTO doc_header (company_id, branch_id, doc_type_id, doc_class, module, doc_no, doc_date, net_amount, vat_amount, express_rectype)
          VALUES (${company}, ${t.branch_id}, ${dt.id}, 'IV', 'AR', ${no}, ${t.voucher_date}, 107, 7, ${rectype}) RETURNING id`)).id;
        const j = (await q1(sql<{ id: string }>`INSERT INTO gl_journal (company_id, branch_id, journal_book_id, voucher_no, voucher_date, period_id, source_header_id, from_express)
          VALUES (${company}, ${t.branch_id}, ${t.journal_book_id}, ${no}, ${t.voucher_date}, ${t.period_id}, ${h}, ${express}) RETURNING id`)).id;
        await sql`INSERT INTO gl_journal_line (company_id, journal_id, line_no, account_id, debit, credit) SELECT company_id, ${j}, line_no, account_id, debit, credit FROM gl_journal_line WHERE journal_id = ${t.id}`.execute(tx);
        await sql`UPDATE doc_header SET journal_id = ${j} WHERE id = ${h}`.execute(tx);
        await sql`INSERT INTO tax_vat_entry (company_id, vat_kind, header_id, journal_id, branch_id, doc_no, doc_date, tax_invoice_date, vat_period_id, base_amount, vat_amount)
          VALUES (${company}, 'S', ${h}, ${j}, ${t.branch_id}, ${no}, ${t.voucher_date}, ${t.voucher_date}, ${t.period_id}, 100, 7)`.execute(tx);
        await sql`INSERT INTO tax_wht_entry (company_id, form_type, header_id, branch_id, certificate_date, tax_period_id, payee_name, paid_amount, rate, tax_amount) VALUES (${company}, 'S03', ${h}, ${t.branch_id}, ${t.voucher_date}, ${t.period_id}, 'ผู้ถูกหัก', 100, 3, 3)`.execute(tx);
        await sql`INSERT INTO fin_cheque (company_id, branch_id, direction, instrument, cheque_no, cheque_date, amount, net_amount, status, source_header_id) VALUES (${company}, ${t.branch_id}, 'R', 'CHEQUE', ${'C' + no}, ${t.voucher_date}, 107, 107, '10', ${h})`.execute(tx);
        return h;
      };
      // ใบเสร็จที่ย้ายมา: ตัดชำระใบกำกับ → "ย้ายตามใบขาย" เมื่อใบที่ตัดอยู่สาขาเดียว
      const rcpt = async (no: string, invoices: string[]) => {
        const h = await mk(co, no, '1');
        await sql`UPDATE doc_header SET doc_class = 'RE' WHERE id = ${h}`.execute(tx);
        await sql`DELETE FROM tax_vat_entry WHERE header_id = ${h}`.execute(tx);
        for (const i of invoices) await sql`INSERT INTO doc_settlement (company_id, payment_header_id, invoice_header_id, amount) VALUES (${co}, ${h}, ${i}, 10)`.execute(tx);
        return h;
      };
      const iv01 = await mk(co, 'IV01-0039', '1'); await mk(co, 'INV03-006', '1'); const iv02 = await mk(co, 'IV02-0049', null);   // ไม่มี rectype แต่ใบสำคัญ from_express = ย้ายมา
      const iv00 = await mk(co, 'IV00-0045', '1'); await mk(co, 'IVBK-001', '1'); await mk(co, 'IVEX-0-109', '1'); await mk(co, 'IV6801001', '1');
      const re1 = await rcpt('RE0001', [iv01]); const re2 = await rcpt('RE0002', [iv01, iv02]); await rcpt('RE0003', [iv00]); await rcpt('RE0004', []);
      // ใบนำฝากเช็คที่ย้ายมา: เช็คของ RE0001 อย่างเดียว → ตาม · ปนกับ RE0002 (สำนักงานใหญ่) → อยู่สำนักงานใหญ่
      const slip = async (no: string, from: string[]) => {
        const q = await mk(co, no, '1');
        await sql`UPDATE doc_header SET doc_class = 'BQ' WHERE id = ${q}`.execute(tx);
        await sql`DELETE FROM tax_vat_entry WHERE header_id = ${q}`.execute(tx); await sql`DELETE FROM tax_wht_entry WHERE header_id = ${q}`.execute(tx); await sql`DELETE FROM fin_cheque WHERE source_header_id = ${q}`.execute(tx);
        await sql`UPDATE fin_cheque SET deposit_header_id = ${q} WHERE source_header_id = ANY(${from}::uuid[])`.execute(tx);
      };
      await slip('BQ0001', [re1]);
      await mk(co, 'IV01-0100', null, false);   // คีย์ใน Buddy เอง (ไม่ใช่ Express) — ไม่แตะแม้เลขชุดตรง
      await mk(other, 'IV01-0001', '1');        // บริษัทอื่น — ไม่แตะ
      // ใบสำคัญ GL ที่ย้ายมา ไม่มีเอกสาร เลขชุดบอกสาขา
      await sql`INSERT INTO gl_journal (company_id, branch_id, journal_book_id, voucher_no, voucher_date, period_id, from_express)
        SELECT company_id, branch_id, journal_book_id, 'JV02-0007', voucher_date, period_id, true FROM gl_journal WHERE company_id = ${co} AND voucher_no = 'JV000'`.execute(tx);
      await sql`INSERT INTO gl_journal_line (company_id, journal_id, line_no, account_id, debit, credit)
        SELECT l.company_id, (SELECT id FROM gl_journal WHERE company_id = ${co} AND voucher_no = 'JV02-0007'), l.line_no, l.account_id, l.debit, l.credit FROM gl_journal_line l JOIN gl_journal j ON j.id = l.journal_id WHERE j.company_id = ${co} AND j.voucher_no = 'JV001'`.execute(tx);

      const branchOf = async (company: string) => (await sql<{ t: string; no: string; br: string }>`
          SELECT 'doc' t, h.doc_no no, b.tax_branch_no br FROM doc_header h JOIN sys_branch b ON b.id = h.branch_id WHERE h.company_id = ${company}
          UNION ALL SELECT 'jnl', j.voucher_no, b.tax_branch_no FROM gl_journal j JOIN sys_branch b ON b.id = j.branch_id WHERE j.company_id = ${company}
          UNION ALL SELECT 'vat', v.doc_no, b.tax_branch_no FROM tax_vat_entry v JOIN sys_branch b ON b.id = v.branch_id WHERE v.company_id = ${company}
          UNION ALL SELECT 'wht', h.doc_no, b.tax_branch_no FROM tax_wht_entry w JOIN doc_header h ON h.id = w.header_id JOIN sys_branch b ON b.id = w.branch_id WHERE w.company_id = ${company}
          UNION ALL SELECT 'chq', f.cheque_no, b.tax_branch_no FROM fin_cheque f JOIN sys_branch b ON b.id = f.branch_id WHERE f.company_id = ${company}
          ORDER BY 1, 2`.execute(tx)).rows.map((r) => `${r.t}:${r.no}=${r.br}`);
      const totals = async () => (await sql`SELECT (SELECT sum(l.debit)::text || '/' || sum(l.credit)::text FROM gl_journal_line l WHERE l.company_id = ${co}) tb,
          (SELECT sum(vat_amount)::text FROM tax_vat_entry WHERE company_id = ${co}) vat, (SELECT sum(net_amount)::text FROM doc_header WHERE company_id = ${co}) net,
          (SELECT md5(string_agg(id::text || doc_no || doc_date::text || row_version::text || updated_at::text, ',' ORDER BY id)) FROM doc_header WHERE company_id = ${co}) fp`.execute(tx)).rows[0];
      const otherBefore = await branchOf(other);

      // ยังไม่มีสาขา 00001–00003 → ไม่แก้อะไร + บันทึก BRANCH_FIX_SKIPPED (ไม่ล้ม deploy) · ทำซ้ำภายหลังได้ด้วย SELECT ocio196_branch_fix()
      const fx = async () => (await sql<{ r: string }>`SELECT ocio196_branch_fix() AS r`.execute(tx)).rows[0]!.r;
      await sql.raw(OCIO_BRANCH_FIX_SQL).execute(tx);
      expect(await fx()).toMatch(/^skipped: /);
      expect((await branchOf(co)).every((x) => x.endsWith('=00000'))).toBe(true);
      const skipped = (await sql<{ detail: { reason: string } }>`SELECT detail FROM sys_activity_log WHERE company_id = ${co} AND action = 'BRANCH_FIX_SKIPPED'`.execute(tx)).rows;
      expect(skipped.map((r) => r.detail.reason)).toEqual(['missing branch 00001; missing branch 00002; missing branch 00003']);

      for (const [code, no] of [['P01', '00001'], ['W02', '00002'], ['W03', '00003']]) await sql`INSERT INTO sys_branch (company_id, code, name, tax_branch_no, is_head_office) VALUES (${co}, ${code}, ${'สาขา ' + no}, ${no}, false)`.execute(tx);
      // สาขาซ้ำ = ข้ามเช่นกัน
      await sql`INSERT INTO sys_branch (company_id, code, name, tax_branch_no, is_head_office) VALUES (${co}, 'P01B', 'สาขาซ้ำ', '00001', false)`.execute(tx);
      expect(await fx()).toBe('skipped: duplicate branch 00001');
      await sql`UPDATE sys_branch SET deleted_at = now() WHERE company_id = ${co} AND code = 'P01B'`.execute(tx);
      const before = await totals();
      expect(await fx()).toBe('moved docs 5, journals 6, vat 3, wht 4, cheques 4');
      const moved = Object.fromEntries((await branchOf(co)).map((x) => x.split('=') as [string, string]));
      for (const t of ['doc', 'jnl', 'vat', 'wht']) {
        expect([moved[`${t}:IV01-0039`], moved[`${t}:IV02-0049`], moved[`${t}:INV03-006`]], t).toEqual(['00001', '00002', '00003']);
        expect(['IV00-0045', 'IVBK-001', 'IVEX-0-109', 'IV6801001', 'IV01-0100'].map((n) => moved[`${t}:${n}`]), t).toEqual(Array(5).fill('00000'));
      }
      expect([moved['chq:CIV01-0039'], moved['chq:CIV01-0100'], moved['jnl:JV02-0007'], moved['jnl:JV001']]).toEqual(['00001', '00000', '00002', '00000']);
      // ใบเสร็จ: ตัดใบสาขา 00001 อย่างเดียว → 00001 (พร้อมใบสำคัญ/WHT/เช็ค) · ตัดหลายสาขา/สำนักงานใหญ่/ไม่ได้ตัด → 00000 · ใบนำฝากเช็คตามเช็ค
      expect(['doc', 'jnl', 'wht'].map((t) => moved[`${t}:RE0001`])).toEqual(['00001', '00001', '00001']);
      expect([moved['chq:CRE0001'], moved['doc:RE0002'], moved['jnl:RE0002'], moved['doc:RE0003'], moved['doc:RE0004'], moved['doc:BQ0001'], moved['jnl:BQ0001']]).toEqual(['00001', '00000', '00000', '00000', '00000', '00001', '00001']);
      expect(await totals()).toEqual(before);   // ยอด เลขที่ วันที่ รุ่นแถว เวลาแก้ไข เท่าเดิม
      expect(await branchOf(other)).toEqual(otherBefore);
      const log = (await sql<{ detail: { docs: number; journals: number; vat: number; by_branch: Record<string, { docs: number; by_prefix: Record<string, number> }> } }>`SELECT detail FROM sys_activity_log WHERE company_id = ${co} AND action = 'BRANCH_FIX'`.execute(tx)).rows;
      expect(log).toHaveLength(1);
      expect([log[0]!.detail.docs, log[0]!.detail.journals, log[0]!.detail.vat, log[0]!.detail.by_branch['00003']!.by_prefix, log[0]!.detail.by_branch['00001']!.by_prefix]).toEqual([5, 6, 3, { INV03: 1 }, { IV01: 1, RE: 1, BQ: 1 }]);
      const trig = (await sql<{ n: number }>`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN ('doc_header'::regclass, 'gl_journal'::regclass, 'tax_vat_entry'::regclass, 'tax_wht_entry'::regclass, 'fin_cheque'::regclass) AND NOT tgisinternal AND tgenabled = 'D'`.execute(tx)).rows[0]!.n;
      expect(trig).toBe(0);

      // รันซ้ำ / ขั้นนำแฟ้มสำรองกลับ = 0 แถว ไม่บันทึกซ้ำ · บริษัทอื่นไม่ทำอะไร
      const snap = await branchOf(co);
      expect(await fx()).toBe('moved docs 0, journals 0, vat 0, wht 0, cheques 0');
      await step.run(tx, co); await step.run(tx, other);
      expect(await branchOf(co)).toEqual(snap);
      expect(await branchOf(other)).toEqual(otherBefore);
      expect((await sql<{ n: number }>`SELECT count(*)::int n FROM sys_activity_log WHERE action = 'BRANCH_FIX'`.execute(tx)).rows[0]!.n).toBe(1);
      // แฟ้มสำรองเก่าของ OCIO (สาขากลับเป็นสำนักงานใหญ่) → ขั้น n:81 แก้ให้เหมือนกัน
      await sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(tx);
      await sql`ALTER TABLE doc_header DISABLE TRIGGER USER`.execute(tx);
      await sql`UPDATE doc_header SET branch_id = (SELECT id FROM sys_branch WHERE company_id = ${co} AND is_head_office) WHERE company_id = ${co} AND doc_no = 'IV01-0039'`.execute(tx);
      await sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(tx);
      await sql`ALTER TABLE doc_header ENABLE TRIGGER USER`.execute(tx);
      await sql`SET CONSTRAINTS ALL DEFERRED`.execute(tx);
      await step.run(tx, co);
      expect(await branchOf(co)).toEqual(snap);
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  });
});
