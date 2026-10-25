import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startInternetGuard } from '../src/client/internetGuard.ts';

test('connection guard tolerates slow successful tunnel checks, limits probes, and recovers without remounting', async t => {
  const originals = ['window', 'document', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const windowEvents = new EventTarget();
  const documentEvents = new EventTarget();
  let now = 0;
  let interval: (() => void) | undefined;
  let intervalMs = 0;
  let visibilityState = 'visible';
  let noticeCount = 0;
  let mounts = 0;
  let requests = 0;
  let responseMode: 'ok' | 'failure' | 'slow' = 'ok';
  let release: (() => void) | undefined;
  const budgets: number[] = [];
  const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    budgets.push(milliseconds);
    return new AbortController().signal;
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(windowEvents, {
    setInterval: (callback: () => void, milliseconds: number) => { interval = callback; intervalMs = milliseconds; return 1; },
  }) });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(documentEvents, {
    createElement: () => ({ setAttribute() {}, remove() { noticeCount--; } }),
    body: { append() { noticeCount++; } },
  }) });
  Object.defineProperty(document, 'visibilityState', { get: () => visibilityState });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (path: string, init: RequestInit) => {
    requests++;
    assert.equal(path, '/api/health');
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    if (responseMode === 'slow') await new Promise<void>(resolve => { release = resolve; });
    if (responseMode === 'failure') throw new TypeError('Network unavailable');
    return new Response('{}', { status: 200 });
  } });
  const tick = async () => { now += intervalMs; interval!(); await flush(); };
  try {
    await startInternetGuard(() => { mounts++; });
    assert.equal(mounts, 1);
    assert.equal(intervalMs, 15_000);
    responseMode = 'slow';
    for (let attempt = 0; attempt < 3; attempt++) {
      await tick();
      const before = requests;
      // An overlapping timer and many failed API requests cannot start extra probes.
      interval!();
      for (let index = 0; index < 10; index++) windowEvents.dispatchEvent(new Event('abdo:internet-unavailable'));
      assert.equal(requests, before);
      now += 7_000;
      release!(); await flush();
      assert.equal(noticeCount, 0);
    }
    assert.ok(budgets.every(value => value === 12_000));
    responseMode = 'failure';
    await tick(); await tick();
    assert.equal(noticeCount, 0);
    const before = requests;
    for (let index = 0; index < 30; index++) windowEvents.dispatchEvent(new Event('abdo:internet-unavailable'));
    await flush();
    assert.equal(requests, before);
    await tick();
    assert.equal(noticeCount, 1, 'a sustained real outage must still be reported');
    await tick(); assert.equal(noticeCount, 1, 'do not duplicate banners');
    responseMode = 'ok'; await tick();
    assert.equal(noticeCount, 0);
    assert.equal(mounts, 1, 'recovery must preserve the mounted app and its drafts');
    const beforeJitter = requests;
    now += intervalMs - 1; interval!(); await flush();
    assert.equal(requests, beforeJitter + 1, 'minor timer jitter must not skip the next health check');
    responseMode = 'failure'; await tick(); await tick();
    visibilityState = 'hidden';
    const beforeHidden = requests;
    await tick(); await tick();
    assert.equal(requests, beforeHidden);
    visibilityState = 'visible';
    documentEvents.dispatchEvent(new Event('visibilitychange')); await flush();
    assert.equal(noticeCount, 0, 'resuming must not count stale pre-suspension failures');
    responseMode = 'ok'; await tick();
    assert.equal(mounts, 1);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
