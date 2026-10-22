type Prompt = { resolve: (confirmed: boolean) => void };
const queue: Prompt[] = [];
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export const duplicateSnapshot = () => queue[0] ?? null;
export function subscribeDuplicate(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function confirmDuplicate(): Promise<boolean> {
  return new Promise(resolve => { queue.push({ resolve }); notify(); });
}
export function answerDuplicate(confirmed: boolean) {
  queue.shift()?.resolve(confirmed);
  notify();
}
export function cancelDuplicatePrompts() {
  for (const prompt of queue.splice(0)) prompt.resolve(false);
  notify();
}

/** Only new financial entries participate; edits and administrative actions do not. */
export function duplicateAwareInput(path: string, init: RequestInit): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  const supported = method === 'PUT' && path === '/api/masraweya/day' || method === 'POST' && (
    /^\/api\/(customers|companies|libyan-deposits|egyptian-deposits)\/[^/]+\/transactions$/.test(path) ||
    /^\/api\/purchases\/(al_bayan|simsim)$/.test(path) ||
    path === '/api/treasury/cash-entries' || path === '/api/collections/unlinked-receipts' ||
    path === '/api/collections/payroll/entries' || /^\/api\/collections\/assignments\/[^/]+\/submissions$/.test(path)
  );
  if (!supported || typeof init.body !== 'string') return init;
  try {
    const body: unknown = JSON.parse(init.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return init;
    return { ...init, body: JSON.stringify({ ...body, checkDuplicate: true }) };
  } catch { return init; }
}
