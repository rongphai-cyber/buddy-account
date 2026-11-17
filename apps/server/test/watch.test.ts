/**
 * ตัวเฝ้าระบบบนคลาวด์ wts-watch (cloud/watch · HANDOFF ข้อ 121)
 *  - ล่มติดกัน 5 ครั้ง (5 นาที) จึงแจ้ง · ล้มสั้น ๆ ตอน deploy ไม่แจ้ง · เตือนซ้ำทุกชั่วโมง · กลับมา = แจ้งพร้อมเวลาที่ล่ม
 *  - อีเมลภาษาไทยเข้ารหัส UTF-8 ถูกต้อง
 *  - /api/v1/health?db=1 ของ Buddy ตรวจฐานข้อมูลจริง (ต่อไม่ได้ = 503)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase, type Database } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import {
  CHECKS, FAIL_LIMIT, REMIND_MS, alertMail, emptyState, failDetail, mime, queue, readHealth, resetStats, step, summaryMail, thaiTime,
  type Alert, type AppState, type Result,
} from '../../../cloud/watch/logic.js';

const buddy = CHECKS[0]!;
const OK: Result = { ok: true, detail: 'รุ่น 2569.11.17-1 · 80 ms', ms: 80 };
const BAD: Result = { ok: false, detail: 'ตอบ HTTP 503', ms: 30 };
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 17, 2, 0); // 17/11/2569 09:00 เวลาไทย

/** ป้อนผลทีละนาที คืนสถานะสุดท้าย + การแจ้งเตือนทั้งหมด */
function run(results: Result[], start: AppState | undefined = undefined, t = T0) {
  let s = start;
  const alerts: { at: number; alert: Alert }[] = [];
  results.forEach((r, i) => {
    const out = step(s, buddy, r, t + i * MIN);
    s = out.next;
    if (out.alert) alerts.push({ at: i, alert: out.alert });
  });
  return { state: s!, alerts };
}

describe('ตัวเฝ้าระบบ: ตัดสินการแจ้งเตือน', () => {
  it('ล้มไม่ถึง 5 ครั้งแล้วกลับมา (เช่นตอน deploy) = ไม่แจ้งอะไรเลย', () => {
    const { state, alerts } = run([OK, BAD, BAD, BAD, BAD, OK, OK]);
    expect(alerts).toEqual([]);
    expect(state.fails).toBe(0);
    expect(state.incidents).toBe(0);
  });

  it('ล้มติดกัน 5 ครั้ง = แจ้ง "ล่ม" ครั้งเดียว นับเวลาจากครั้งแรกที่ล้ม · กลับมา = แจ้ง "กลับมาแล้ว" พร้อมเวลาที่ล่ม', () => {
    const { state, alerts } = run([OK, BAD, BAD, BAD, BAD, BAD, BAD, BAD, OK]);
    expect(alerts.map((a) => [a.at, a.alert.kind])).toEqual([[1 + FAIL_LIMIT - 1, 'down'], [8, 'up']]);
    expect(alerts[0]!.alert.since).toBe(T0 + 1 * MIN);
    const up = alerts[1]!.alert;
    expect(up.kind === 'up' && up.downMs).toBe(7 * MIN);
    expect(state).toMatchObject({ fails: 0, incidents: 1, downMs: 7 * MIN });
    expect(state.downSince).toBeUndefined();
  });

  it('ยังล่มอยู่ = เตือนซ้ำทุก 1 ชั่วโมง (ไม่ส่งทุกนาที)', () => {
    const n = FAIL_LIMIT + 2 * (REMIND_MS / MIN) + 5;
    const { alerts } = run(Array(n).fill(BAD));
    expect(alerts.map((a) => a.alert.kind)).toEqual(['down', 'still', 'still']);
    expect(alerts[1]!.at - alerts[0]!.at).toBe(REMIND_MS / MIN);
  });

  it('สถิติรายสัปดาห์นับการล่มแต่ละครั้ง และล้างได้หลังสรุป', () => {
    const first = run([...Array(FAIL_LIMIT).fill(BAD), OK]);
    const second = run([...Array(FAIL_LIMIT + 3).fill(BAD), OK], first.state, T0 + 100 * MIN);
    expect(second.state).toMatchObject({ incidents: 2, downMs: (FAIL_LIMIT) * MIN + (FAIL_LIMIT + 3) * MIN });
    const st = emptyState(T0);
    st.apps.buddy = second.state;
    resetStats(st, T0 + 7 * 24 * 60 * MIN);
    expect(st.apps.buddy).toMatchObject({ incidents: 0, downMs: 0 });
  });
});

describe('ตัวเฝ้าระบบ: อ่านผล health', () => {
  const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  it('200 + ok:true = ใช้ได้ · 503 พร้อมข้อความ = ใช้ไม่ได้พร้อมสาเหตุ · หน้าเว็บที่ไม่ใช่ JSON = ใช้ไม่ได้', async () => {
    expect(await readHealth(res(200, { ok: true, version: '2569.11.17-1' }), 50)).toMatchObject({ ok: true, detail: 'รุ่น 2569.11.17-1 · 50 ms' });
    const db = await readHealth(res(503, { ok: false, error: { message: 'โปรแกรมต่อฐานข้อมูลไม่ได้' } }), 50);
    expect(db).toMatchObject({ ok: false });
    expect(db.detail).toContain('HTTP 503 — โปรแกรมต่อฐานข้อมูลไม่ได้');
    expect((await readHealth(res(200, '<html>login</html>'), 5)).ok).toBe(false);
    expect((await readHealth(res(200, { ok: false }), 5)).ok).toBe(false);
    expect(failDetail(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('ไม่ตอบภายใน 25 วินาที');
  });
});

describe('ตัวเฝ้าระบบ: อีเมล', () => {
  it('หลายโปรแกรมในรอบเดียวรวมเป็นอีเมลฉบับเดียว เวลาเป็น พ.ศ. ไทย · ไม่มีการแจ้ง = ไม่มีอีเมล', () => {
    expect(thaiTime(T0)).toBe('17/11/2569 09:00');
    expect(alertMail([], T0)).toBeUndefined();
    const m = alertMail([
      { kind: 'down', check: buddy, since: T0, detail: 'ตอบ HTTP 503' },
      { kind: 'up', check: CHECKS[1]!, since: T0 - 90 * MIN, downMs: 90 * MIN },
    ], T0 + 5 * MIN)!;
    expect(m.subject).toBe('🔴 WTS แจ้งเตือน: Buddy Account ใช้ไม่ได้');
    expect(m.text).toContain('Buddy Account (https://app.worktruesolution.net) ใช้ไม่ได้ ตั้งแต่ 17/11/2569 09:00 (5 นาที)');
    expect(m.text).toContain('WTS-POS (https://pos.worktruesolution.net) กลับมาใช้ได้แล้ว');
    expect(m.text).toContain('รวม 1 ชั่วโมง 30 นาที');
    expect(m.text).toContain('แจ้งผู้ช่วย');
    expect(alertMail([{ kind: 'up', check: buddy, since: T0, downMs: 6 * MIN }], T0)!.subject).toBe('🟢 WTS: Buddy Account กลับมาใช้ได้แล้ว');
  });

  it('อีเมลเริ่มเฝ้าระบบ/สรุปรายสัปดาห์ แสดงทุกโปรแกรม', () => {
    const st = emptyState(T0);
    const first = summaryMail(st, { buddy: OK, pos: OK, living: BAD }, T0, true);
    expect(first.subject).toContain('เริ่มเฝ้าระบบแล้ว');
    expect(first.text).toContain('Buddy Account: 🟢 ใช้ได้');
    expect(first.text).toContain('WTS-Living: 🔴 ใช้ไม่ได้ (ตอบ HTTP 503)');
    st.apps.pos = { fails: 0, incidents: 2, downMs: 20 * MIN };
    const week = summaryMail(st, { buddy: OK, pos: OK, living: OK }, T0, false);
    expect(week.text).toContain('ล่ม 2 ครั้ง รวม 20 นาที');
    expect(week.text).toContain('ไม่มีการล่ม');
  });

  it('MIME: หัวเรื่อง/เนื้อหาไทยเข้ารหัส UTF-8 base64 ถอดกลับได้ตรง · บรรทัดไม่เกิน 78 ตัว', () => {
    const mail = { subject: '🔴 WTS แจ้งเตือน: Buddy Account ใช้ไม่ได้', text: `ทดสอบภาษาไทย\n${'ก'.repeat(300)}` };
    const raw = mime('alert@worktruesolution.net', 'WTS แจ้งเตือน', 'owner@example.com', mail, T0, 'abc');
    const [head, body] = raw.split('\r\n\r\n') as [string, string];
    expect(head).toContain('From: =?UTF-8?B?');
    expect(head).toContain('<alert@worktruesolution.net>');
    expect(head).toContain('To: <owner@example.com>');
    expect(head).toContain('Message-ID: <abc@worktruesolution.net>');
    const subj = /Subject: =\?UTF-8\?B\?(.+)\?=/.exec(head)![1]!;
    expect(Buffer.from(subj, 'base64').toString('utf8')).toBe(mail.subject);
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(mail.text.replace(/\n/g, '\r\n'));
    expect(raw.split('\r\n').every((l) => l.length <= 78 || l.startsWith('Subject:') || l.startsWith('From:'))).toBe(true);
  });

  it('อีเมลค้างส่งเก็บได้ไม่เกิน 20 ฉบับ (เก็บฉบับใหม่สุด)', () => {
    const st = emptyState(T0);
    for (let i = 0; i < 25; i++) queue(st, { subject: `#${i}`, text: '' });
    queue(st, undefined);
    expect(st.outbox).toHaveLength(20);
    expect(st.outbox[0]!.subject).toBe('#5');
  });
});

describe('Buddy /api/v1/health?db=1', () => {
  let database: Database;
  let app: FastifyInstance;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BUDDY_SECRET_KEY ??= Buffer.alloc(32, 7).toString('base64');
    const cfg = { ...loadConfig({}), databaseUrl: undefined, dataDir: 'memory://' };
    database = await openDatabase(cfg);
    await migrate(database, cfg.migrationsDir, () => {});
    app = await buildApp(database, cfg);
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('ไม่ระบุ db = ตอบเหมือนเดิม (ไม่แตะฐาน) · db=1 ตรวจฐานจริง · ฐานใช้ไม่ได้ = 503 DB_DOWN', async () => {
    const plain = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(plain.statusCode).toBe(200);
    expect(plain.json()).toEqual({ ok: true, mode: 'pglite', version: expect.any(String) });
    const deep = await app.inject({ method: 'GET', url: '/api/v1/health?db=1' });
    expect(deep.statusCode).toBe(200);
    expect(deep.json()).toMatchObject({ ok: true, db: 'ok' });
    await database.close();
    const down = await app.inject({ method: 'GET', url: '/api/v1/health?db=1' });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ ok: false, db: 'down', error: { code: 'DB_DOWN' } });
  });
});
