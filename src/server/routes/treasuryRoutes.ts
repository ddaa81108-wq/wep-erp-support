import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import { listAuditLog } from '../domain/audit.ts';
import { listFinancialLedger } from '../domain/financialLedger.ts';
import {
  addTreasuryCashEntry,
  treasuryCashLedger,
  treasuryDashboard,
} from '../domain/treasury.ts';
import type { EventHub } from '../events.ts';
import { forbidden } from '../http/errors.ts';
import { requirePermission } from '../http/guards.ts';
import { readJson, sendJson } from '../http/io.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

type TreasuryRouteContext = {
  database: AppDatabase;
  events: EventHub;
  request: IncomingMessage;
  response: ServerResponse;
  user: AuthenticatedUser;
  url: URL;
  method: string;
  correlationId: string;
};

export async function routeTreasury(context: TreasuryRouteContext) {
  const { database, events, request, response, user, url, method, correlationId } = context;

  if (method === 'GET' && url.pathname === '/api/treasury') {
    requirePermission(user, 'treasury.read');
    sendJson(response, 200, { ok: true, data: treasuryDashboard(database, user.organizationId) });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/audit-log') {
    if (user.role !== 'admin') throw forbidden('audit.read');
    sendJson(response, 200, {
      ok: true,
      data: listAuditLog(database, user.organizationId, url),
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/financial-ledger') {
    if (user.role !== 'admin') throw forbidden('financial_ledger.read');
    sendJson(response, 200, {
      ok: true,
      data: listFinancialLedger(database, user.organizationId, url),
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/treasury/cash-ledger') {
    requirePermission(user, 'treasury.read');
    sendJson(response, 200, {
      ok: true,
      data: treasuryCashLedger(database, user.organizationId, url),
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/treasury/cash-entries') {
    requirePermission(user, 'treasury.write');
    const result = addTreasuryCashEntry(database, user, await readJson(request), correlationId);
    if (result.eventSequence) events.publish(result.eventSequence);
    sendJson(response, 201, { ok: true, data: result, meta: { replayed: result.replayed } });
    return true;
  }

  return false;
}
