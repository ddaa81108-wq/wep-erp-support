import { useEffect, useRef } from 'react';
import { api, type LiveChange } from '../api.ts';

type Options = {
  topics: readonly string[];
  cursorKey: string;
  onChange: (changes: readonly LiveChange[], fullResync: boolean) => void | Promise<void>;
  enabled?: boolean;
  fallbackIntervalMs?: number;
};

export function useRealtimeRefresh({
  topics,
  cursorKey,
  onChange,
  enabled = true,
  fallbackIntervalMs = 10_000,
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
    const cursor = () => Math.max(0, Number(sessionStorage.getItem(cursorKey)) || 0);
    const remember = (sequence: number) => {
      if (sequence > cursor()) sessionStorage.setItem(cursorKey, String(sequence));
    };
    const source = new EventSource(`/api/events?after=${encodeURIComponent(String(cursor()))}`);

    const receive = (event: Event) => {
      const message = event as MessageEvent<string>;
      const sequence = Number(message.lastEventId);
      if (Number.isSafeInteger(sequence) && sequence > 0) remember(sequence);
      try {
        const data = JSON.parse(message.data) as Record<string, unknown>;
        const payload =
          typeof data.payload === 'object' && data.payload !== null
            ? (data.payload as Record<string, unknown>)
            : {};
        void callback.current(
          [
            {
              sequence: Number.isSafeInteger(sequence) ? sequence : 0,
              topic: event.type,
              aggregateId: typeof data.aggregateId === 'string' ? data.aggregateId : null,
              payload,
              createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
            },
          ],
          false,
        );
      } catch {
        // The fallback feed repairs malformed or interrupted realtime messages.
      }
    };
    const fullResync = () => void callback.current([], true);
    for (const topic of subscribedTopics) source.addEventListener(topic, receive);
    source.addEventListener('full_resync_required', fullResync);

    const recover = async () => {
      if (stopped || polling || document.visibilityState !== 'visible') return;
      polling = true;
      try {
        const after = cursor();
        const result = await api.eventChanges(after);
        const relevant = result.events.filter((event) => subscribedTopics.includes(event.topic));
        if (!stopped && (result.fullResync || relevant.length > 0)) {
          await callback.current(relevant, result.fullResync);
        }
        remember(result.latest);
      } catch {
        // EventSource reconnects automatically; a later fallback pass retries.
      } finally {
        polling = false;
      }
    };

    const timer = window.setInterval(() => void recover(), fallbackIntervalMs);
    return () => {
      stopped = true;
      source.close();
      window.clearInterval(timer);
    };
  }, [cursorKey, enabled, fallbackIntervalMs, topicKey]);
}
