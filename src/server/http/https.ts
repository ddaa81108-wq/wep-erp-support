import type { IncomingMessage, ServerResponse } from 'node:http';

export function enforcePublicHttps(request: IncomingMessage, response: ServerResponse, publicOrigin?: string) {
  if (!publicOrigin) return false;
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    throw new Error('Public origin must be a canonical HTTPS origin');
  const host = request.headers.host?.split(':')[0]?.toLowerCase();
  const peer = request.socket.remoteAddress;
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (loopback && (host === 'localhost' || host === '127.0.0.1' || request.headers.host === '[::1]')) return false;
  if (loopback && request.headers['x-forwarded-proto'] === 'https') {
    response.setHeader('Strict-Transport-Security', 'max-age=15552000');
    return false;
  }
  response.writeHead(308, { Location: origin.origin + '/' + (request.url ?? '/').replace(/^\/+/, ''), 'Cache-Control': 'no-store' });
  response.end();
  return true;
}
