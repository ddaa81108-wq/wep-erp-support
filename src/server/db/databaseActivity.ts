import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppDatabase } from './database.ts';
import { instrumentDatabase, type Observation } from './databaseInstrumentation.ts';
export type ActivityPoint = {
  at: number;
  reads: number;
  writes: number;
  other: number;
  milliseconds: number;
  operations: number;
  errors: number;
  busy: number;
  slow: number;
  observedMs: number;
};
const blank = (at: number): ActivityPoint => ({
  at,
  reads: 0,
  writes: 0,
  other: 0,
  milliseconds: 0,
  operations: 0,
  errors: 0,
  busy: 0,
  slow: 0,
  observedMs: 0,
});
const round = (time: number, unit: number) => Math.floor(time / unit) * unit;
const dayKey = (time: number) => new Date(time + 7200000).toISOString().slice(0, 10);
export type LiveActivity = {
  startedAt: number;
  checkedAt: number;
  historyAvailable: boolean;
  persistent: boolean;
  droppedMinutes: number;
  slowThresholdMs: number;
  points: ActivityPoint[];
  databaseBytes: number | null;
  walBytes: number | null;
};
export type DailyActivity = {
  day: string;
  hours: Array<ActivityPoint & { databaseBytes: number | null; walBytes: number | null }>;
  available: boolean;
  checkedAt: number;
};
export type ActivityService = {
  live: () => LiveActivity;
  daily: (day: string) => DailyActivity;
  flush: () => void;
  stop: () => void;
};
const services = new WeakMap<AppDatabase, ActivityService>();
export function databaseActivity(db: AppDatabase) {
  return services.get(db);
}
export function startDatabaseActivity(
  db: AppDatabase,
  options: { clock?: () => number; timers?: boolean; historyPath?: string } = {},
): ActivityService {
  const previous = services.get(db);
  if (previous) return previous;
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const runId = randomUUID();
  const source = String(
    db
      .prepare('PRAGMA database_list')
      .all()
      .find((row) => row.name === 'main')?.file ?? '',
  );
  const historyPath = options.historyPath ?? (source ? source + '.activity.sqlite' : ':memory:');
  let history: DatabaseSync | null = null;
  let storageError = false;
  let stopped = false;
  let latestSize: number | null = null;
  let latestWal: number | null = null;
  const minuteSizes = new Map<number, { database: number | null; wal: number | null }>();
  const recent = new Map<number, ActivityPoint>();
  const minutes = new Map<number, ActivityPoint>();
  let previousTime = startedAt;
  let lastFlush = startedAt;
  let droppedMinutes = 0;
  try {
    if (source && resolve(historyPath).toLowerCase() === resolve(source).toLowerCase())
      throw new Error('Metrics must use a separate database');
    history = new DatabaseSync(historyPath, { timeout: 100 });
    history.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
      CREATE TABLE IF NOT EXISTS activity_minutes (
        minute INTEGER NOT NULL, run_id TEXT NOT NULL, reads INTEGER NOT NULL,writes INTEGER NOT NULL,other INTEGER NOT NULL,
        milliseconds REAL NOT NULL,operations INTEGER NOT NULL,errors INTEGER NOT NULL,busy INTEGER NOT NULL,slow INTEGER NOT NULL,observed_ms INTEGER NOT NULL,
        database_bytes INTEGER,wal_bytes INTEGER,PRIMARY KEY(minute,run_id)
      ) STRICT;`);
  } catch {
    storageError = true;
    history?.close();
    history = null;
  }
  function bucket(map: Map<number, ActivityPoint>, at: number) {
    let value = map.get(at);
    if (!value) {
      value = blank(at);
      map.set(at, value);
    }
    return value;
  }
  function advance() {
    const now = clock();
    // A long event-loop pause or clock jump is a gap, never invented idle measurements.
    if (now >= previousTime && now - previousTime <= 10000) {
      let cursor = previousTime;
      while (cursor < now) {
        const until = Math.min(now, round(cursor, 2000) + 2000);
        bucket(recent, round(cursor, 2000)).observedMs += until - cursor;
        bucket(minutes, round(cursor, 60000)).observedMs += until - cursor;
        cursor = until;
      }
    }
    previousTime = now;
    for (const at of recent.keys()) if (at < now - 300000) recent.delete(at);
    for (const at of minutes.keys())
      if (at < now - 86400000) {
        minutes.delete(at);
        minuteSizes.delete(at);
        droppedMinutes++;
      }
  }
  function record(value: Observation) {
    if (stopped) return;
    advance();
    const now = clock();
    for (const point of [bucket(recent, round(now, 2000)), bucket(minutes, round(now, 60000))]) {
      point[value.kind]++;
      point.operations++;
      point.milliseconds += value.milliseconds;
      if (value.failed) point.errors++;
      if (value.busy) point.busy++;
      if (value.milliseconds >= 50) point.slow++;
    }
  }
  const originalClose = db.close;
  const detach = instrumentDatabase(db, record);
  function sampleSizes() {
    if (!source) return;
    try {
      latestSize = statSync(source).size;
    } catch {
      latestSize = null;
    }
    try {
      latestWal = statSync(source + '-wal').size;
    } catch (error) {
      latestWal = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 0 : null;
    }
    minuteSizes.set(round(clock(), 60000), { database: latestSize, wal: latestWal });
  }
  function flush() {
    advance();
    sampleSizes();
    lastFlush = clock();
    if (!history) return;
    try {
      history.exec('BEGIN');
      const save =
        history.prepare(`INSERT INTO activity_minutes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(minute,run_id) DO UPDATE SET
        reads=excluded.reads,writes=excluded.writes,other=excluded.other,milliseconds=excluded.milliseconds,operations=excluded.operations,errors=excluded.errors,busy=excluded.busy,slow=excluded.slow,observed_ms=excluded.observed_ms,database_bytes=excluded.database_bytes,wal_bytes=excluded.wal_bytes`);
      for (const value of minutes.values())
        save.run(
          value.at,
          runId,
          value.reads,
          value.writes,
          value.other,
          value.milliseconds,
          value.operations,
          value.errors,
          value.busy,
          value.slow,
          Math.round(value.observedMs),
          minuteSizes.get(value.at)?.database ?? null,
          minuteSizes.get(value.at)?.wal ?? null,
        );
      history
        .prepare('DELETE FROM activity_minutes WHERE minute<?')
        .run(round(clock(), 60000) - 30 * 86400000);
      history.exec('COMMIT');
      storageError = false;
      for (const at of minutes.keys())
        if (at < round(clock(), 60000)) {
          minutes.delete(at);
          minuteSizes.delete(at);
        }
    } catch {
      try {
        history.exec('ROLLBACK');
      } catch {
        /* preserve workload */
      }
      storageError = true;
    }
  }
  sampleSizes();
  const timer =
    options.timers === false
      ? null
      : setInterval(() => {
          advance();
          if (clock() - lastFlush >= 60000) flush();
        }, 2000);
  timer?.unref();
  const service = {
    live() {
      advance();
      return {
        startedAt,
        checkedAt: clock(),
        historyAvailable: Boolean(history) && !storageError,
        persistent: Boolean(source),
        droppedMinutes,
        slowThresholdMs: 50,
        points: [...recent.values()].sort((a, b) => a.at - b.at).map((point) => ({ ...point })),
        databaseBytes: latestSize,
        walBytes: latestWal,
      };
    },
    daily(day: string) {
      const start = Date.parse(day + 'T00:00:00+02:00');
      const end = start + 86400000;
      const hours = Array.from({ length: 24 }, (_, index) => ({
        ...blank(start + index * 3600000),
        databaseBytes: null as number | null,
        walBytes: null as number | null,
      }));
      if (!history) return { day, hours, available: false, checkedAt: clock() };
      try {
        const stored = history
          .prepare('SELECT * FROM activity_minutes WHERE minute>=? AND minute<? ORDER BY minute,run_id')
          .all(start, end);
        // Overlay this process unflushed totals, replacing its own persisted partial minute.
        const rows = new Map(stored.map((row) => [String(row.minute) + ':' + row.run_id, row]));
        advance();
        for (const point of minutes.values())
          if (point.at >= start && point.at < end)
            rows.set(point.at + ':' + runId, {
              minute: point.at,
              run_id: runId,
              reads: point.reads,
              writes: point.writes,
              other: point.other,
              milliseconds: point.milliseconds,
              operations: point.operations,
              errors: point.errors,
              busy: point.busy,
              slow: point.slow,
              observed_ms: point.observedMs,
              database_bytes: minuteSizes.get(point.at)?.database ?? null,
              wal_bytes: minuteSizes.get(point.at)?.wal ?? null,
            });
        for (const row of [...rows.values()].sort((a, b) => Number(a.minute) - Number(b.minute))) {
          const hour = hours[Math.floor((Number(row.minute) - start) / 3600000)];
          for (const key of [
            'reads',
            'writes',
            'other',
            'milliseconds',
            'operations',
            'errors',
            'busy',
            'slow',
          ] as const)
            hour[key] += Number(row[key]);
          hour.observedMs += Number(row.observed_ms);
          hour.databaseBytes = row.database_bytes === null ? null : Number(row.database_bytes);
          hour.walBytes = row.wal_bytes === null ? null : Number(row.wal_bytes);
        }
        return { day, hours, available: !storageError, checkedAt: clock() };
      } catch {
        return { day, hours, available: false, checkedAt: clock() };
      }
    },
    flush,
    stop() {
      if (stopped) return;
      if (timer) clearInterval(timer);
      detach();
      db.close = originalClose;
      flush();
      stopped = true;
      history?.close();
      history = null;
      services.delete(db);
    },
  };
  db.close = () => {
    service.stop();
    originalClose.call(db);
  };
  services.set(db, service);
  return service;
}
export function validActivityDay(value: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + 'T00:00:00+02:00');
  return (
    Number.isFinite(parsed) &&
    dayKey(parsed) === value &&
    value <= dayKey(now) &&
    value >= dayKey(now - 29 * 86400000)
  );
}
export const activityToday = () => dayKey(Date.now());
