import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetRealtimeSession, subscribeRealtime } from '../src/client/realtime/sharedTransport.ts';

test('tab focus and visibility resume share a refresh without delaying committed events or surviving logout', async () => {
  const originals = { window: globalThis.window, document: globalThis.document, EventSource: globalThis.EventSource, fetch: globalThis.fetch };
  const windowMock = new EventTarget();
  const documentMock = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let refreshes = 0, recoveries = 0, changes = 0;
  class Stream extends EventTarget {
    static current: Stream;
    static OPEN = 1;
    readyState = 1;
    constructor() { super(); Stream.current = this; }
    close() { this.readyState = 2; }
  }
  Object.assign(globalThis, { window: windowMock, document: documentMock, EventSource: Stream });
  globalThis.fetch = async () => {
    recoveries++;
    return new Response(JSON.stringify({ ok: true, data: { fullResync: false, latest: 1, events: [] } }));
  };
  try {
    resetRealtimeSession(0);
    subscribeRealtime({ topics: ['customer.changed'], initialSnapshotProvided: true, resync: () => { refreshes++; }, change: () => { changes++; } });
    Stream.current.dispatchEvent(new Event('open'));
    windowMock.dispatchEvent(new Event('focus'));
    documentMock.dispatchEvent(new Event('visibilitychange'));
    Stream.current.dispatchEvent(new MessageEvent('customer.changed', { lastEventId: '1', data: '{}' }));
    assert.equal(changes, 1, 'Committed events dispatch immediately, even while a resume is queued');
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(refreshes, 1);
    assert.equal(recoveries, 1);
    documentMock.visibilityState = 'hidden';
    documentMock.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(refreshes, 1);
    documentMock.visibilityState = 'visible';
    windowMock.dispatchEvent(new Event('focus'));
    resetRealtimeSession();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(refreshes, 1, 'Logout cancels queued lifecycle refreshes');
  } finally {
    resetRealtimeSession();
    Object.assign(globalThis, originals);
  }
});
