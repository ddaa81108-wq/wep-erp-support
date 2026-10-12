import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import {
  addCustomerTransaction,
  cancelCustomerTransaction,
  correctCustomerTransaction,
  createCustomer,
  customerLedger,
  customerSnapshot,
  listCustomers,
  similarCustomers,
  setCustomerPinned,
  updateCustomerDetails,
  type DebtPartyKind,
} from '../domain/customers.ts';
import type { EventHub } from '../events.ts';
import { requirePermission } from '../http/guards.ts';
import { readJson, sendJson } from '../http/io.ts';
import { decodePathSegment } from '../http/web.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { reviewCustomerZero } from '../domain/customerZeroReview.ts';

export type PermanentAccountRouteContext = {
  database: AppDatabase;
  events: EventHub;
  request: IncomingMessage;
  response: ServerResponse;
  user: AuthenticatedUser;
  url: URL;
  method: string;
  correlationId: string;
};

export type PermanentAccountRouteConfig = {
  basePath: `/api/${string}`;
  readPermission: string;
  writePermission: string;
  kind: DebtPartyKind;
};

export async function routePermanentAccounts(
  context: PermanentAccountRouteContext,
  config: PermanentAccountRouteConfig,
) {
  const { database, events, request, response, user, url, method, correlationId } = context;
  const path = url.pathname.slice(config.basePath.length);
  if (url.pathname !== config.basePath && !url.pathname.startsWith(`${config.basePath}/`)) return false;

  if (method === 'GET' && path === '') {
    requirePermission(user, config.readPermission);
    sendJson(response, 200, {
      ok: true,
      data: listCustomers(database, url, user.organizationId, config.kind),
    });
    return true;
  }
  if (method === 'POST' && path === '') {
    requirePermission(user, config.writePermission);
    return sendOperation(
      response,
      events,
      createCustomer(database, user, await readJson(request), correlationId, config.kind),
      true,
    );
  }
  if (method === 'GET' && path === '/suggestions') {
    requirePermission(user, config.readPermission);
    sendJson(response, 200, {
      ok: true,
      data: similarCustomers(database, url, user.organizationId, config.kind),
    });
    return true;
  }

  const segments = path.split('/').filter(Boolean).map(decodePathSegment);
  const [id, action, transactionId, tail] = segments;
  if (!id) return false;

  if (config.kind === 'customer' && method === 'POST' && action === 'zero-review' && segments.length === 2) {
    return sendOperation(response, events, reviewCustomerZero(database, user, id, await readJson(request), correlationId));
  }

  if (method === 'GET' && !action) {
    requirePermission(user, config.readPermission);
    sendJson(response, 200, {
      ok: true,
      data: customerSnapshot(database, id, user.organizationId, config.kind),
    });
    return true;
  }
  if (method === 'PATCH' && !action) {
    requirePermission(user, config.writePermission);
    return sendOperation(
      response,
      events,
      updateCustomerDetails(database, user, id, await readJson(request), correlationId, config.kind),
    );
  }
  if (method === 'GET' && action === 'ledger' && !transactionId) {
    requirePermission(user, config.readPermission);
    sendJson(response, 200, {
      ok: true,
      data: customerLedger(database, id, url, user.organizationId, config.kind),
    });
    return true;
  }
  if (method === 'PATCH' && action === 'pin' && !transactionId) {
    requirePermission(user, config.writePermission);
    return sendOperation(
      response,
      events,
      setCustomerPinned(database, user, id, await readJson(request), correlationId, config.kind),
    );
  }
  if (method === 'POST' && action === 'transactions' && !transactionId) {
    requirePermission(user, config.writePermission);
    return sendOperation(
      response,
      events,
      addCustomerTransaction(database, user, id, await readJson(request), correlationId, config.kind),
      true,
    );
  }
  if (method === 'POST' && action === 'transactions' && transactionId && tail === 'corrections') {
    requirePermission(user, config.writePermission);
    return sendOperation(
      response,
      events,
      correctCustomerTransaction(
        database,
        user,
        id,
        transactionId,
        await readJson(request),
        correlationId,
        config.kind,
      ),
      true,
    );
  }
  if (method === 'POST' && action === 'transactions' && transactionId && tail === 'cancel') {
    requirePermission(user, config.writePermission);
    return sendOperation(
      response,
      events,
      cancelCustomerTransaction(
        database,
        user,
        id,
        transactionId,
        await readJson(request),
        correlationId,
        config.kind,
      ),
      true,
    );
  }
  return false;
}

function sendOperation(
  response: ServerResponse,
  events: EventHub,
  result: {
    status: number;
    body: unknown;
    eventSequence?: number;
    replayed?: boolean;
  },
  includeReplay = false,
) {
  if (result.eventSequence) events.publish(result.eventSequence);
  sendJson(response, result.status, {
    ok: true,
    data: result.body,
    ...(includeReplay ? { meta: { replayed: Boolean(result.replayed) } } : {}),
  });
  return true;
}
