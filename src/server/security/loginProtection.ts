import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ServerConfig } from '../config.ts';
import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';

// Bound expensive password verification before its first await. Never queue secrets.
const pendingChecks = new WeakMap<AppDatabase, Map<string, number>>();
export function reserveLoginCheck(database: AppDatabase, username: string, address: string) {
  const pending = pendingChecks.get(database) ?? new Map<string, number>();
  pendingChecks.set(database, pending);
  const limits = [['total', 8], [`user:${username}`, 1], [`address:${address}`, 4]] as const;
  if (limits.some(([key, limit]) => (pending.get(key) ?? 0) >= limit)) return null;
  for (const [key] of limits) pending.set(key, (pending.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const [key] of limits) {
      const count = (pending.get(key) ?? 1) - 1;
      if (count > 0) pending.set(key, count);
      else pending.delete(key);
    }
  };
}

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
