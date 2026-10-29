/** ตัวเรียก API — ข้อผิดพลาดจาก server เป็นภาษาไทยเสมอ */
export interface ApiIssue { field?: string; line?: number; message: string }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: ApiIssue[]) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = data?.error ?? {};
    if (res.status === 401 && !url.includes('/auth/login')) window.dispatchEvent(new CustomEvent('buddy:unauthorized'));
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
  user: { id: string; username: string; display_name: string; is_admin: boolean; is_platform: boolean; tenant_id: string | null; approval_level: number; check_rights: boolean; mfa_setup_required?: boolean };
  company: { id: string; code: string; name_th: string; name_en: string | null; year_system: 'B' | 'C' } | null;
  branch: { id: string; code: string; name: string; tax_branch_no: string } | null;
  branches: Array<{ id: string; code: string; name: string; tax_branch_no: string; is_head_office: boolean }>;
  companies: Array<{ id: string; code: string; name_th: string; year_system: 'B' | 'C' }>;
  work_date: string | null;
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
