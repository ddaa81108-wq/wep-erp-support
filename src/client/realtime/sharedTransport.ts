import { request } from '../apiTransport.ts';
import type { LiveChange } from '../apiTypes.ts';

type Listener = {
  topics: readonly string[];
  initialSnapshotProvided: boolean;
  change: (event: LiveChange) => void;
  resync: () => void;
};
const topics = [
  'customer.changed',
  'customer.ledger.changed',
  'company.changed',
  'company.ledger.changed',
  'libyan-deposit.changed',
  'libyan-deposit.ledger.changed',
  'egyptian-deposit.changed',
  'egyptian-deposit.ledger.changed',
  'collection.changed',
  'purchases.changed',
  'masraweya.changed',
  'treasury.changed',
  'treasury.report.closed',
  'financial.summary.changed',
];
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let checkpoint = 0,
  generation = 0,
  lastRecovery = 0;
let opened = false,
  recovering = false;
let poll: ReturnType<typeof setInterval> | undefined;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
function stop() {
  generation++;
  source?.close();
  source = null;
  opened = false;
  recovering = false;
  clearInterval(poll);
  poll = undefined;
  window.removeEventListener('online', resume);
  window.removeEventListener('focus', resume);
  document.removeEventListener('visibilitychange', resume);
}
/** Login/me captures this before section reads, closing the initial snapshot gap. */
export function resetRealtimeSession(sequence?: number) {
  stop();
  listeners.clear();
  checkpoint = typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}
function reconcile() {
  for (const listener of listeners) listener.resync();
}
function dispatch(event: LiveChange) {
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= checkpoint) return;
  checkpoint = event.sequence;
  for (const listener of listeners) if (listener.topics.includes(event.topic)) listener.change(event);
}
async function recover() {
  if (recovering || !source || document.visibilityState !== 'visible') return;
  recovering = true;
  const run = generation;
  try {
    const result = await request<{ fullResync: boolean; latest: number; events: LiveChange[] }>(
      `/api/event-changes?after=${checkpoint}`,
    );
    if (run !== generation) return;
    for (const event of result.events) dispatch(event);
    checkpoint = result.fullResync ? result.latest : Math.max(checkpoint, result.latest);
    if (result.fullResync) reconcile();
  } catch {
    if (run === generation) reconcile();
  } finally {
    if (run === generation) recovering = false;
  }
}
function resume() {
  if (document.visibilityState === 'visible') {
    reconcile();
    void recover();
  }
}
function start() {
  if (source) return;
  const run = ++generation;
  source = new EventSource(`/api/events?after=${checkpoint}`);
  lastRecovery = Date.now();
  for (const topic of topics)
    source.addEventListener(topic, (event) => {
      if (run !== generation) return;
      try {
        const message = event as MessageEvent<string>;
        dispatch({ ...JSON.parse(message.data), sequence: Number(message.lastEventId), topic } as LiveChange);
      } catch {
        reconcile();
      }
    });
  source.addEventListener('checkpoint', (event) => {
    if (run !== generation) return;
    const sequence = Number((event as MessageEvent<string>).lastEventId);
    if (Number.isSafeInteger(sequence)) checkpoint = Math.max(checkpoint, sequence);
  });
  source.addEventListener('full_resync_required', (event) => {
    if (run !== generation) return;
    try {
      const latest = Number(JSON.parse((event as MessageEvent<string>).data).latest);
      if (Number.isSafeInteger(latest)) checkpoint = latest;
    } catch {
      /* A snapshot still repairs a malformed notice. */
    }
    reconcile();
  });
  source.addEventListener('open', () => {
    if (run !== generation) return;
    for (const listener of listeners) if (opened || !listener.initialSnapshotProvided) listener.resync();
    opened = true;
  });
  source.addEventListener('error', () => {
    if (run === generation) void recover();
  });
  poll = setInterval(() => {
    if (source?.readyState === EventSource.OPEN && Date.now() - lastRecovery < 60_000) return;
    lastRecovery = Date.now();
    void recover();
  }, 2500);
  window.addEventListener('online', resume);
  window.addEventListener('focus', resume);
  document.addEventListener('visibilitychange', resume);
}
export function subscribeRealtime(listener: Listener) {
  clearTimeout(stopTimer);
  const alreadyOpen = opened;
  listeners.add(listener);
  start();
  // Late subscribers reconcile events that arrived while their snapshot was loading.
  if (alreadyOpen) listener.resync();
  return () => {
    listeners.delete(listener);
    if (!listeners.size)
      stopTimer = setTimeout(() => {
        if (!listeners.size) stop();
      }, 0);
  };
}
