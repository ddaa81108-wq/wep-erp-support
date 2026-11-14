import { existsSync } from 'node:fs';
import { backup, DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/server/config.ts';
import { rollbackMobilePushShade } from '../src/server/db/migrationsMobilePush.ts';

const path = loadConfig().databasePath;
if (!path || path === ':memory:' || !existsSync(path)) {
  console.error('لم يُعثر على ملف القاعدة. أوقف الخادم ثم عيّن ABDO_DB_PATH كما يعمل به الخادم.');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = `${path}.before-shade-rollback-${stamp}`;
const db = new DatabaseSync(path, { timeout: 5_000 });
db.exec('PRAGMA busy_timeout = 5000;');
try {
  await backup(db, backupPath);
  console.log(`نُسخت القاعدة قبل التراجع: ${backupPath}`);
  const result = rollbackMobilePushShade(db);
  if (result.status === 'already') {
    console.log('القاعدة أصلًا بلا إصدار 60. لا حاجة للتراجع. أعد نشر النسخة السابقة ثم شغّل الخادم.');
  } else if (result.droppedColumn) {
    console.log(
      `تم حذف عمود القدرة وإصدار 60 (SQLite ${result.sqliteVersion}). أوقف الخادم إن كان يعمل، انشر النسخة السابقة، ثم شغّله.`,
    );
  } else {
    console.log(
      `تم حذف صف الإصدار 60 وبقي العمود لأن SQLite ${result.sqliteVersion} لا يدعم حذفه. النسخة السابقة تقبل العمود الزائد. انشرها ثم شغّل الخادم.`,
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('not the latest')) {
    console.error('التراجع مرفوض: الإصدار 60 ليس آخر إصدار مطبّق. لم تُغيّر القاعدة.');
  } else if (message.includes('busy') || message.includes('locked')) {
    console.error('القاعدة مقفلة. أوقف الخادم ثم أعد تشغيل هذا الأمر.');
  } else {
    console.error(`تعذر التراجع. النسخة المحفوظة ما زالت في: ${backupPath}`);
    console.error(message);
  }
  process.exitCode = 1;
} finally {
  db.close();
}
