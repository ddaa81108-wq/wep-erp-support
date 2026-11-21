import http from 'node:http';
import https from 'node:https';
import process from 'node:process';
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Public, read-only endpoints only. Never accepts credentials or saves bodies.
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--local-origin', '--public-origin', '--samples', '--output'].includes(key) || !value)
    throw new Error('Options: --local-origin URL --public-origin URL --samples 1..5 --output PATH');
  options.set(key, value);
}
const samples = Number(options.get('--samples') ?? 3);
if (!Number.isInteger(samples) || samples < 1 || samples > 5) throw new Error('Samples must be 1..5.');
const origins = {
  local: options.get('--local-origin') ?? 'http://127.0.0.1:4310',
  public: options.get('--public-origin') ?? 'https://vip2100.com',
};
for (const origin of Object.values(origins)) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use an HTTP(S) origin without credentials, paths or query parameters.');
}

async function measure(origin, path, agent) {
  const start = performance.now();
  return new Promise((done) => {
    let finished = false, request;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      done(result);
    };
    const deadline = setTimeout(() => {
      request?.destroy();
      finish({ error: 'TIMEOUT', totalMs: 15_000 });
    }, 15_000);
    request = (origin.startsWith('https:') ? https : http).get(new URL(path, origin), {
      agent,
      headers: { 'Accept-Encoding': 'br,gzip', 'User-Agent': 'VIB-ReadOnly-Performance-Check/1' },
    }, (response) => {
      const ttfbMs = performance.now() - start;
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) {
          request.destroy();
          finish({ error: 'RESPONSE_TOO_LARGE' });
        }
      });
      response.on('end', () => finish({
        status: response.statusCode,
        ttfbMs: +ttfbMs.toFixed(1), totalMs: +(performance.now() - start).toFixed(1), bytes,
        serverTiming: response.headers['server-timing'] ?? null,
        encoding: response.headers['content-encoding'] ?? 'none',
        cache: response.headers['cf-cache-status'] ?? null,
      }));
      response.on('error', () => finish({ error: 'RESPONSE_ERROR' }));
    });
    request.on('error', (error) => finish({ error: error.code ?? 'NETWORK_ERROR', totalMs: +(performance.now() - start).toFixed(1) }));
  });
}

const report = { measuredAt: new Date().toISOString(), samples, endpoints: {} };
for (const [label, origin] of Object.entries(origins)) {
  const agent = origin.startsWith('https:') ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true });
  try {
    for (const path of ['/api/health', '/erp']) {
      const values = [];
      for (let i = 0; i < samples; i++) values.push(await measure(origin, path, agent));
      report.endpoints[`${label}${path}`] = values;
    }
  } finally { agent.destroy(); }
}
const result = JSON.stringify(report, null, 2) + '\n';
if (options.has('--output')) {
  const destination = resolve(options.get('--output'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, result);
}
process.stdout.write(result);
