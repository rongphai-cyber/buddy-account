// ตัวรับคำขอบน Cloudflare (Worker) หน้า container ของโปรแกรม — S1 ของ docs/20 · HANDOFF ข้อ 105
// ใช้ Durable Object Container API (ของ Cloudflare เอง ไม่ต้องติดตั้งแพ็กเกจ) · ตั้งค่าใน wrangler.jsonc ที่ราก repo
// ไฟล์นี้เหมือนกันทั้ง 3 repo (Buddy / WTS-POS / WTS-Living) ต่างกันแค่ APP ด้านล่าง
//
// - container เดียว (max_instances 1 · getByName('main')) — งานเบื้องหลังของโปรแกรมต้องมีเครื่องเดียว
// - ความลับ (wrangler secret: DATABASE_URL, กุญแจหลัก) + ค่าทั่วไป (vars) ส่งเข้า container ตอนเปิดเท่านั้น
// - X-Forwarded-For/-Proto/-Host เขียนใหม่ทุกครั้งจากข้อมูลของ Cloudflare (ค่าที่ผู้ใช้ส่งมาเองถูกทิ้ง) — โปรแกรมเชื่อเพราะ *_TRUST_PROXY=1
// - cron ทุก 5 นาทีปลุก container ให้งานเบื้องหลังทำงาน (ซิงก์ ส่งคิว) · ยังไม่ได้ตั้งความลับ = ตอบ 503 บอกวิธีแก้ ไม่เปิดโปรแกรมด้วยฐานชั่วคราว
import { DurableObject } from 'cloudflare:workers';

const APP = {
  name: 'Buddy Account',
  port: 4100,
  health: '/api/v1/health',
  /** ตัวแปรที่ส่งเข้า container (มีค่าเท่านั้น) */
  env: ['DATABASE_URL', 'BUDDY_SECRET_KEY', 'BUDDY_PUBLIC_URL', 'BUDDY_TRUST_PROXY', 'BUDDY_COOKIE_SECURE', 'BUDDY_REQUIRE_ADMIN_2FA', 'BUDDY_SIGNUP', 'LOG_LEVEL'],
  /** ต้องมีก่อนเปิด — ไม่มี = 503 (ไม่ปล่อยให้โปรแกรมเปิดด้วยฐานชั่วคราวในเครื่อง) */
  required: ['DATABASE_URL', 'BUDDY_SECRET_KEY'],
  /**
   * ชื่อเว็บสำหรับโปรแกรมคุยกัน (ไม่มีด่าน Cloudflare Access — ใช้กุญแจ API ของ Buddy แทน): WTS-POS / WTS-Living / WTS-HR เรียก Buddy
   * รับเฉพาะ /api/v1/* ที่มี Authorization: Bearer bk_… (Buddy ตรวจกุญแจเอง) + path สาธารณะด้านล่าง · ทิ้งคุกกี้ (ใช้ session ของหน้าจอไม่ได้)
   * หน้าจอ/ตั้งค่าครั้งแรก/เข้าระบบ เปิดผ่านชื่อนี้ไม่ได้
   */
  apiHosts: ['buddy-api.worktruesolution.net'],
  apiOpen: ['/api/v1/sso/jwks', '/api/v1/health'],
};

const json = (status, code, message) => new Response(JSON.stringify({ error: { code, message } }),
  { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/** ชื่อเว็บสำหรับโปรแกรมคุยกัน: คืน Response ถ้าปฏิเสธ · คืน Request (ทิ้งคุกกี้แล้ว) ถ้าผ่าน */
function apiGate(request) {
  const url = new URL(request.url);
  if (!APP.apiHosts.includes(url.hostname)) return request;
  if (!url.pathname.startsWith('/api/v1/')) return json(404, 'NOT_FOUND', `ชื่อเว็บนี้สำหรับโปรแกรมเชื่อมต่อ ${APP.name} เท่านั้น — เปิดหน้าจอที่ชื่อเว็บสำหรับผู้ใช้`);
  const open = APP.apiOpen.includes(url.pathname);
  if (!open && !/^Bearer\s+bk_/i.test(request.headers.get('authorization') ?? '')) {
    return json(401, 'API_KEY_REQUIRED', 'ต้องส่งกุญแจ API (Authorization: Bearer bk_…) — สร้างที่ อื่น ๆ › กุญแจ API ของ Buddy');
  }
  const r = new Request(request);
  r.headers.delete('cookie');
  return r;
}

const STARTUP_MS = 120_000;   // migration + เปิดโปรแกรมครั้งแรก
const IDLE_MS = 30 * 60_000;  // ไม่มีคำขอ 30 นาที = container หยุดได้ (cron ปลุกทุก 5 นาทีอยู่แล้ว)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = (status, title, body) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
  + `<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#1f2440"><h1 style="font-size:1.3rem">${title}</h1><p>${body}</p></body>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' } });

export class AppContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ready = false;
    this.starting = undefined;
  }

  envForContainer() {
    const out = {};
    for (const k of APP.env) if (this.env[k] !== undefined && this.env[k] !== null && String(this.env[k]) !== '') out[k] = String(this.env[k]);
    return out;
  }

  async healthy() {
    try {
      const r = await this.ctx.container.getTcpPort(APP.port).fetch(`http://container${APP.health}`);
      return r.ok;
    } catch { return false; }
  }

  async boot() {
    const c = this.ctx.container;
    if (!c.running) {
      c.start({ enableInternet: true, env: this.envForContainer() });   // ต้องออกอินเทอร์เน็ตได้: ฐานข้อมูล Supabase (TCP 5432)
      this.ctx.waitUntil(c.monitor()
        .then(() => console.log(`${APP.name}: container หยุด (exit 0)`))
        .catch((e) => console.error(`${APP.name}: container หยุดผิดปกติ exit ${e?.exitCode ?? '?'}`))
        .finally(() => { this.ready = false; }));
    }
    try { c.setInactivityTimeout?.(IDLE_MS); } catch { /* รุ่นที่ไม่มี — ใช้ค่าเริ่มต้น */ }
    const until = Date.now() + STARTUP_MS;
    while (Date.now() < until) {
      if (await this.healthy()) { this.ready = true; return; }
      if (!c.running) throw new Error('container หยุดระหว่างเปิด');
      await sleep(500);
    }
    throw new Error('container ไม่ตอบภายในเวลา');
  }

  async fetch(request) {
    const missing = APP.required.filter((k) => !this.env[k]);
    if (missing.length) {
      return page(503, `${APP.name} ยังไม่ได้ตั้งค่าบนคลาวด์`, `ยังไม่มีค่า ${missing.join(', ')} — ผู้ดูแลระบบรัน <code>node tools\\cloud\\put-secrets.mjs</code> ที่เครื่องสำนักงาน แล้วลองใหม่`);
    }
    if (!this.ready || !this.ctx.container.running) {
      this.starting ??= this.boot().finally(() => { this.starting = undefined; });
      try { await this.starting; } catch (e) {
        console.error(`${APP.name}: เปิดไม่สำเร็จ — ${e?.message ?? e}`);
        return page(503, `${APP.name} กำลังเปิดหรือมีปัญหา`, 'ระบบกำลังเริ่มทำงาน กรุณารอสักครู่แล้วลองใหม่ (ถ้าเป็นนานเกิน 5 นาที แจ้งผู้ดูแลระบบ)');
      }
    }
    const src = new URL(request.url);
    const url = new URL(request.url);
    url.protocol = 'http:';
    url.host = 'container';
    const fwd = new Request(url, request);
    fwd.headers.delete('host');
    for (const h of ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'forwarded']) fwd.headers.delete(h);
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) fwd.headers.set('x-forwarded-for', ip);
    fwd.headers.set('x-forwarded-proto', src.protocol.replace(':', ''));
    fwd.headers.set('x-forwarded-host', src.host);
    try {
      return await this.ctx.container.getTcpPort(APP.port).fetch(fwd);
    } catch (e) {
      this.ready = false;
      console.error(`${APP.name}: ส่งคำขอไม่สำเร็จ — ${e?.message ?? e}`);
      return page(502, `${APP.name} ตอบไม่ได้ชั่วคราว`, 'กรุณาลองใหม่อีกครั้งในไม่กี่วินาที');
    }
  }
}

export default {
  fetch: (request, env) => {
    const gated = apiGate(request);
    return gated instanceof Response ? gated : env.APP.getByName('main').fetch(gated);
  },
  // ปลุกทุก 5 นาที (wrangler.jsonc triggers.crons) — ให้งานเบื้องหลังของโปรแกรมได้ทำงาน
  scheduled: async (_event, env, ctx) => {
    ctx.waitUntil(env.APP.getByName('main').fetch(new Request(`https://cron.internal${APP.health}`)).then((r) => r.body?.cancel()).catch(() => {}));
  },
};
