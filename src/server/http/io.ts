import type { IncomingMessage, ServerResponse } from 'node:http';
import { badRequest, payloadTooLarge } from './errors.ts';

const MAX_BODY_BYTES = 1_048_576;

export async function readJson(request: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw badRequest('CONTENT_TYPE_REQUIRED', 'يجب إرسال البيانات بصيغة JSON.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw payloadTooLarge();
    }
    chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('object required');
    }
    return parsed;
  } catch {
    throw badRequest('INVALID_JSON', 'تعذر قراءة بيانات الطلب.');
  }
}

export function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(body);
}

export function assertSameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw badRequest('INVALID_ORIGIN', 'مصدر الطلب غير صالح.');
  }
  if (originHost !== host) {
    throw badRequest('ORIGIN_MISMATCH', 'تم رفض الطلب لأن مصدره لا يطابق الخادم المحلي.');
  }
}
