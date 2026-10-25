import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RefreshQueue } from '../src/client/realtime/queuedRefresh.ts';

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

test('refresh callers await the trailing authoritative read instead of dropping an invalidation', async () => {
  const releases: (() => void)[] = [];
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const queue = new RefreshQueue();
  const refresh = async () => {
    calls++; active++; maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--;
  };
  const load = () => queue.run(refresh);
  const first = load(); await flush();
  assert.equal(queue.busy, true);
  const second = load();
  const third = load();
  assert.equal(first, second); assert.equal(second, third);
  let settled = false;
  void third.then(() => { settled = true; });
  releases.shift()!(); await flush();
  assert.equal(calls, 2); assert.equal(settled, false);
  load(); load();
  releases.shift()!(); await flush();
  assert.equal(calls, 3);
  releases.shift()!(); await third;
  assert.equal(queue.busy, false);
  assert.equal(settled, true); assert.equal(maximum, 1);
});

test('refresh failures propagate for cursor retry and never wedge future refreshes', async () => {
  let calls = 0;
  const failure = new Error('Temporary read failure');
  const queue = new RefreshQueue();
  const load = () => queue.run(async () => { if (++calls === 1) throw failure; });
  const first = load(); const second = load();
  assert.equal(first, second);
  await assert.rejects(first, error => error === failure);
  await load(); assert.equal(calls, 2);
  await load(); assert.equal(calls, 3);
});
