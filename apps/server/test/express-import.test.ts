/**
 * ตัวนำเข้า Express (.DBF) แบบ TypeScript (T0.12): ตัวอ่าน DBF, uuid5, การปัดเลขแบบ Python และการนำเข้าทั้งเส้นบน PGlite
 * ค่าที่คาดหวังของ uuid5/round/repr/sum มาจาก Python 3.12 (migrate_express.py ต้นฉบับ)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { loadConfig } from '../src/config.js';
import { openDbf, dbfRecords } from '../src/import/express/dbf.js';
import { importExpress, validateExpress, uuid5, pyRound, pyFloatRepr, pySum, NAMESPACE_URL, type DbfSource } from '../src/import/express/migrate.js';

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
});
