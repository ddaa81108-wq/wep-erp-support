import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../src/server/db/database.ts';

const data = workerData as { path: string; id: string };
if (!parentPort) throw new Error('lock worker requires a parent');
const database = openDatabase(data.path);
database.exec('BEGIN IMMEDIATE');
parentPort.postMessage({ ready: true });
setTimeout(() => {
  database.prepare('UPDATE customers SET current_balance_units=0, financial_updated_at=? WHERE id=?')
    .run(new Date().toISOString(), data.id);
  database.exec('COMMIT');
  database.close();
  parentPort?.postMessage({ committed: true });
}, 700);
