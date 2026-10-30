import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db.js';
import { numbering, syncCtx } from '../../sync-context.js';
import { replayDocNo, syncCentralRoutes } from './central.js';
import { branchDocNo, loadBranchState, startSyncLoop, stopSyncLoop, syncBranchRoutes } from './branch.js';

/** T7.8 ออฟไลน์สาขา: ลงทะเบียน API ทั้งสองฝั่ง + การออกเลขที่ (สำนักงานใหญ่ตอนรับเอกสารจากสาขา / เครื่องสาขา) + รอบซิงก์ */
export async function syncRoutes(app: FastifyInstance, database: Database) {
  numbering.hook = async (tx, companyId, docTypeId) => {
    const r = syncCtx.getStore()?.replay;
    if (r?.docNo) return replayDocNo(tx, companyId, docTypeId, r.deviceId, r.docNo);
    const b = syncCtx.getStore()?.branch;
    return b ? branchDocNo(tx, companyId, docTypeId, b) : null;
  };
  syncCentralRoutes(app, database.db);
  syncBranchRoutes(app, database);
  await loadBranchState(database);
  startSyncLoop(database);
  app.addHook('onClose', async () => stopSyncLoop(database));
}
