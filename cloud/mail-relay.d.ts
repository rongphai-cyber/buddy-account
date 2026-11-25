// ชนิดของ cloud/mail-relay.js (HANDOFF 187) — ให้ชุดทดสอบ TypeScript ของ server เรียกได้
export declare const MAIL_PATH: string;
export declare function mailRelay(request: Request, env: { BUDDY_SECRET_KEY?: string; MAIL_FROM_DOMAIN?: string; EMAIL?: { send(m: Record<string, unknown>): Promise<{ messageId: string }> } }, now?: number): Promise<Response>;
