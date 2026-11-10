/**
 * รุ่นของโปรแกรม (version.json ที่ราก repo — ตั้งด้วย node tools/version/stamp.mjs) · ใส่ตอน build ด้วย vite define
 * ไม่มี (เช่น ทดสอบ) = "dev"
 */
const built: unknown = import.meta.env.VITE_APP_VERSION;

export const APP_VERSION: string = typeof built === 'string' && built ? built : 'dev';
