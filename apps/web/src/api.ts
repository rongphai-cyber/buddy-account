/** ตัวเรียก API — ข้อผิดพลาดจาก server เป็นภาษาไทยเสมอ */
export interface ApiIssue { field?: string; line?: number; message: string }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: ApiIssue[]) { super(message); }
}

/** จำนวนคำขอที่ยังไม่ได้คำตอบ — ด่านงานที่ยังไม่บันทึก (unsaved.tsx) ใช้ดูว่าการบันทึกจบแล้วหรือยัง */
export const net = { inflight: 0 };

/**
 * แก้พร้อมกันสองคน (HANDOFF 163): รุ่นของรายการ/ตารางที่เปิดอยู่ (header x-row-version จาก GET) — บันทึก (PUT ที่อยู่เดียวกัน) ส่งกลับใน x-if-version
 * ระหว่างมีงานที่ยังไม่บันทึก GET ซ้ำไม่เปลี่ยนรุ่นที่จำไว้ (รุ่นต้องตรงกับข้อมูลที่ผู้ใช้กำลังแก้) · บันทึกสำเร็จ = รุ่นใหม่จากคำตอบ
 */
const versions = new Map<string, string>();
let editing = () => false;
/** unsaved.tsx บอกว่ามีงานค้าง (ไม่ import กลับกันวน) */
export function setEditingProbe(fn: () => boolean) { editing = fn; }
/** ลืมรุ่นที่จำไว้ (เปิดฉบับล่าสุด) */
export function forgetVersion(url?: string) { if (url) versions.delete(url); else versions.clear(); }
async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  net.inflight++;
  try { return await callInner<T>(method, url, body); } finally { net.inflight--; }
}
async function callInner<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const ver = method === 'PUT' ? versions.get(url) : undefined;
    res = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(ver ? { 'x-if-version': ver } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // เน็ตหลุด / ด่านยืนยันตัวตนบนคลาวด์หมดอายุ (ถูกส่งไปหน้าอื่น) — ไม่โชว์ "Failed to fetch"
    throw new ApiError(0, 'NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจอินเทอร์เน็ต แล้วกด F5 (ถ้าเปิดหน้านี้ค้างไว้นาน ระบบอาจให้ยืนยันอีเมลใหม่)');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch {
    // ได้หน้าเว็บแทนข้อมูล = ระบบบนคลาวด์กำลังเริ่มทำงาน/อัปเดต — ไม่โชว์ "Unexpected token '<'"
    throw new ApiError(res.status, 'NOT_READY', `ระบบกำลังเริ่มทำงานหรืออัปเดต — รอสักครู่แล้วกด F5 (${res.status})`);
  }
  const rv = res.headers.get('x-row-version');
  if (res.ok && rv && (method === 'PUT' || !(versions.has(url) && editing()))) versions.set(url, rv);
  if (!res.ok) {
    const e = data?.error ?? {};
    // คนอื่นบันทึกไปก่อน — หน้าต่างให้เลือกเปิดฉบับล่าสุด หรือกลับไปแก้ต่อ (unsaved.tsx ConflictHost)
    if (res.status === 409 && e.code === 'VERSION_CONFLICT') window.dispatchEvent(new CustomEvent('buddy:conflict', { detail: { url, message: e.message } }));
    if (res.status === 401 && !url.includes('/auth/login')) window.dispatchEvent(new CustomEvent('buddy:unauthorized', { detail: { code: e.code } }));
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `เกิดข้อผิดพลาด (${res.status})`, e.issues);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string, params?: Record<string, string | number | boolean | null | undefined>) => {
    const q = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
    return call<T>('GET', q ? `${url}?${q}` : url);
  },
  post: <T>(url: string, body?: unknown) => call<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => call<T>('PUT', url, body ?? {}),
  del: <T>(url: string) => call<T>('DELETE', url),
};

/* ---------------------------------------------------------------- ชนิดข้อมูลที่ใช้บ่อย */
export interface Me {
  user: { id: string; username: string; display_name: string; is_admin: boolean; is_platform: boolean; tenant_id: string | null; approval_level: number; check_rights: boolean; mfa_setup_required?: boolean;
    /** โปรแกรมที่เปิดได้ (null = ทุกโปรแกรมของลูกค้า) · hub_only = ไม่มีสิทธิ์ Buddy → เห็นเฉพาะหน้าเปิดโปรแกรม */
    apps?: string[] | null; hub_only?: boolean };
  company: { id: string; code: string; name_th: string; name_en: string | null; year_system: 'B' | 'C' } | null;
  branch: { id: string; code: string; name: string; tax_branch_no: string } | null;
  branches: Array<{ id: string; code: string; name: string; tax_branch_no: string; is_head_office: boolean }>;
  companies: Array<{ id: string; code: string; name_th: string; year_system: 'B' | 'C' }>;
  work_date: string | null;
  /** ธีมของบริษัทที่เลือกอยู่ (ชุดสี + แบบอักษร) */
  ui_theme?: import('@buddy/core').UiTheme;
  /** สิทธิ์รายเมนูของบริษัทปัจจุบัน: true = ใช้ได้, 'S' = พิมพ์ออกจอเท่านั้น, false = ไม่มีสิทธิ์ */
  perms: Record<string, Record<PermAction, boolean | 'S'>>;
}
export type PermAction = 'read' | 'add' | 'edit' | 'cancel' | 'delete' | 'print' | 'approve';
export interface Account {
  id: string; account_no: string; name_th: string; name_en: string | null; parent_id: string | null; parent_no: string | null; level: number;
  account_group: string; is_control: boolean; normal_side: string; use_department: boolean; status: string; line_count: number; has_children: boolean; balance?: string;
}
export interface Department { id: string; code: string; name_th: string; name_en: string | null; short_name_th: string | null; short_name_en: string | null; status: string }
export interface Book { id: string; code: string; prefix: string; name_th: string; name_en: string | null; journal_count: number; template_id: string | null; template_code: string | null; approve_level?: number; approve_method?: string | null; reprint_level?: number | null }
export interface Template { id: string; code: string; name: string; name_en: string | null; line_count: number; book_codes: string | null }
export interface TemplateDetail { id: string; code: string; name: string; name_en: string | null; lines: Array<{ line_no: number; account_id: string | null; account_no: string | null; account_name: string | null; department_id: string | null; department_code: string | null; description: string | null; side: 'D' | 'C'; amount: string | null }> }
export interface FiscalYear { id: string; code: string; start_date: string; end_date: string; status: string; journal_count: number; periods: Array<{ id: string; period_no: number; start_date: string; end_date: string; is_locked: boolean; locked_at: string | null; locked_by_name: string | null }> }
