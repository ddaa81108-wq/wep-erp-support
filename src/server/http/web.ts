import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { badRequest } from './errors.ts';

const moduleFile = fileURLToPath(import.meta.url);
const WEB_ROOT =
  basename(moduleFile) === 'main.mjs'
    ? resolve(dirname(moduleFile), '../web')
    : resolve(dirname(moduleFile), '../../../dist/web');
const WEB_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

export function applyBrowserSecurityHeaders(response: ServerResponse) {
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
}

export function decodePathSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    // eslint-disable-next-line no-control-regex -- URL path controls must be rejected explicitly.
    if (!decoded || decoded.length > 256 || /[\u0000-\u001F]/.test(decoded))
      throw new Error('invalid segment');
    return decoded;
  } catch {
    throw badRequest('INVALID_PATH_SEGMENT', 'معرّف المسار غير صالح.');
  }
}

export async function serveWebAsset(pathname: string, response: ServerResponse) {
  const relative = pathname === '/' ? 'index.html' : decodePathSegment(pathname).replace(/^\/+/, '');
  const candidate = resolve(WEB_ROOT, relative);
  if (candidate !== WEB_ROOT && !candidate.startsWith(`${WEB_ROOT}${sep}`)) return false;
  try {
    const body = await readFile(candidate);
    const extension = extname(candidate).toLowerCase();
    const immutable = pathname.startsWith('/assets/');
    response.writeHead(200, {
      'Content-Type': WEB_MIME[extension] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy':
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(body);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') return false;
    throw error;
  }
}
