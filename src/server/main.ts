import { createApp, listen } from './app.ts';
import { loadConfig } from './config.ts';
import { databaseHealth, maintainOperationalData, openDatabase } from './db/database.ts';

const config = loadConfig();
const database = openDatabase(config.databasePath);
maintainOperationalData(database);
const maintenanceTimer = setInterval(() => {
  try {
    maintainOperationalData(database);
  } catch (error) {
    console.error('Periodic database maintenance failed:', error);
  }
}, 6 * 60 * 60_000);
maintenanceTimer.unref();
const health = databaseHealth(database);
const server = createApp(database, config);

await listen(server, config.host, config.port);
console.log(`VIB Abdo Company API: http://${config.host}:${config.port}`);
console.log(`Database integrity: ${health.integrity}; schema: ${health.schemaVersion}`);

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(maintenanceTimer);
  console.log(`Stopping local server (${signal})...`);
  // SSE connections are intentionally long-lived; end them before asking the
  // HTTP server to drain, otherwise a Windows service restart can hang.
  server.closeRealtimeConnections();
  const forceClose = setTimeout(() => server.closeAllConnections(), 5_000);
  forceClose.unref();
  server.close(() => {
    clearTimeout(forceClose);
    database.close();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
