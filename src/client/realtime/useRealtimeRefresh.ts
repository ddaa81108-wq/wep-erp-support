import { useEffect, useRef } from 'react';
import { api, type LiveChange } from '../api.ts';
import { invalidatePendingReads } from '../apiTransport.ts';

type Options = {
  topics: readonly string[];
  cursorKey: string;
  onChange: (changes: readonly LiveChange[], fullResync: boolean) => void | Promise<void>;
  enabled?: boolean;
  fallbackIntervalMs?: number;
  initialSnapshotProvided?: boolean;
};

export function useRealtimeRefresh({
  topics,
  cursorKey,
  onChange,
  enabled = true,
  fallbackIntervalMs = 10_000,
  initialSnapshotProvided = false,
}: Options) {
  const callback = useRef(onChange);
  const topicKey = topics.join('|');

  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    const subscribedTopics = topicKey.split('|').filter(Boolean);
    let stopped = false;
    let polling = false;
    let lastRecovery = Date.now();
    const cursor = () => Math.max(0, Number(sessionStorage.getItem(cursorKey)) || 0);
    const remember = (sequence: number) => {
      if (sequence > cursor()) sessionStorage.setItem(cursorKey, String(sequence));
    };
    const source = new EventSource(`/api/events?after=${encodeURIComponent(String(cursor()))}`);

    let timer: number | null = null;
    let running = false;
    let resync = false;
    let latest = cursor();
    const pending = new Map<number, LiveChange>();
    const flush = async () => {
      timer = null;
      if (stopped || running) return;
      running = true;
      const changes = [...pending.values()];
      pending.clear();
      const full = resync;
      resync = false;
      const checkpoint = latest;
      try {
        if (changes.length || full) {
          invalidatePendingReads();
          await callback.current(changes, full);
        }
        if (!stopped) remember(checkpoint);
      } catch {
        // Do not acknowledge failed refreshes; retry with an authoritative snapshot.
        resync = true;
      } finally {
        running = false;
        if (!stopped && (pending.size || resync)) schedule(resync ? 1000 : 100);
      }
    };
    const schedule = (delay = 50) => {
      if (!stopped && timer === null && !running) timer = window.setTimeout(() => void flush(), delay);
    };
    const fullResync = () => {
      resync = true;
      schedule();
    };
    const receive = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const data = JSON.parse(message.data) as Record<string, unknown>;
        const sequence = Number(message.lastEventId);
        if (!Number.isSafeInteger(sequence) || sequence <= 0) {
          fullResync();
          return;
        }
        latest = Math.max(latest, sequence);
        pending.set(sequence, {
          sequence,
          topic: event.type,
          aggregateId: typeof data.aggregateId === 'string' ? data.aggregateId : null,
          payload:
            typeof data.payload === 'object' && data.payload !== null
              ? (data.payload as Record<string, unknown>)
              : {},
          createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
        });
        schedule();
      } catch {
        fullResync();
      }
    };
    for (const topic of subscribedTopics) source.addEventListener(topic, receive);
    source.addEventListener('full_resync_required', fullResync);
    let opened = false;
    source.addEventListener('open', () => {
      // Initial data is fetched by the section. Replayed events still refresh
      // changes during that fetch; reconnects always force a full resync.
      if (opened || !initialSnapshotProvided) fullResync();
      opened = true;
    });

    const recover = async () => {
      if (stopped || polling || document.visibilityState !== 'visible') return;
      polling = true;
      try {
        const result = await api.eventChanges(cursor());
        if (stopped) return;
        latest = Math.max(latest, result.latest);
        resync ||= result.fullResync;
        for (const event of result.events)
          if (subscribedTopics.includes(event.topic)) pending.set(event.sequence, event);
        schedule();
      } catch {
        // Retry data as well as transport when reconnecting after an outage.
        fullResync();
      } finally {
        polling = false;
      }
    };
    const resume = () => {
      if (document.visibilityState === 'visible') {
        fullResync();
        void recover();
      }
    };
    // Native SSE reconnects can take seconds; bridge the gap immediately with
    // the same authorized change feed, without replaying financial writes.
    source.addEventListener('error', () => { void recover(); });
    const pollTimer = window.setInterval(() => {
      // Keep polling as a fallback and a periodic safety check for silent gaps.
      // Reconnect and visibility handlers still reconcile immediately.
      if (source.readyState === EventSource.OPEN && Date.now() - lastRecovery < 60_000) return;
      lastRecovery = Date.now();
      void recover();
    }, fallbackIntervalMs);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      stopped = true;
      source.close();
      window.clearInterval(pollTimer);
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [cursorKey, enabled, fallbackIntervalMs, topicKey, initialSnapshotProvided]);
}
