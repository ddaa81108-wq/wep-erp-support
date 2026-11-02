import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import { cancelCollectionApproval } from '../domain/collectionApprovalCancellation.ts';
import { collectionWorkspace, employeeCollectionWorkspace } from '../domain/collectionWorkspaceQueries.ts';
import {
  assignCustomers,
  closeCollectionDay,
  collectionLinkCandidates,
  createUnlinkedCollectionReceipt,
  decideCollection,
  decideUnlinkedCollectionReceipt,
  listCollectionAssignees,
  listCollections,
  markCollectionCashReceived,
  markUnlinkedCollectionCashReceived,
  submitCollection,
} from '../domain/collections.ts';
import type { EventHub } from '../events.ts';
import { forbidden } from '../http/errors.ts';
import { requirePermission } from '../http/guards.ts';
import { readJson, sendJson } from '../http/io.ts';
import { decodePathSegment } from '../http/web.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import {
  confirmCollectionPayrollEntry,
  createCollectionPayrollEntry,
  listCollectionPayroll,
  updateCollectionPayrollSalary,
} from '../domain/collectionPayroll.ts';

type CollectionRouteContext = {
  database: AppDatabase;
  events: EventHub;
  request: IncomingMessage;
  response: ServerResponse;
  user: AuthenticatedUser;
  url: URL;
  method: string;
  correlationId: string;
};

function publish(events: EventHub, sequences: unknown) {
  if (!Array.isArray(sequences)) return;
  for (const sequence of sequences) events.publish(Number(sequence));
}

export async function routeCollections(context: CollectionRouteContext) {
  const { database, events, request, response, user, url, method, correlationId } = context;
  const cancelApproval = url.pathname.match(/^\/api\/collections\/(submissions|unlinked-receipts)\/([^/]+)\/cancel-approval$/);
  if (method === 'POST' && cancelApproval) {
    const data = cancelCollectionApproval(database, user, decodePathSegment(cancelApproval[2]), await readJson(request), correlationId, cancelApproval[1] === 'submissions' ? 'linked' : 'unlinked');
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/collections/mine') {
    sendJson(response, 200, { ok: true, data: employeeCollectionWorkspace(database, user, url) });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/collections/workspace') {
    sendJson(response, 200, { ok: true, data: collectionWorkspace(database, user, url) });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/collections') {
    requirePermission(user, 'collections.read');
    sendJson(response, 200, { ok: true, data: listCollections(database, user) });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/collections/payroll') {
    requirePermission(user, 'collections.read');
    sendJson(response, 200, { ok: true, data: listCollectionPayroll(database, user) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/collections/payroll/entries') {
    const data = createCollectionPayrollEntry(database, user, await readJson(request), correlationId);
    publish(events, data.eventSequences);
    sendJson(response, 201, { ok: true, data });
    return true;
  }
  const payrollSalary = url.pathname.match(/^\/api\/collections\/payroll\/employees\/([^/]+)\/salary$/);
  if (method === 'PUT' && payrollSalary) {
    const data = updateCollectionPayrollSalary(
      database, user, decodePathSegment(payrollSalary[1]), await readJson(request), correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }
  const payrollConfirmation = url.pathname.match(/^\/api\/collections\/payroll\/entries\/([^/]+)\/confirm$/);
  if (method === 'POST' && payrollConfirmation) {
    requirePermission(user, 'collections.read');
    const data = confirmCollectionPayrollEntry(
      database, user, decodePathSegment(payrollConfirmation[1]), correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/collections/assignees') {
    if (user.role !== 'admin') throw forbidden('collections.review');
    sendJson(response, 200, {
      ok: true,
      data: listCollectionAssignees(database, user.organizationId),
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/collections/assignments') {
    const data = assignCustomers(database, user, await readJson(request), correlationId);
    publish(events, data.eventSequences);
    sendJson(response, 201, { ok: true, data });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/collections/unlinked-receipts') {
    requirePermission(user, 'collections.write');
    const data = createUnlinkedCollectionReceipt(database,user,await readJson(request),correlationId);
    publish(events,data.eventSequences);
    sendJson(response,201,{ok:true,data});
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/collections/link-candidates') {
    sendJson(response,200,{ok:true,data:collectionLinkCandidates(database,user,url.searchParams.get('q'))});
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/collections/days/close') {
    const data = closeCollectionDay(database, user, await readJson(request), correlationId);
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  const submission = url.pathname.match(/^\/api\/collections\/assignments\/([^/]+)\/submissions$/);
  if (method === 'POST' && submission) {
    requirePermission(user, 'collections.write');
    const data = submitCollection(
      database,
      user,
      decodePathSegment(submission[1]),
      await readJson(request),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 201, { ok: true, data });
    return true;
  }

  const decision = url.pathname.match(/^\/api\/collections\/submissions\/([^/]+)\/decision$/);
  if (method === 'POST' && decision) {
    const data = decideCollection(
      database,
      user,
      decodePathSegment(decision[1]),
      await readJson(request),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  const cashReceived = url.pathname.match(
    /^\/api\/collections\/submissions\/([^/]+)\/cash-received$/,
  );
  if (method === 'POST' && cashReceived) {
    const data = markCollectionCashReceived(
      database,
      user,
      decodePathSegment(cashReceived[1]),
      correlationId,
    );
    publish(events, data.eventSequences);
    sendJson(response, 200, { ok: true, data });
    return true;
  }

  const unlinkedDecision=url.pathname.match(/^\/api\/collections\/unlinked-receipts\/([^/]+)\/decision$/);
  if(method==='POST'&&unlinkedDecision){
    const data=decideUnlinkedCollectionReceipt(database,user,decodePathSegment(unlinkedDecision[1]),await readJson(request),correlationId);
    publish(events,data.eventSequences);
    sendJson(response,200,{ok:true,data});
    return true;
  }

  const unlinkedCash=url.pathname.match(/^\/api\/collections\/unlinked-receipts\/([^/]+)\/cash-received$/);
  if(method==='POST'&&unlinkedCash){
    const data=markUnlinkedCollectionCashReceived(database,user,decodePathSegment(unlinkedCash[1]),correlationId);
    publish(events,data.eventSequences);
    sendJson(response,200,{ok:true,data});
    return true;
  }

  return false;
}
