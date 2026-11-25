import { formatDate, RETENTION_TERMS } from '@buddy/core';
import { esc } from './index.js';

/**
 * อีเมลเรื่องใบสมัคร (HANDOFF 187) — ภาษาไทย สั้น HTML + ข้อความล้วน
 * ห้ามใส่รหัสผ่าน ความลับ หรือ token ลิงก์เชิญ · ที่อยู่ลิงก์จาก BUDDY_PUBLIC_URL / ค่าตั้ง
 */
export type SignupMailKind = 'SIGNUP_NOTIFY' | 'SIGNUP_RECEIVED' | 'SIGNUP_APPROVED' | 'SIGNUP_REJECTED';
export const SIGNUP_MAIL_KINDS: SignupMailKind[] = ['SIGNUP_NOTIFY', 'SIGNUP_RECEIVED', 'SIGNUP_APPROVED', 'SIGNUP_REJECTED'];
export const SIGNUP_MAIL_LABEL: Record<SignupMailKind, string> = { SIGNUP_NOTIFY: 'แจ้งผู้ให้บริการ', SIGNUP_RECEIVED: 'ได้รับใบสมัคร', SIGNUP_APPROVED: 'อนุมัติแล้ว', SIGNUP_REJECTED: 'ไม่อนุมัติ' };
export interface SignupMailData {
  business_name: string; contact_name: string; contact_email: string; contact_phone: string; tax_id: string | null; username: string;
  created_at: string; reject_reason: string | null; expires_on: string | null; tenant_code: string | null; base: string;
}
type Mail = { subject: string; html: string; text: string };
const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

/** โครงอีเมล: หัว Buddy Account · เนื้อหา · ท้าย */
function layout(title: string, parts: string[]): string {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>`
    + `<body style="margin:0;background:#f4f2fa;font-family:'Sarabun','Leelawadee UI',Tahoma,sans-serif;color:#1f2440">`
    + `<div style="max-width:560px;margin:0 auto;padding:24px 16px">`
    + `<div style="font-size:20px;font-weight:700;color:#5b3fb3;margin-bottom:12px">Buddy Account</div>`
    + `<div style="background:#fff;border:1px solid #e3def2;border-radius:12px;padding:20px 22px;line-height:1.6;font-size:15px">`
    + `<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>${parts.join('')}</div>`
    + `<p style="font-size:12px;color:#7a7f99;margin:14px 4px">อีเมลนี้ส่งอัตโนมัติจาก Buddy Account (WTS Solutions) — ตอบกลับอีเมลนี้เพื่อติดต่อผู้ให้บริการ</p>`
    + `</div></body></html>`;
}
const p = (html: string) => `<p style="margin:0 0 10px">${html}</p>`;
const table = (rows: Array<[string, string]>) => `<table style="border-collapse:collapse;margin:4px 0 12px;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#6b6f8a;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:3px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>`;
const button = (href: string, label: string) => `<p style="margin:14px 0"><a href="${esc(href)}" style="display:inline-block;background:#6f55c9;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${esc(label)}</a></p>`;
const list = (items: string[], ordered = false) => `<${ordered ? 'ol' : 'ul'} style="margin:4px 0 12px;padding-left:22px">${items.map((x) => `<li style="margin:3px 0">${esc(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
const textList = (items: string[], ordered = false) => items.map((x, i) => `${ordered ? `${i + 1}.` : '-'} ${x}`).join('\n');

export function renderSignupMail(kind: SignupMailKind, d: SignupMailData): Mail {
  const home = `${d.base}/`;
  if (kind === 'SIGNUP_NOTIFY') {
    const rows: Array<[string, string]> = [['กิจการ', d.business_name], ['ผู้ติดต่อ', d.contact_name], ['อีเมล', d.contact_email], ['โทรศัพท์', d.contact_phone],
      ['เลขผู้เสียภาษี', d.tax_id ?? '—'], ['รหัสผู้ใช้ที่ขอ', d.username], ['เวลาที่สมัคร', when(d.created_at)]];
    const link = `${d.base}/admin/tenants`;
    return {
      subject: `มีผู้สมัครใช้ Buddy Account: ${d.business_name}`,
      html: layout('มีผู้สมัครใช้บริการใหม่', [table(rows), p('ตรวจสอบและอนุมัติที่หน้า ลูกค้าผู้ใช้บริการ › ใบสมัครใช้งาน'), button(link, 'เปิดหน้าอนุมัติใบสมัคร')]),
      text: `มีผู้สมัครใช้บริการใหม่\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nตรวจสอบและอนุมัติ: ${link}`,
    };
  }
  if (kind === 'SIGNUP_RECEIVED') {
    const next = ['ผู้ให้บริการตรวจสอบใบสมัคร — โดยปกติภายใน 1 วันทำการ', 'เมื่ออนุมัติแล้วจะได้รับอีเมลแจ้ง พร้อมลิงก์และวิธีเข้าระบบครั้งแรก', `เข้าระบบด้วยรหัสผู้ใช้ ${d.username} และรหัสผ่านที่ตั้งไว้ตอนสมัคร`];
    return {
      subject: 'ได้รับใบสมัคร Buddy Account แล้ว — รอผู้ให้บริการอนุมัติ',
      html: layout('ได้รับใบสมัครแล้ว — รอผู้ให้บริการอนุมัติ', [p(`เรียน คุณ${esc(d.contact_name)}`), p(`ขอบคุณที่สมัครใช้ Buddy Account สำหรับ <b>${esc(d.business_name)}</b>`), p('<b>ขั้นตอนถัดไป</b>'), list(next, true),
        p('ถ้าไม่ได้สมัครด้วยตนเอง ไม่ต้องทำอะไร — ใบสมัครจะไม่ได้รับอนุมัติ')]),
      text: `เรียน คุณ${d.contact_name}\n\nขอบคุณที่สมัครใช้ Buddy Account สำหรับ ${d.business_name}\n\nขั้นตอนถัดไป\n${textList(next, true)}\n\nถ้าไม่ได้สมัครด้วยตนเอง ไม่ต้องทำอะไร — ใบสมัครจะไม่ได้รับอนุมัติ`,
    };
  }
  if (kind === 'SIGNUP_APPROVED') {
    const steps = [`เปิด ${home} แล้วเข้าระบบด้วยรหัสผู้ใช้ ${d.username} และรหัสผ่านที่ตั้งไว้ตอนสมัคร`, 'ติดตั้งแอป Google Authenticator หรือ Microsoft Authenticator ในมือถือ (ฟรี)',
      'สแกน QR code ที่หน้าจอด้วยแอป แล้วป้อนรหัส 6 หลักจากแอป (ยืนยันตัวตนสองขั้น — บังคับทุกผู้ใช้)', 'เก็บรหัสสำรอง 10 ชุดไว้ในที่ปลอดภัย (ใช้แทนมือถือเมื่อมือถือหาย)'];
    const rows: Array<[string, string]> = [['กิจการ', d.business_name], ['รหัสผู้ใช้', d.username], ...(d.expires_on ? [['ทดลองใช้ถึง', formatDate(d.expires_on, 'B')] as [string, string]] : [])];
    const invite = 'เพิ่มพนักงาน: เริ่มระบบ › ผู้ใช้งานและสิทธิ์ › เพิ่มผู้ใช้ › "ให้ผู้ใช้ตั้งรหัสผ่านเองจากลิงก์เชิญ" แล้วส่งลิงก์ให้พนักงานทาง LINE';
    return {
      subject: 'อนุมัติแล้ว — เริ่มใช้ Buddy Account ได้เลย',
      html: layout('อนุมัติใบสมัครแล้ว — เริ่มใช้งานได้เลย', [p(`เรียน คุณ${esc(d.contact_name)}`), table(rows), button(home, 'เข้า Buddy Account'), p('<b>เข้าระบบครั้งแรก</b>'), list(steps, true), p(esc(invite)),
        p('<b>การเก็บข้อมูลเมื่อค้างชำระหรือเลิกใช้บริการ</b>'), list([...RETENTION_TERMS])]),
      text: `เรียน คุณ${d.contact_name}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\nเข้าใช้งาน: ${home}\n\nเข้าระบบครั้งแรก\n${textList(steps, true)}\n\n${invite}\n\nการเก็บข้อมูลเมื่อค้างชำระหรือเลิกใช้บริการ\n${textList([...RETENTION_TERMS])}`,
    };
  }
  const reason = d.reject_reason?.trim();
  return {
    subject: 'ผลการพิจารณาใบสมัคร Buddy Account',
    html: layout('ผลการพิจารณาใบสมัคร', [p(`เรียน คุณ${esc(d.contact_name)}`), p(`ขอบคุณที่สนใจ Buddy Account สำหรับ <b>${esc(d.business_name)}</b> — ขออภัย ครั้งนี้ยังไม่สามารถอนุมัติใบสมัครได้`),
      ...(reason ? [p(`เหตุผล: ${esc(reason)}`)] : []), p('หากมีข้อสงสัย หรือต้องการสมัครใหม่ ตอบกลับอีเมลนี้เพื่อติดต่อผู้ให้บริการ')]),
    text: `เรียน คุณ${d.contact_name}\n\nขอบคุณที่สนใจ Buddy Account สำหรับ ${d.business_name} — ขออภัย ครั้งนี้ยังไม่สามารถอนุมัติใบสมัครได้${reason ? `\nเหตุผล: ${reason}` : ''}\n\nหากมีข้อสงสัย หรือต้องการสมัครใหม่ ตอบกลับอีเมลนี้เพื่อติดต่อผู้ให้บริการ`,
  };
}
