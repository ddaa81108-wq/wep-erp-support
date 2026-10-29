import { useEffect, useRef } from 'react';
import type { LiveChange } from '../api.ts';
import { invalidatePendingReads } from '../apiTransport.ts';
import { subscribeRealtime } from './sharedTransport.ts';

// Batch the events emitted by one commit within a display frame, without
// adding the previous 50–100 ms wait to each saved operation.
const COALESCE_MS=16;

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
  initialSnapshotProvided = false,
}: Options) {
  const callback = useRef(onChange);
  const topicKey = topics.join('|');
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      running = false,
      resync = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Map<number, LiveChange>();
    const schedule = (delay = COALESCE_MS) => {
      if (!stopped && !timer && !running) timer = setTimeout(() => void flush(), delay);
    };
    const flush = async () => {
      timer = undefined;
      if (stopped || running) return;
      running = true;
      const changes = [...pending.values()],
        full = resync;
      pending.clear();
      resync = false;
      try {
        if (changes.length || full) {
          invalidatePendingReads();
          await callback.current(changes, full);
        }
      } catch {
        resync = true;
      } finally {
        running = false;
        if (!stopped && (pending.size || resync)) schedule(resync ? 1000 : COALESCE_MS);
      }
    };
    const unsubscribe = subscribeRealtime({
      topics: topicKey.split('|'),
      initialSnapshotProvided,
      change: (event) => {
        pending.set(event.sequence, event);
        schedule();
      },
      resync: () => {
        resync = true;
        schedule();
      },
    });
    return () => {
      stopped = true;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [cursorKey, enabled, topicKey, initialSnapshotProvided]);
}
