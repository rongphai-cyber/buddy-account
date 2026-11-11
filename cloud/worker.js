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
   * ชื่อเว็บที่ไม่มีด่าน Cloudflare Access — ดู gate() · buddy-api = โปรแกรมคุยกัน (WTS-POS / WTS-Living / WTS-HR เรียก Buddy) ใช้กุญแจ API ของ Buddy แทน
   * หน้าจอ/ตั้งค่าครั้งแรก/เข้าระบบ เปิดผ่านชื่อนี้ไม่ได้
   */
  gates: {
    'buddy-api.worktruesolution.net': {
      prefixes: ['/api/v1/'],
      open: ['/api/v1/sso/jwks', '/api/v1/health'],
      bearer: /^Bearer\s+bk_/i,
      keyHelp: 'ต้องส่งกุญแจ API (Authorization: Bearer bk_…) — สร้างที่ อื่น ๆ › กุญแจ API ของ Buddy',
      notFound: 'ชื่อเว็บนี้สำหรับโปรแกรมเชื่อมต่อ Buddy Account เท่านั้น — เปิดหน้าจอที่ app.worktruesolution.net',
    },
  },
};

const json = (status, code, message) => new Response(JSON.stringify({ error: { code, message } }),
  { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/**
 * ชื่อเว็บที่ไม่มีด่าน Cloudflare Access (เจ้าของตั้ง Access app แบบ Bypass เฉพาะชื่อนั้น) — APP.gates[ชื่อเว็บ]:
 *   prefixes = path ที่เปิด (ขึ้นต้นด้วย) · open = path ที่เปิดเต็ม ๆ โดยไม่ต้องมีกุญแจ · bearer = รูปแบบ Authorization ที่ต้องมี (ไม่ระบุ = โปรแกรมตรวจกุญแจเอง)
 *   home = เปิด "/" แล้วพาไปที่นี่ · อื่นนอกจากนี้ = 404 · ทิ้งคุกกี้เสมอ (session ของหน้าจอหลังร้านใช้ผ่านชื่อนี้ไม่ได้)
 * คืน Response ถ้าปฏิเสธ/พาไปที่อื่น · คืน Request (ทิ้งคุกกี้แล้ว) ถ้าผ่าน · ชื่อเว็บอื่น = คืนคำขอเดิม (ด่าน Access ของ Worker คุมอยู่)
 */
function gate(request) {
  const url = new URL(request.url);
  const g = APP.gates[url.hostname];
  if (!g) return request;
  if (g.home && (url.pathname === '/' || url.pathname === g.home.replace(/\/$/, ''))) return Response.redirect(`${url.origin}${g.home}`, 302);
  const open = (g.open ?? []).includes(url.pathname);
  if (!open && !g.prefixes.some((p) => url.pathname.startsWith(p))) return json(404, 'NOT_FOUND', g.notFound);
  if (g.bearer && !open && !g.bearer.test(request.headers.get('authorization') ?? '')) return json(401, 'API_KEY_REQUIRED', g.keyHelp);
  const r = new Request(request);
  r.headers.delete('cookie');
  return r;
}

const STARTUP_MS = 120_000;   // migration + เปิดโปรแกรมครั้งแรก
const IDLE_MS = 30 * 60_000;  // ไม่มีคำขอ 30 นาที = container หยุดได้ (cron ปลุกทุก 5 นาทีอยู่แล้ว)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ที่ตั้งของโปรแกรมบนคลาวด์ = ใกล้ฐานข้อมูล Supabase (สิงคโปร์) — HANDOFF ข้อ 108
 * เดิมชื่อ 'main' ไม่ระบุที่ตั้ง → cron สร้างครั้งแรกที่สหรัฐฯ (container sea08/lax10/sjc11) ทุก query ข้ามมหาสมุทร ~200 ms
 * Durable Object ย้ายที่ไม่ได้หลังสร้าง → ใช้ชื่อใหม่ + locationHint (มีผลตอนสร้างครั้งแรกเท่านั้น)
 * container จำกัดที่ wrangler.jsonc containers[].constraints.regions = APAC
 * ชื่อเก่าใน RETIRED: ปิด container ของมันก่อนเปิดตัวใหม่ (max_instances 1 · งานเบื้องหลังต้องมีเครื่องเดียว)
 */
const INSTANCE = 'main-apac-se';
const LOCATION_HINT = 'apac-se';
const RETIRED = ['main'];
const instance = (env) => env.APP.get(env.APP.idFromName(INSTANCE), { locationHint: LOCATION_HINT });

const page = (status, title, body) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
  + `<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#1f2440"><h1 style="font-size:1.3rem">${title}</h1><p>${body}</p></body>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' } });

/** ข้อผิดพลาดของตัวรับคำขอ: /api/ ตอบ JSON (หน้าจอแสดงข้อความไทย ไม่ใช่ "Unexpected token '<'") · อื่น ๆ ตอบหน้าเว็บ */
const fail = (request, status, title, body) => (new URL(request.url).pathname.startsWith('/api/')
  ? new Response(JSON.stringify({ error: { code: status === 503 ? 'NOT_READY' : 'UPSTREAM', message: `${title} — ${body.replace(/<[^>]+>/g, '')}` } }),
    { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' } })
  : page(status, title, body));

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

  /** เรียกจากตัวใหม่ (RPC): ปิด container ของชื่อเก่า — คืน true ถ้ามีที่ต้องปิด */
  async retire() {
    this.ready = false;
    const c = this.ctx.container;
    if (!c.running) return false;
    await c.destroy();
    return true;
  }

  /** ลายนิ้วมือของค่าที่ส่งเข้า container (ไม่เก็บค่าจริง) — ค่าตั้ง/ความลับเปลี่ยน = รีสตาร์ต container ให้ใช้ค่าใหม่ */
  async envHash() {
    const data = new TextEncoder().encode(JSON.stringify(Object.entries(this.envForContainer()).sort()));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async boot() {
    const c = this.ctx.container;
    const want = await this.envHash();
    // container ที่รันอยู่เปิดด้วยค่าชุดเก่า (เช่น deploy เปลี่ยน vars โดยใช้ image เดิม) → ปิดแล้วเปิดใหม่ด้วยค่าปัจจุบัน
    if (c.running && (await this.ctx.storage.get('envHash')) !== want) {
      console.log(`${APP.name}: ค่าตั้งเปลี่ยน — รีสตาร์ต container`);
      try { await c.destroy(); } catch (e) { console.error(`${APP.name}: ปิด container เดิมไม่สำเร็จ — ${e?.message ?? e}`); }
      for (let i = 0; i < 60 && c.running; i++) await sleep(500);
    }
    if (!c.running) {
      for (const name of RETIRED) {
        try {
          if (await this.env.APP.getByName(name).retire()) console.log(`${APP.name}: ปิด container ชื่อเก่า ${name} แล้ว`);
        } catch (e) { console.error(`${APP.name}: ปิด container ชื่อเก่า ${name} ไม่สำเร็จ — ${e?.message ?? e}`); }
      }
      c.start({ enableInternet: true, env: this.envForContainer() });   // ต้องออกอินเทอร์เน็ตได้: ฐานข้อมูล Supabase (TCP 5432)
      await this.ctx.storage.put('envHash', want);
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
      return fail(request, 503, `${APP.name} ยังไม่ได้ตั้งค่าบนคลาวด์`, `ยังไม่มีค่า ${missing.join(', ')} — ผู้ดูแลระบบรัน <code>node tools\\cloud\\put-secrets.mjs</code> ที่เครื่องสำนักงาน แล้วลองใหม่`);
    }
    if (!this.ready || !this.ctx.container.running) {
      this.starting ??= this.boot().finally(() => { this.starting = undefined; });
      try { await this.starting; } catch (e) {
        console.error(`${APP.name}: เปิดไม่สำเร็จ — ${e?.message ?? e}`);
        return fail(request, 503, `${APP.name} กำลังเปิดหรือมีปัญหา`, 'ระบบกำลังเริ่มทำงาน กรุณารอสักครู่แล้วลองใหม่ (ถ้าเป็นนานเกิน 5 นาที แจ้งผู้ดูแลระบบ)');
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
      return fail(request, 502, `${APP.name} ตอบไม่ได้ชั่วคราว`, 'กรุณาลองใหม่อีกครั้งในไม่กี่วินาที');
    }
  }
}

export default {
  fetch: (request, env) => {
    const gated = gate(request);
    return gated instanceof Response ? gated : instance(env).fetch(gated);
  },
  // ปลุกทุก 5 นาที (wrangler.jsonc triggers.crons) — ให้งานเบื้องหลังของโปรแกรมได้ทำงาน
  scheduled: async (_event, env, ctx) => {
    ctx.waitUntil(instance(env).fetch(new Request(`https://cron.internal${APP.health}`)).then((r) => r.body?.cancel()).catch(() => {}));
  },
};
