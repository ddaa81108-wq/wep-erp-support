import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import { reportsDashboard } from '../domain/reports/reports.ts';
import { reportActivity, reportOverview, reportSourceDetails } from '../domain/reports/reportOverview.ts';
import { requirePermission } from '../http/guards.ts';
import { sendJson } from '../http/io.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';

type Context = {
  database: AppDatabase;
  request: IncomingMessage;
  response: ServerResponse;
  user: AuthenticatedUser;
  url: URL;
  method: string;
};

export async function routeReports({ database, response, user, url, method }: Context) {
  if (method === 'GET' && ['/api/reports/overview', '/api/reports/activity', '/api/reports/sources'].includes(url.pathname)) {
    requirePermission(user, 'reports.read');
    sendJson(response, 200, { ok: true, data: url.pathname.endsWith('/overview')
      ? reportOverview(database, user.organizationId) : url.pathname.endsWith('/sources')
        ? reportSourceDetails(database, user.organizationId, url) : reportActivity(database, user.organizationId, url) });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/reports') {
    requirePermission(user, 'reports.read');
    sendJson(response, 200, { ok: true, data: reportsDashboard(database, user.organizationId, url) });
    return true;
  }
  return false;
}
