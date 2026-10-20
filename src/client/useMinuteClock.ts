import { useSyncExternalStore } from 'react';

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => { now = Date.now(); for (const notify of listeners) notify(); }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearInterval(timer); timer = undefined; }
  };
}
export function useMinuteClock() {
  return useSyncExternalStore(subscribe, () => now, () => now);
}
