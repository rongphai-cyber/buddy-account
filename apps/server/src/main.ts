import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';

const cfg = loadConfig();
if (cfg.dataDir) mkdirSync(cfg.dataDir, { recursive: true });
const database = await openDatabase(cfg);
await migrate(database, cfg.migrationsDir);
const app = await buildApp(database, cfg);
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`Buddy Account พร้อมใช้งานที่ http://localhost:${cfg.port}  (ฐานข้อมูล: ${database.mode === 'pglite' ? `ในเครื่อง ${cfg.dataDir}` : 'PostgreSQL'})`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await app.close(); await database.close(); process.exit(0); });
}
