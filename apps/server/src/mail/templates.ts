import { formatDate, formatDateEn, RETENTION_TERMS, RETENTION_TERMS_EN } from '@buddy/core';
import { esc } from './index.js';

/**
 * อีเมลเรื่องใบสมัคร (HANDOFF 187) — HTML + ข้อความล้วน
 * สองภาษา (HANDOFF 188 เจ้าของ "ขอเพิ่ม ภาษาอังกฤษด้วย"): ไทยก่อน แล้วเส้นคั่น "English" ตามด้วยภาษาอังกฤษ ในฉบับเดียวกัน · หัวเรื่อง "ไทย / English"
 * ข้อมูลที่ผู้ใช้กรอก (ชื่อกิจการ ชื่อคน เหตุผล) ไม่แปล · วันที่ส่วนอังกฤษแบบ formatDateEn (25 Dec 2026)
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
/** เนื้อหาหนึ่งภาษา: หัวข้อ · ส่วน HTML · ข้อความล้วน */
type Part = { title: string; html: string[]; text: string };
const whenTh = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
/** เวลาแบบอังกฤษ "25 Nov 2026, 11:25" (เวลาไทย) — รูปวันที่เดียวกับ formatDateEn */
const whenEn = (iso: string) => {
  const ymd = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const hm = new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' });
  return `${formatDateEn(ymd)}, ${hm} (Bangkok time)`;
};

const FOOT_TH = 'อีเมลนี้ส่งอัตโนมัติจาก Buddy Account (WTS Solutions) — ตอบกลับอีเมลนี้เพื่อติดต่อผู้ให้บริการ';
const FOOT_EN = 'This email was sent automatically by Buddy Account (WTS Solutions). Reply to this email to contact the service provider.';
const TEXT_DIVIDER = '\n\n──────────── English ────────────\n\n';

/** โครงอีเมล: หัว Buddy Account · ไทย · เส้นคั่น English · อังกฤษ · ท้าย (สองภาษา) */
function layout(th: Part, en: Part): string {
  const card = (part: Part, lang: string) => `<div lang="${lang}" style="background:#fff;border:1px solid #e3def2;border-radius:12px;padding:20px 22px;line-height:1.6;font-size:15px">`
    + `<h1 style="font-size:18px;margin:0 0 12px">${esc(part.title)}</h1>${part.html.join('')}</div>`;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(th.title)} / ${esc(en.title)}</title></head>`
    + `<body style="margin:0;background:#f4f2fa;font-family:'Sarabun','Leelawadee UI',Tahoma,sans-serif;color:#1f2440">`
    + `<div style="max-width:560px;margin:0 auto;padding:24px 16px">`
    + `<div style="font-size:20px;font-weight:700;color:#5b3fb3;margin-bottom:2px">Buddy Account</div>`
    + `<div lang="en" style="font-size:12px;color:#7a7f99;margin-bottom:12px">English version below ↓</div>`
    + card(th, 'th')
    // เส้นคั่นเป็นตาราง (โปรแกรมอีเมลบางตัวไม่รองรับ flex)
    + `<table lang="en" role="presentation" width="100%" style="border-collapse:collapse;margin:22px 0 14px"><tr>`
    + `<td style="border-top:1px solid #cfc6ea;width:45%"></td><td style="padding:0 12px;white-space:nowrap;color:#5b3fb3;font-size:13px;font-weight:700;letter-spacing:.08em;line-height:1">ENGLISH</td><td style="border-top:1px solid #cfc6ea;width:45%"></td>`
    + `</tr></table>`
    + card(en, 'en')
    + `<p style="font-size:12px;color:#7a7f99;margin:14px 4px">${esc(FOOT_TH)}<br><span lang="en">${esc(FOOT_EN)}</span></p>`
    + `</div></body></html>`;
}
/** ข้อความล้วน: ไทย · เส้นคั่น English · อังกฤษ · ท้าย */
const bilingualText = (th: Part, en: Part) => `(English below)\n\n${th.text}${TEXT_DIVIDER}${en.text}\n\n--\n${FOOT_TH}\n${FOOT_EN}`;

const p = (html: string) => `<p style="margin:0 0 10px">${html}</p>`;
const table = (rows: Array<[string, string]>) => `<table style="border-collapse:collapse;margin:4px 0 12px;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#6b6f8a;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:3px 0;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>`;
const button = (href: string, label: string) => `<p style="margin:14px 0"><a href="${esc(href)}" style="display:inline-block;background:#6f55c9;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${esc(label)}</a></p>`;
const list = (items: readonly string[], ordered = false) => `<${ordered ? 'ol' : 'ul'} style="margin:4px 0 12px;padding-left:22px">${items.map((x) => `<li style="margin:3px 0">${esc(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
const textList = (items: readonly string[], ordered = false) => items.map((x, i) => `${ordered ? `${i + 1}.` : '-'} ${x}`).join('\n');
const textRows = (rows: Array<[string, string]>) => rows.map(([k, v]) => `${k}: ${v}`).join('\n');

export function renderSignupMail(kind: SignupMailKind, d: SignupMailData): Mail {
  const home = `${d.base}/`;
  if (kind === 'SIGNUP_NOTIFY') {
    const link = `${d.base}/admin/tenants`;
    const rowsTh: Array<[string, string]> = [['กิจการ', d.business_name], ['ผู้ติดต่อ', d.contact_name], ['อีเมล', d.contact_email], ['โทรศัพท์', d.contact_phone],
      ['เลขผู้เสียภาษี', d.tax_id ?? '—'], ['รหัสผู้ใช้ที่ขอ', d.username], ['เวลาที่สมัคร', whenTh(d.created_at)]];
    const rowsEn: Array<[string, string]> = [['Business', d.business_name], ['Contact', d.contact_name], ['Email', d.contact_email], ['Phone', d.contact_phone],
      ['Tax ID', d.tax_id ?? '—'], ['Requested username', d.username], ['Applied at', whenEn(d.created_at)]];
    const th: Part = { title: 'มีผู้สมัครใช้บริการใหม่', html: [table(rowsTh), p('ตรวจสอบและอนุมัติที่หน้า ลูกค้าผู้ใช้บริการ › ใบสมัครใช้งาน'), button(link, 'เปิดหน้าอนุมัติใบสมัคร')],
      text: `มีผู้สมัครใช้บริการใหม่\n\n${textRows(rowsTh)}\n\nตรวจสอบและอนุมัติ: ${link}` };
    const en: Part = { title: 'New service application', html: [table(rowsEn), p('Review and approve it at Tenant › Sign-up Applications.'), button(link, 'Open the approval page')],
      text: `New service application\n\n${textRows(rowsEn)}\n\nReview and approve: ${link}` };
    return { subject: `มีผู้สมัครใหม่ / New application: ${d.business_name}`, html: layout(th, en), text: bilingualText(th, en) };
  }
  if (kind === 'SIGNUP_RECEIVED') {
    const nextTh = ['ผู้ให้บริการตรวจสอบใบสมัคร — โดยปกติภายใน 1 วันทำการ', 'เมื่ออนุมัติแล้วจะได้รับอีเมลแจ้ง พร้อมลิงก์และวิธีเข้าระบบครั้งแรก', `เข้าระบบด้วยรหัสผู้ใช้ ${d.username} และรหัสผ่านที่ตั้งไว้ตอนสมัคร`];
    const nextEn = ['The service provider reviews your application, usually within 1 business day.', 'Once it is approved, you will get an email with the sign-in link and first sign-in steps.', `Then sign in with the username ${d.username} and the password you chose when applying.`];
    const notMeTh = 'ถ้าไม่ได้สมัครด้วยตนเอง ไม่ต้องทำอะไร — ใบสมัครจะไม่ได้รับอนุมัติ';
    const notMeEn = 'If you did not apply, you can ignore this email; the application will not be approved.';
    const th: Part = { title: 'ได้รับใบสมัครแล้ว — รอผู้ให้บริการอนุมัติ',
      html: [p(`เรียน คุณ${esc(d.contact_name)}`), p(`ขอบคุณที่สมัครใช้ Buddy Account สำหรับ <b>${esc(d.business_name)}</b>`), p('<b>ขั้นตอนถัดไป</b>'), list(nextTh, true), p(notMeTh)],
      text: `เรียน คุณ${d.contact_name}\n\nขอบคุณที่สมัครใช้ Buddy Account สำหรับ ${d.business_name}\n\nขั้นตอนถัดไป\n${textList(nextTh, true)}\n\n${notMeTh}` };
    const en: Part = { title: 'Application received — awaiting approval',
      html: [p(`Dear ${esc(d.contact_name)},`), p(`Thank you for applying for Buddy Account for <b>${esc(d.business_name)}</b>.`), p('<b>What happens next</b>'), list(nextEn, true), p(esc(notMeEn))],
      text: `Dear ${d.contact_name},\n\nThank you for applying for Buddy Account for ${d.business_name}.\n\nWhat happens next\n${textList(nextEn, true)}\n\n${notMeEn}` };
    return { subject: 'ได้รับใบสมัครแล้ว / Application received — Buddy Account', html: layout(th, en), text: bilingualText(th, en) };
  }
  if (kind === 'SIGNUP_APPROVED') {
    const stepsTh = [`เปิด ${home} แล้วเข้าระบบด้วยรหัสผู้ใช้ ${d.username} และรหัสผ่านที่ตั้งไว้ตอนสมัคร`, 'ติดตั้งแอป Google Authenticator หรือ Microsoft Authenticator ในมือถือ (ฟรี)',
      'สแกน QR code ที่หน้าจอด้วยแอป แล้วป้อนรหัส 6 หลักจากแอป (ยืนยันตัวตนสองขั้น — บังคับทุกผู้ใช้)', 'เก็บรหัสสำรอง 10 ชุดไว้ในที่ปลอดภัย (ใช้แทนมือถือเมื่อมือถือหาย)'];
    const stepsEn = [`Open ${home} and sign in with the username ${d.username} and the password you chose when applying.`, 'Install an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator (free).',
      'Scan the QR code on the screen with the app, then enter the 6-digit code it shows. Two-factor authentication (2FA) is required for every user.', 'Keep the 10 backup codes somewhere safe. They let you sign in if you lose your phone.'];
    const rowsTh: Array<[string, string]> = [['กิจการ', d.business_name], ['รหัสผู้ใช้', d.username], ...(d.expires_on ? [['ทดลองใช้ถึง', formatDate(d.expires_on, 'B')] as [string, string]] : [])];
    const rowsEn: Array<[string, string]> = [['Business', d.business_name], ['Username', d.username], ...(d.expires_on ? [['Trial until', formatDateEn(d.expires_on)] as [string, string]] : [])];
    const inviteTh = 'เพิ่มพนักงาน: เริ่มระบบ › ผู้ใช้งานและสิทธิ์ › เพิ่มผู้ใช้ › "ให้ผู้ใช้ตั้งรหัสผ่านเองจากลิงก์เชิญ" แล้วส่งลิงก์ให้พนักงานทาง LINE';
    const inviteEn = 'To add staff: Setup › Users and Permissions › Add User. Leave "the user sets their own password from an invite link" selected, then send the invite link to the staff member (for example by LINE).';
    const th: Part = { title: 'อนุมัติใบสมัครแล้ว — เริ่มใช้งานได้เลย',
      html: [p(`เรียน คุณ${esc(d.contact_name)}`), table(rowsTh), button(home, 'เข้า Buddy Account'), p('<b>เข้าระบบครั้งแรก</b>'), list(stepsTh, true), p(esc(inviteTh)),
        p('<b>การเก็บข้อมูลเมื่อค้างชำระหรือเลิกใช้บริการ</b>'), list(RETENTION_TERMS)],
      text: `เรียน คุณ${d.contact_name}\n\n${textRows(rowsTh)}\nเข้าใช้งาน: ${home}\n\nเข้าระบบครั้งแรก\n${textList(stepsTh, true)}\n\n${inviteTh}\n\nการเก็บข้อมูลเมื่อค้างชำระหรือเลิกใช้บริการ\n${textList(RETENTION_TERMS)}` };
    const en: Part = { title: 'Application approved — you can start now',
      html: [p(`Dear ${esc(d.contact_name)},`), table(rowsEn), button(home, 'Open Buddy Account'), p('<b>Your first sign-in</b>'), list(stepsEn, true), p(esc(inviteEn)),
        p('<b>Data retention if unpaid or after the service ends</b>'), list(RETENTION_TERMS_EN)],
      text: `Dear ${d.contact_name},\n\n${textRows(rowsEn)}\nSign in at: ${home}\n\nYour first sign-in\n${textList(stepsEn, true)}\n\n${inviteEn}\n\nData retention if unpaid or after the service ends\n${textList(RETENTION_TERMS_EN)}` };
    return { subject: 'อนุมัติแล้ว / Approved — start using Buddy Account', html: layout(th, en), text: bilingualText(th, en) };
  }
  const reason = d.reject_reason?.trim();
  const th: Part = { title: 'ผลการพิจารณาใบสมัคร',
    html: [p(`เรียน คุณ${esc(d.contact_name)}`), p(`ขอบคุณที่สนใจ Buddy Account สำหรับ <b>${esc(d.business_name)}</b> — ขออภัย ครั้งนี้ยังไม่สามารถอนุมัติใบสมัครได้`),
      ...(reason ? [p(`เหตุผล: ${esc(reason)}`)] : []), p('หากมีข้อสงสัย หรือต้องการสมัครใหม่ ตอบกลับอีเมลนี้เพื่อติดต่อผู้ให้บริการ')],
    text: `เรียน คุณ${d.contact_name}\n\nขอบคุณที่สนใจ Buddy Account สำหรับ ${d.business_name} — ขออภัย ครั้งนี้ยังไม่สามารถอนุมัติใบสมัครได้${reason ? `\nเหตุผล: ${reason}` : ''}\n\nหากมีข้อสงสัย หรือต้องการสมัครใหม่ ตอบกลับอีเมลนี้เพื่อติดต่อผู้ให้บริการ` };
  const en: Part = { title: 'Your application result',
    html: [p(`Dear ${esc(d.contact_name)},`), p(`Thank you for your interest in Buddy Account for <b>${esc(d.business_name)}</b>. We are sorry, but we cannot approve your application at this time.`),
      ...(reason ? [p(`Reason: ${esc(reason)}`)] : []), p('If you have questions or would like to apply again, reply to this email to contact the service provider.')],
    text: `Dear ${d.contact_name},\n\nThank you for your interest in Buddy Account for ${d.business_name}. We are sorry, but we cannot approve your application at this time.${reason ? `\nReason: ${reason}` : ''}\n\nIf you have questions or would like to apply again, reply to this email to contact the service provider.` };
  return { subject: 'ผลการพิจารณาใบสมัคร / Your Buddy Account application', html: layout(th, en), text: bilingualText(th, en) };
}
