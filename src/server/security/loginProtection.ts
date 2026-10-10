import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ServerConfig } from '../config.ts';
import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';

export function remoteAddress(request: IncomingMessage) {
  const peer = request.socket.remoteAddress ?? 'unknown';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  const forwarded = request.headers['x-forwarded-for'];
  if (loopback && typeof forwarded === 'string') {
    const client = forwarded.split(',').at(-1)?.trim();
    if (client && client.length <= 64) return client;
  }
  return peer;
}

export function setupIsAuthorized(request: IncomingMessage, config: ServerConfig) {
  if (config.setupToken) {
    const supplied = request.headers['x-setup-token'];
    if (typeof supplied !== 'string') return false;
    const provided = Buffer.from(supplied, 'utf8');
    const expected = Buffer.from(config.setupToken, 'utf8');
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
  const address = remoteAddress(request);
  const localAddress = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  if (!localAddress) return false;
  try {
    const hostname = new URL(`http://${request.headers.host ?? ''}`).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function loginRateLimited(database: AppDatabase, username: string, address: string) {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const row = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM login_failures
        WHERE username = ? AND occurred_at >= ?) AS account_count,
      (SELECT COUNT(*) FROM login_failures
        WHERE remote_address = ? AND occurred_at >= ?) AS address_count
  `).get(username, since, address, since) as { account_count: number; address_count: number };
  return Number(row.account_count) >= 8 || Number(row.address_count) >= 40;
}

export function recordLoginFailure(database: AppDatabase, username: string, address: string) {
  database.prepare(`
    INSERT INTO login_failures(username, remote_address, occurred_at) VALUES (?, ?, ?)
  `).run(username, address, nowIso());
  database.prepare('DELETE FROM login_failures WHERE occurred_at < ?')
    .run(new Date(Date.now() - 24 * 60 * 60_000).toISOString());
}
