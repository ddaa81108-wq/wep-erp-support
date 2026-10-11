import type { IncomingMessage, ServerResponse } from 'node:http';
import { createEmergencyBackup, stageRestore, requireBackupOwner } from '../domain/emergencyBackup.ts';
import type { AppDatabase } from '../db/database.ts';
import { createEmployee, listUsers, updateEmployee } from '../domain/users.ts';
import { forbidden } from '../http/errors.ts';
import { readJson, sendJson } from '../http/io.ts';
import { decodePathSegment } from '../http/web.ts';
import { decideAccountRequest, listAccountRequests } from '../modules/accounts/accountRequests.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { getOrganizationSettings, updateOrganizationSettings } from '../domain/organizationSettings.ts';
import { listOrganizationSessions, listTechnicalEvents, operationsSnapshot, revokeOrganizationSession } from '../domain/operationsCenter.ts';
import { getNotificationPreferences, listNotifications, markAllNotificationsRead, markNotificationRead, updateNotificationPreferences } from '../domain/notifications.ts';

type UserManagementRouteContext = {
  database: AppDatabase;
  request: IncomingMessage;
  response: ServerResponse;
  user: AuthenticatedUser;
  url: URL;
  method: string;
  correlationId: string;
};

function requireAdmin(user: AuthenticatedUser) {
  if (user.role !== 'admin') throw forbidden('users.manage');
}

export async function routeUserManagement(context: UserManagementRouteContext) {
  const { database, request, response, user, url, method, correlationId } = context;
  if (method === 'POST' && url.pathname === '/api/operations/backup/emergency') {
    sendJson(response, 200, { ok: true, data: await createEmergencyBackup(database, user) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/operations/backup/restore') {
    requireBackupOwner(database, user);
    sendJson(response, 202, { ok: true, data: stageRestore(database, user, await readJson(request, 68 * 1024 * 1024)) });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/notifications') {
    sendJson(response,200,{ok:true,data:listNotifications(database,user,url)});
    return true;
  }
  const notificationRead=url.pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if(method==='PATCH'&&notificationRead){
    sendJson(response,200,{ok:true,data:markNotificationRead(database,user,Number(notificationRead[1]))});
    return true;
  }
  if(method==='POST'&&url.pathname==='/api/notifications/read-all'){
    sendJson(response,200,{ok:true,data:markAllNotificationsRead(database,user)});
    return true;
  }
  if(method==='GET'&&url.pathname==='/api/notification-preferences'){
    sendJson(response,200,{ok:true,data:getNotificationPreferences(database,user)});
    return true;
  }
  if(method==='PATCH'&&url.pathname==='/api/notification-preferences'){
    sendJson(response,200,{ok:true,data:updateNotificationPreferences(database,user,await readJson(request))});
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/users') {
    requireAdmin(user);
    sendJson(response, 200, { ok: true, data: listUsers(database, user.organizationId) });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/operations/health') {
    requireAdmin(user);
    sendJson(response, 200, { ok: true, data: operationsSnapshot(database, user) });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/operations/sessions') {
    requireAdmin(user);
    sendJson(response, 200, { ok: true, data: listOrganizationSessions(database, user) });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/operations/errors') {
    requireAdmin(user);
    sendJson(response, 200, { ok: true, data: listTechnicalEvents(database, user) });
    return true;
  }
  const sessionRoute = url.pathname.match(/^\/api\/operations\/sessions\/([^/]+)\/revoke$/);
  if (method === 'POST' && sessionRoute) {
    requireAdmin(user);
    const result = revokeOrganizationSession(database, user, decodePathSegment(sessionRoute[1]), correlationId);
    sendJson(response, 200, { ok: true, data: result });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/organization-settings') {
    requireAdmin(user);
    sendJson(response, 200, {
      ok: true,
      data: { settings: getOrganizationSettings(database, user.organizationId) },
    });
    return true;
  }

  if (method === 'PATCH' && url.pathname === '/api/organization-settings') {
    requireAdmin(user);
    const settings = updateOrganizationSettings(
      database, user, await readJson(request), correlationId,
    );
    sendJson(response, 200, { ok: true, data: { settings } });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/account-requests') {
    requireAdmin(user);
    sendJson(response, 200, {
      ok: true,
      data: listAccountRequests(database, user.organizationId),
    });
    return true;
  }

  const accountRequest = url.pathname.match(/^\/api\/account-requests\/([^/]+)\/decision$/);
  if (method === 'POST' && accountRequest) {
    requireAdmin(user);
    const decided = await decideAccountRequest(
      database,
      user,
      decodePathSegment(accountRequest[1]),
      await readJson(request),
      correlationId,
    );
    sendJson(response, 200, { ok: true, data: { request: decided } });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/users') {
    requireAdmin(user);
    const employee = await createEmployee(database, user, await readJson(request), correlationId);
    sendJson(response, 201, { ok: true, data: { user: employee } });
    return true;
  }

  const employee = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  if (method === 'PATCH' && employee) {
    requireAdmin(user);
    const updated = await updateEmployee(
      database,
      user,
      decodePathSegment(employee[1]),
      await readJson(request),
      correlationId,
    );
    sendJson(response, 200, { ok: true, data: { user: updated } });
    return true;
  }

  return false;
}
