// ตัวเฝ้าระบบบนคลาวด์ wts-watch (HANDOFF ข้อ 121) — Worker แยกจากโปรแกรม ไม่มี container
// cron ทุกนาที: ตรวจ health ของ Buddy / WTS-POS / WTS-Living ผ่านชื่อเว็บสาธารณะ → ล่มติดกัน 5 นาที = ส่งอีเมลหาเจ้าของ
// ตรรกะอยู่ที่ logic.ts (ทดสอบ apps/server/test/watch.test.ts) · ตั้งค่า cloud/watch/wrangler.jsonc · วิธีใช้ tools/cloud/README.md ข้อ "ตัวเฝ้าระบบ"
// ส่งอีเมลด้วย Cloudflare Email Routing (send_email) — ส่งได้เฉพาะอีเมลปลายทางที่ยืนยันแล้วใน Email Routing ของ worktruesolution.net
// ความลับ ALERT_TO = อีเมลเจ้าของ (ไม่อยู่ใน repo): npx wrangler secret put ALERT_TO -c cloud/watch/wrangler.jsonc
import { DurableObject } from 'cloudflare:workers';
import { EmailMessage } from 'cloudflare:email';
import { CHECKS, TIMEOUT_MS, alertMail, emptyState, failDetail, mime, queue, readHealth, resetStats, step, summaryMail } from './logic.ts';

const WEEKLY = '0 1 * * 1'; // จันทร์ 08:00 เวลาไทย (ต้องตรงกับ wrangler.jsonc)

async function probe(check) {
  const t0 = Date.now();
  try {
    const res = await fetch(check.url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'wts-watch', 'cache-control': 'no-cache' } });
    return await readHealth(res, Date.now() - t0);
  } catch (e) {
    return { ok: false, detail: failDetail(e), ms: Date.now() - t0 };
  }
}

/** สถานะเก็บใน Durable Object ตัวเดียว (ทำงานทีละรอบ ไม่ซ้อนกัน) */
export class WatchState extends DurableObject {
  async run(cron) {
    const now = Date.now();
    const state = (await this.ctx.storage.get('state')) ?? emptyState(now);
    const alerts = [];
    if (cron === WEEKLY) {
      // cron ทุกนาทีทำงานในนาทีเดียวกันอยู่แล้ว — รอบนี้สรุปจากผลตรวจล่าสุด ไม่ตรวจซ้ำ (ไม่นับล้มสองครั้งในนาทีเดียว)
      queue(state, summaryMail(state, state.last ?? {}, now, false));
      resetStats(state, now);
    } else {
      const results = {};
      await Promise.all(CHECKS.map(async (c) => { results[c.key] = await probe(c); }));
      for (const c of CHECKS) {
        const { next, alert } = step(state.apps[c.key], c, results[c.key], now);
        state.apps[c.key] = next;
        if (alert) alerts.push(alert);
        if (!results[c.key].ok) console.warn(`${c.name}: ${results[c.key].detail} (ล้มติดกัน ${next.fails} ครั้ง)`);
      }
      state.last = results;
      queue(state, alertMail(alerts, now));
      if (!state.started) { queue(state, summaryMail(state, results, now, true)); state.started = true; }
    }

    while (state.outbox.length) {
      try { await this.send(state.outbox[0], now); state.outbox.shift(); } catch (e) {
        console.error(`ส่งอีเมลไม่สำเร็จ (ค้าง ${state.outbox.length} ฉบับ ส่งใหม่รอบหน้า) — ${e?.message ?? e}`);
        break;
      }
    }
    await this.ctx.storage.put('state', state);
    return { alerts: alerts.length, outbox: state.outbox.length };
  }

  async send(mail, now) {
    const to = this.env.ALERT_TO;
    const from = this.env.ALERT_FROM;
    if (!to) throw new Error('ยังไม่ได้ตั้ง ALERT_TO — npx wrangler secret put ALERT_TO -c cloud/watch/wrangler.jsonc');
    const raw = mime(from, 'WTS แจ้งเตือน', to, mail, now, crypto.randomUUID());
    await this.env.MAIL.send(new EmailMessage(from, to, raw));
    console.log(`ส่งอีเมลแล้ว: ${mail.subject}`);
  }
}

export default {
  fetch: () => new Response('not found', { status: 404 }),
  scheduled: async (event, env, ctx) => {
    ctx.waitUntil(env.STATE.getByName('main').run(event.cron).catch((e) => console.error(`ตัวเฝ้าระบบล้ม — ${e?.message ?? e}`)));
  },
};
