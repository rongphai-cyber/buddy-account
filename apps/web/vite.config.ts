import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// รุ่นของโปรแกรม: version.json ที่ราก repo (node tools/version/stamp.mjs) — แสดงที่หน้าเลือกโปรแกรม/เข้าระบบ/ท้ายเมนู
const appVersion = process.env.VITE_APP_VERSION || (() => {
  try { return String(JSON.parse(readFileSync(new URL('../../version.json', import.meta.url), 'utf8')).version ?? 'dev'); } catch { return 'dev'; }
})();

export default defineConfig({
  plugins: [react()],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion) },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4100' } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
