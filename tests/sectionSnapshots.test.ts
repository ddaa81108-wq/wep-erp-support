import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SectionSnapshots } from '../src/client/dashboard/sectionSnapshotsStore.ts';

test('snapshots expire, remain bounded and are scoped to their dashboard', () => {
  let now = 0;
  const store = new SectionSnapshots(() => now);
  const otherUser = new SectionSnapshots(() => now);
  store.set('day', { version: 1 });
  assert.deepEqual(store.get('day'), { version: 1 });
  assert.equal(otherUser.get('day'), undefined);
  now = 30_000;
  assert.equal(store.get('day'), undefined);
  for (let i = 0; i < 9; i++) store.set(String(i), i);
  assert.equal(store.get('0'), undefined);
  assert.equal(store.get('8'), 8);
});

test('writes and logout invalidate snapshots and reject late reads from an earlier generation', () => {
  const store = new SectionSnapshots();
  const generation = store.generation;
  store.set('day', 1);
  store.clear();
  store.set('day', 2, generation);
  assert.equal(store.get('day'), undefined);
  store.set('day', 3);
  assert.equal(store.get('day'), 3);
});
