import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { createApp, listen } from '../src/server/app.ts';
import type { ServerConfig } from '../src/server/config.ts';
import { databaseHealth, openDatabase } from '../src/server/db/database.ts';

const CARD_COUNT = Number(process.env.LOAD_CARDS ?? 6000);
const OPERATION_COUNT = Number(process.env.LOAD_OPERATIONS ?? 1000);
const PASSWORD = 'Load Test Admin 123!';
const directory = mkdtempSync(join(tmpdir(), 'abdo-erp-load-'));
const databasePath = join(directory, 'load.sqlite');
const database = openDatabase(databasePath);
const config: ServerConfig = {
  host: '127.0.0.1', port: 0, databasePath, sessionHours: 12,
  secureCookie: false, internetRequired: false, internetProbeUrls: [],
  internetProbeTimeoutMs: 100, internetProbeCacheMs: 100,
};
const server = createApp(database, config);

type Timing = { elapsedMs: number; status: number; ok: boolean };
const percentile = (values: number[], ratio: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
};
const summary = (values: number[]) => ({
  count: values.length,
  minMs: Number(Math.min(...values).toFixed(2)),
  medianMs: Number(percentile(values, .5).toFixed(2)),
  p95Ms: Number(percentile(values, .95).toFixed(2)),
  p99Ms: Number(percentile(values, .99).toFixed(2)),
  maxMs: Number(Math.max(...values).toFixed(2)),
  averageMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
});

let base = '';
let cookie = '';
let csrf = '';
const request = async (path: string, init: RequestInit = {}): Promise<{ timing: Timing; body: any }> => {
  const started = performance.now();
  const headers = new Headers(init.headers);
  headers.set('x-client-api-version', '1');
  if (cookie) headers.set('cookie', cookie);
  if (csrf && init.method && init.method !== 'GET') headers.set('x-csrf-token', csrf);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const text = await response.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 300) }; }
  return { timing: { elapsedMs: performance.now() - started, status: response.status, ok: response.ok }, body };
};

const runConcurrentReads = async (concurrency: number) => {
  const heapBefore = process.memoryUsage().heapUsed;
  const results = await Promise.all(Array.from({ length: concurrency }, () => request('/api/customers')));
  const heapAfter = process.memoryUsage().heapUsed;
  const elapsed = results.map((result) => result.timing.elapsedMs);
  const errors = results.filter((result) => !result.timing.ok).length;
  return {
    concurrency, errors, ...summary(elapsed),
    throughputPerSecond: Number((concurrency / (Math.max(...elapsed) / 1000)).toFixed(2)),
    heapDeltaMb: Number(((heapAfter - heapBefore) / 1024 / 1024).toFixed(2)),
  };
};

const main = async () => {
  await listen(server, config.host, 0);
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;

  const setup = await request('/api/setup/admin', {
    method: 'POST', body: JSON.stringify({ username: 'load-admin', displayName: 'مدير اختبار الضغط', password: PASSWORD }),
  });
  if (setup.timing.status !== 201) throw new Error(`setup failed: ${JSON.stringify(setup.body)}`);
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-client-api-version': '1' },
    body: JSON.stringify({ username: 'load-admin', password: PASSWORD }),
  });
  const loginBody = await login.json() as any;
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  csrf = String(loginBody.data.csrfToken);

  const cardTimes: number[] = [];
  const customerIds: string[] = [];
  const creationStarted = performance.now();
  for (let index = 0; index < CARD_COUNT; index += 1) {
    const result = await request('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        requestId: `load-card-${String(index).padStart(8, '0')}`,
        name: `عميل ضغط ${String(index + 1).padStart(6, '0')}`,
        phone: `2189${String(index).padStart(8, '0')}`,
        openingBalance: 0,
      }),
    });
    if (result.timing.status !== 201) throw new Error(`card ${index} failed: ${JSON.stringify(result.body)}`);
    cardTimes.push(result.timing.elapsedMs);
    customerIds.push(String(result.body.data.customer.id));
  }
  const creationElapsedMs = performance.now() - creationStarted;

  const operationTimes: number[] = [];
  const operationStarted = performance.now();
  for (let index = 0; index < OPERATION_COUNT; index += 1) {
    const result = await request(`/api/customers/${customerIds[index % customerIds.length]}/transactions`, {
      method: 'POST',
      body: JSON.stringify({
        requestId: `load-operation-${String(index).padStart(8, '0')}`,
        expectedVersion: 1,
        type: 'debt',
        inputValue: (index % 900) + 100,
        calculationMode: 'direct',
        date: new Date().toISOString(),
        note: 'عملية اختبار ضغط معزولة',
      }),
    });
    if (result.timing.status !== 201) throw new Error(`operation ${index} failed: ${JSON.stringify(result.body)}`);
    operationTimes.push(result.timing.elapsedMs);
  }
  const operationElapsedMs = performance.now() - operationStarted;

  const concurrentWriteCount = Math.min(100, Math.max(0, CARD_COUNT - OPERATION_COUNT - 1));
  const distinctWriteResults = await Promise.all(Array.from({ length: concurrentWriteCount }, (_, index) =>
    request(`/api/customers/${customerIds[OPERATION_COUNT + index]}/transactions`, {
      method: 'POST',
      body: JSON.stringify({
        requestId: `load-concurrent-distinct-${String(index).padStart(4, '0')}`,
        expectedVersion: 1, type: 'debt', inputValue: 100,
        calculationMode: 'direct', date: new Date().toISOString(),
        note: 'كتابة متزامنة على كروت مستقلة',
      }),
    })));
  const distinctWriteErrors = distinctWriteResults.filter((result) => result.timing.status !== 201);
  if (distinctWriteErrors.length) throw new Error(`${distinctWriteErrors.length} distinct concurrent writes failed`);

  const conflictCustomerId = customerIds[OPERATION_COUNT + concurrentWriteCount];
  const conflictingWriteResults = conflictCustomerId ? await Promise.all(Array.from({ length: 25 }, (_, index) =>
    request(`/api/customers/${conflictCustomerId}/transactions`, {
      method: 'POST',
      body: JSON.stringify({
        requestId: `load-concurrent-conflict-${String(index).padStart(4, '0')}`,
        expectedVersion: 1, type: 'debt', inputValue: 100,
        calculationMode: 'direct', date: new Date().toISOString(),
        note: 'اختبار تعارض الكتابة على نفس الكارت',
      }),
    }))) : [];
  const conflictSuccesses = conflictingWriteResults.filter((result) => result.timing.status === 201).length;
  const conflictRejections = conflictingWriteResults.filter((result) => result.timing.status === 409).length;
  if (conflictingWriteResults.length && (conflictSuccesses !== 1 || conflictRejections !== conflictingWriteResults.length - 1)) {
    throw new Error(`conflict protection failed: ${conflictSuccesses} accepted, ${conflictRejections} rejected`);
  }

  const listSamples: number[] = [];
  for (let index = 0; index < 20; index += 1) listSamples.push((await request('/api/customers')).timing.elapsedMs);

  const pressure: any[] = [];
  let stopReason = 'وصل الاختبار إلى الحد الآمن الأقصى دون انهيار';
  for (const concurrency of [1, 5, 10, 25, 50, 100, 200, 400]) {
    const level = await runConcurrentReads(concurrency);
    pressure.push(level);
    if (level.errors > 0) { stopReason = `ظهرت ${level.errors} أخطاء عند ${concurrency} قراءة متزامنة`; break; }
    if (level.p95Ms > 5000) { stopReason = `تجاوز p95 خمس ثوانٍ عند ${concurrency} قراءة متزامنة`; break; }
    if (process.memoryUsage().rss > 1024 * 1024 * 1024) { stopReason = `تجاوزت ذاكرة العملية 1GB عند ${concurrency} قراءة متزامنة`; break; }
  }

  const counts = Object.fromEntries(['customers', 'customer_cycles', 'debt_transactions', 'audit_log', 'event_log', 'idempotency_keys']
    .map((table) => [table, Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count)]));
  const health = databaseHealth(database);
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const report = {
    generatedAt: new Date().toISOString(), isolatedDatabase: true,
    requested: { cards: CARD_COUNT, financialOperations: OPERATION_COUNT },
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpuCount: (await import('node:os')).cpus().length, totalMemoryGb: Number(((await import('node:os')).totalmem() / 1024 ** 3).toFixed(2)) },
    cards: { totalElapsedMs: Number(creationElapsedMs.toFixed(2)), throughputPerSecond: Number((CARD_COUNT / (creationElapsedMs / 1000)).toFixed(2)), latency: summary(cardTimes) },
    operations: { totalElapsedMs: Number(operationElapsedMs.toFixed(2)), throughputPerSecond: Number((OPERATION_COUNT / (operationElapsedMs / 1000)).toFixed(2)), latency: summary(operationTimes) },
    writePressure: {
      distinctCards: { concurrency: concurrentWriteCount, accepted: concurrentWriteCount, errors: 0 },
      sameCard: { concurrency: conflictingWriteResults.length, accepted: conflictSuccesses, versionConflicts: conflictRejections },
    },
    list500AfterLoad: summary(listSamples), pressure, stopReason,
    database: { ...health, counts, sizeMb: Number((statSync(databasePath).size / 1024 / 1024).toFixed(2)) },
    process: { rssMb: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2)), heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)) },
  };
  const output = resolve('artifacts', 'load-test-6000-cards-1000-operations.json');
  writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, report }, null, 2));
};

try {
  await main();
} finally {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
