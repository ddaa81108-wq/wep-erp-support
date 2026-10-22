import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rememberCsrf, request } from '../src/client/apiTransport.ts';

test('transport shares concurrent GETs, but writes, sessions and abort signals isolate reads', async () => {
  const original = globalThis.fetch;
  const pending: Array<() => void> = [];
  let calls = 0;
  globalThis.fetch = async () => {
    const value = ++calls;
    await new Promise<void>((resolve) => pending.push(resolve));
    return new Response(JSON.stringify({ ok: true, data: value }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const first = request('/api/customers');
    const shared = request('/api/customers');
    assert.equal(calls, 1);
    const write = request('/api/customers', { method: 'POST', body: '{}' });
    const afterWrite = request('/api/customers');
    assert.equal(calls, 3);
    rememberCsrf('new-session');
    const afterSession = request('/api/customers');
    const abortable = request('/api/customers', { signal: new AbortController().signal });
    assert.equal(calls, 5);
    pending.splice(0).forEach((resolve) => resolve());
    assert.deepEqual(await Promise.all([first, shared, write, afterWrite, afterSession, abortable]), [1, 1, 2, 3, 4, 5]);
    const fresh = request('/api/customers');
    assert.equal(calls, 6);
    pending.shift()!();
    assert.equal(await fresh, 6);
  } finally {
    globalThis.fetch = original;
    rememberCsrf('');
  }
});
