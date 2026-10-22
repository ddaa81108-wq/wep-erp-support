import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { browserPushMessage } from '../src/server/domain/browserPushMessage.ts';

test('background worker displays actor and action without an open page and handles invalid payloads', async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const displayed: { title: string; body: string }[] = [];
  runInNewContext(readFileSync(new URL('../public/erp-push-sw.js', import.meta.url), 'utf8'), {
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        handlers[name] = handler;
      },
      registration: {
        showNotification: async (title: string, options: { body: string }) => {
          displayed.push({ title, body: options.body });
        },
      },
    },
  });
  for (const data of [{ body: 'أحمد — دفع جزئي' }, null, 'invalid', { body: 'x'.repeat(500) }]) {
    let completion: Promise<unknown> = Promise.resolve();
    handlers.push({
      data: { json: () => data },
      waitUntil: (value: Promise<unknown>) => {
        completion = value;
      },
    });
    await completion;
  }
  assert.deepEqual(displayed[0], { title: 'VIB Abdo Company', body: 'أحمد — دفع جزئي' });
  assert.equal(displayed[1].body, displayed[2].body);
  assert.ok(displayed[1].body.includes('إشعار جديد'));
  assert.equal(displayed[3].body.length, 240);
});

test('push distinguishes full and partial payments without changing in-app speech', () => {
  assert.equal(browserPushMessage('collection.submit', 'أحمد', 'full'), 'أحمد — دفع كلي');
  assert.equal(browserPushMessage('customer.payment', 'أحمد', 'partial'), 'أحمد — دفع جزئي');
  assert.equal(browserPushMessage('company.payment', 'أحمد', 'full'), 'أحمد — دفع كلي');
});

test('background notifications follow stored language and retain the actor name without caching API data', async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  const stored = new Map<string, string>();
  const displayed: { body: string; dir: string; lang: string }[] = [];
  runInNewContext(readFileSync(new URL('../public/erp-push-sw.js', import.meta.url), 'utf8'), {
    Response,
    caches: {
      open: async () => ({
        put: async (path: string, response: Response) => {
          stored.set(path, await response.text());
        },
        match: async (path: string) => (stored.has(path) ? new Response(stored.get(path)) : undefined),
      }),
    },
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        handlers[name] = handler;
      },
      registration: {
        showNotification: async (_title: string, options: { body: string; dir: string; lang: string }) => {
          displayed.push(options);
        },
      },
    },
  });
  let completion: Promise<unknown> = Promise.resolve();
  const waitUntil = (value: Promise<unknown>) => {
    completion = value;
  };
  handlers.message({ data: { type: 'abdo:set-language', language: 'en' }, waitUntil });
  await completion;
  handlers.push({
    data: { json: () => ({ body: browserPushMessage('customer.payment', 'محمد', 'partial') }) },
    waitUntil,
  });
  await completion;
  assert.equal(displayed[0].body, 'محمد — Partial payment');
  assert.equal(displayed[0].lang, 'en');
  assert.equal(displayed[0].dir, 'ltr');
  handlers.message({ data: { type: 'abdo:set-language', language: 'ar' }, waitUntil });
  await completion;
  handlers.push({
    data: { json: () => ({ body: browserPushMessage('customer.payment', 'محمد', 'partial') }) },
    waitUntil,
  });
  await completion;
  assert.equal(displayed[1].body, 'محمد — دفع جزئي');
  assert.equal(displayed[1].dir, 'rtl');
  assert.deepEqual([...stored.keys()], ['/__abdo_ui_language__']);
  assert.equal(handlers.fetch, undefined);
});
