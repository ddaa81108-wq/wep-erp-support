import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import { getMasraweyaDay, saveMasraweyaDay } from '../domain/masraweya.ts';
import {
  createPurchaseEntry,
  deletePurchaseEntry,
  finalizePurchaseDay,
  listPurchases,
  setPurchaseDayCorrection,
  setPurchaseOpening,
  updatePurchaseEntry,
} from '../domain/purchases.ts';
import type { EventHub } from '../events.ts';
import { requirePermission } from '../http/guards.ts';
import { HttpError } from '../http/errors.ts';
import { readJson, sendJson } from '../http/io.ts';
import { decodePathSegment } from '../http/web.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

type FinancialWorkRouteContext = {
  database: AppDatabase;
  events: EventHub;
  request: IncomingMessage;
  response: ServerResponse;
  user: AuthenticatedUser;
  url: URL;
  method: string;
  correlationId: string;
};

function publish(events: EventHub, sequences: readonly number[]) {
  for (const sequence of sequences) events.publish(sequence);
}

export async function routeFinancialWork(context: FinancialWorkRouteContext) {
  const { database, events, request, response, user, url, method, correlationId } = context;

  if (method === 'GET' && url.pathname === '/api/masraweya/day') {
    requirePermission(user, 'masraweya.read');
    sendJson(response, 200, {
      ok: true,
      data: getMasraweyaDay(database, user.organizationId, url.searchParams.get('date') ?? undefined),
    });
    return true;
  }

  if (method === 'PUT' && url.pathname === '/api/masraweya/day') {
    requirePermission(user, 'masraweya.write');
    const data = saveMasraweyaDay(database, user, await readJson(request), correlationId);
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  if (
    method === 'POST' &&
    ['/api/masraweya/day/finalize', '/api/masraweya/day/correction'].includes(url.pathname)
  ) {
    requirePermission(user, 'masraweya.write');
    throw new HttpError(
      410,
      'MASRAWEYA_AUTOMATIC_WORKFLOW',
      'المصراوية تعمل بالحفظ التلقائي. حدّث الصفحة؛ لا يلزم اعتماد أو فتح تعديل.',
    );
  }

  const purchaseRoot = url.pathname.match(/^\/api\/purchases\/(al_bayan|simsim)$/);
  if (method === 'GET' && purchaseRoot) {
    requirePermission(user, 'purchases.read');
    sendJson(response, 200, {
      ok: true,
      data: listPurchases(
        database,
        user,
        purchaseRoot[1],
        url.searchParams.get('before'),
        url.searchParams.get('limit'),
        url.searchParams.get('known'),
      ),
    });
    return true;
  }
  if (method === 'POST' && purchaseRoot) {
    requirePermission(user, 'purchases.write');
    const data = createPurchaseEntry(database, user, purchaseRoot[1], await readJson(request), correlationId);
    publish(events, data.eventSequences);
    sendJson(response, 201, { ok: true, data });
    return true;
  }

  const purchaseOpening = url.pathname.match(/^\/api\/purchases\/(al_bayan|simsim)\/opening$/);
  if (method === 'PATCH' && purchaseOpening) {
    requirePermission(user, 'purchases.write');
    const data = setPurchaseOpening(
      database,
      user,
      purchaseOpening[1],
      await readJson(request),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  const purchaseFinalize = url.pathname.match(/^\/api\/purchases\/(al_bayan|simsim)\/finalize$/);
  if (method === 'POST' && purchaseFinalize) {
    requirePermission(user, 'purchases.finalize');
    const data = finalizePurchaseDay(
      database,
      user,
      purchaseFinalize[1],
      await readJson(request),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  const purchaseEntry = url.pathname.match(/^\/api\/purchases\/(al_bayan|simsim)\/entries\/([^/]+)$/);
  if (method === 'PATCH' && purchaseEntry) {
    requirePermission(user, 'purchases.write');
    const data = updatePurchaseEntry(
      database,
      user,
      purchaseEntry[1],
      decodePathSegment(purchaseEntry[2]),
      await readJson(request),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }
  if (method === 'DELETE' && purchaseEntry) {
    requirePermission(user, 'purchases.write');
    const data = deletePurchaseEntry(
      database,
      user,
      purchaseEntry[1],
      decodePathSegment(purchaseEntry[2]),
      await readJson(request),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  const purchaseDayCorrection = url.pathname.match(
    /^\/api\/purchases\/(al_bayan|simsim)\/days\/([^/]+)\/correction$/,
  );
  if (method === 'PATCH' && purchaseDayCorrection) {
    requirePermission(user, 'purchases.finalize');
    const data = setPurchaseDayCorrection(
      database,
      user,
      purchaseDayCorrection[1],
      decodePathSegment(purchaseDayCorrection[2]),
      await readJson(request),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  return false;
}
