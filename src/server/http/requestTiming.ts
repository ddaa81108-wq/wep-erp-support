import type { ServerResponse } from 'node:http';

// Request-local numbers only: no payloads, identities, database writes or logs.
const timings = new WeakMap<ServerResponse, { start: number; gateEnd?: number }>();

export function startRequestTiming(response: ServerResponse) {
  timings.set(response, { start: performance.now() });
}

export function finishGateTiming(response: ServerResponse) {
  const timing = timings.get(response);
  if (timing) timing.gateEnd = performance.now();
}

export function applyRequestTiming(response: ServerResponse) {
  const timing = timings.get(response);
  if (!timing || response.headersSent) return;
  const end = performance.now();
  const parts = [`total;dur=${(end - timing.start).toFixed(2)}`];
  if (timing.gateEnd !== undefined) {
    parts.push(`gate;dur=${(timing.gateEnd - timing.start).toFixed(2)}`);
    parts.push(`app;dur=${(end - timing.gateEnd).toFixed(2)}`);
  }
  response.setHeader('Server-Timing', parts.join(', '));
}
