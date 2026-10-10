import type { ServerConfig } from './config.ts';

type FetchLike = typeof fetch;

const MAX_PROBE_BODY_BYTES = 128;

async function readLimitedText(response: Response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > MAX_PROBE_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function responseProvesInternet(url: string, response: Response) {
  if (url.includes('msftconnecttest.com/connecttest.txt')) {
    if (response.status !== 200) return false;
    const body = await readLimitedText(response);
    return body?.trim() === 'Microsoft Connect Test';
  }
  if (url.includes('google.com/generate_204')) return response.status === 204;
  return response.ok;
}

export class InternetGate {
  private readonly config: Pick<ServerConfig,
    'internetRequired' | 'internetProbeUrls' | 'internetProbeTimeoutMs' | 'internetProbeCacheMs'>;
  private readonly fetchImpl: FetchLike;
  private checkedAt = 0;
  private lastResult = false;
  private pending: Promise<boolean> | null = null;

  constructor(
    config: Pick<ServerConfig,
      'internetRequired' | 'internetProbeUrls' | 'internetProbeTimeoutMs' | 'internetProbeCacheMs'>,
    fetchImpl: FetchLike = fetch,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async isAvailable() {
    if (!this.config.internetRequired) return true;
    if (Date.now() - this.checkedAt < this.config.internetProbeCacheMs) return this.lastResult;
    if (this.pending) return this.pending;

    this.pending = this.check().then((result) => {
      this.lastResult = result;
      this.checkedAt = Date.now();
      return result;
    }).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async check() {
    if (this.config.internetProbeUrls.length === 0) return false;

    return new Promise<boolean>((resolve) => {
      let remaining = this.config.internetProbeUrls.length;
      let resolved = false;

      for (const url of this.config.internetProbeUrls) {
        void (async () => {
          let succeeded: boolean;
          try {
            const response = await this.fetchImpl(url, {
              method: 'GET',
              cache: 'no-store',
              redirect: 'follow',
              signal: AbortSignal.timeout(this.config.internetProbeTimeoutMs),
              headers: { 'User-Agent': 'Abdo-ERP-Internet-Gate/1' },
            });
            succeeded = await responseProvesInternet(url, response);
          } catch {
            succeeded = false;
          }

          if (succeeded && !resolved) {
            resolved = true;
            resolve(true);
            return;
          }

          remaining -= 1;
          if (remaining === 0 && !resolved) resolve(false);
        })();
      }
    });
  }
}
