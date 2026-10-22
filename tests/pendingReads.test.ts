import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PendingReads } from '../src/client/pendingReads.ts';

test('concurrent reads share work, settled responses are never cached', async () => {
  const reads = new PendingReads();
  let calls = 0;
  const read = async () => ++calls;
  assert.deepEqual(await Promise.all([reads.run('a', read), reads.run('a', read)]), [1, 1]);
  assert.equal(await reads.run('a', read), 2);
});

test('invalidation isolates writes and sessions, old cleanup cannot remove newer reads', async () => {
  const reads = new PendingReads();
  let resolveOld!: (value: number) => void;
  let resolveNew!: (value: number) => void;
  const old = reads.run('a', () => new Promise<number>((resolve) => { resolveOld = resolve; }));
  reads.clear();
  const fresh = reads.run('a', () => new Promise<number>((resolve) => { resolveNew = resolve; }));
  resolveOld(1);
  await old;
  assert.equal(reads.run('a', async () => 99), fresh);
  resolveNew(2);
  assert.equal(await fresh, 2);
});

test('failed reads are removed and can be retried', async () => {
  const reads = new PendingReads();
  await assert.rejects(reads.run('a', async () => { throw new Error('offline'); }));
  assert.equal(await reads.run('a', async () => 3), 3);
});
