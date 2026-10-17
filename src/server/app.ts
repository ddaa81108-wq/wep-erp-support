import { startDatabaseActivity, databaseActivity, validActivityDay, activityToday } from './db/databaseActivity.ts';
import { BUILD_INFO } from '../shared/buildInfo.ts';
import { withoutDatabaseMeasurement } from './db/databaseInstrumentation.ts';
import { databaseMonitor } from './domain/databaseMonitor.ts';
import { requireBackupOwner } from './domain/emergencyBackup.ts';
import { createPushDispatcher, type PushTransport } from './domain/browserPush.ts';
import { routeBrowserPush } from './routes/browserPushRoutes.ts';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname } from 'node:path';
import type { AppDatabase } from './db/database.ts';
import { nowIso } from './db/database.ts';
import type { ServerConfig } from './config.ts';
import { API_VERSION, SCHEMA_VERSION, UI_VERSION } from './config.ts';
import { EventHub } from './events.ts';
import { HttpError, badRequest, forbidden, unauthorized } from './http/errors.ts';
import { sendJson } from './http/io.ts';
import { applyBrowserSecurityHeaders, serveWebAsset } from './http/web.ts';
import { eventCursor } from './http/fields.ts';
import { requireMutationSafety, requireUser } from './http/guards.ts';
import { InternetGate } from './internetGate.ts';
import { routeFinancialWork } from './routes/financialWorkRoutes.ts';
import { routeTreasury } from './routes/treasuryRoutes.ts';
import { routeCollections } from './routes/collectionRoutes.ts';
import { routeUserManagement } from './routes/userManagementRoutes.ts';
import { routeCustomers } from './routes/customerRoutes.ts';
import { routeCompanies } from './routes/companyRoutes.ts';
import { routeDeposits } from './routes/depositRoutes.ts';
import { routeAuthenticatedAccount, routePublicAccount } from './routes/accountRoutes.ts';
import { routeReports } from './routes/reportRoutes.ts';
import { startReportScheduler } from './domain/reports/reportScheduler.ts';
import { recordTechnicalError } from './domain/operationsCenter.ts';
import { authenticate } from './security/sessions.ts';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
async function route(
  database: AppDatabase,
  config: ServerConfig,
  events: EventHub,
  request: IncomingMessage,
  response: ServerResponse,
  correlationId: string,
) {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (method === 'GET' && !url.pathname.startsWith('/api/')) {
    if (await serveWebAsset(url.pathname, response)) return;
    if (!extname(url.pathname) && (await serveWebAsset('/', response))) return;
  }

  if (method === 'GET' && url.pathname === '/') {
    const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VIB Abdo Company</title>
  <style>
    :root{font-family:Tahoma,"Segoe UI",Arial,sans-serif;color:#1e293b;background:#f1f5f9}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
    main{width:min(680px,100%);background:#f8fafc;border:1px solid #cbd5e1;border-radius:24px;padding:32px;box-shadow:0 18px 50px #0f172a18}
    .mark{width:58px;height:58px;display:grid;place-items:center;border-radius:18px;background:#0f172a;color:#22d3ee;font-weight:900;font-size:21px}
    h1{margin:18px 0 8px;color:#0f172a}p{line-height:1.8;margin:8px 0}.status{display:flex;gap:10px;align-items:center;margin:22px 0;padding:14px 16px;border-radius:14px;background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}.dot{width:10px;height:10px;border-radius:50%;background:#10b981;box-shadow:0 0 0 5px #10b98120}
    code{direction:ltr;display:inline-block;background:#e2e8f0;padding:3px 7px;border-radius:7px}.note{color:#475569;font-size:14px;border-top:1px solid #cbd5e1;padding-top:18px;margin-top:24px}
  </style>
</head>
<body><main>
  <div class="mark" dir="ltr">AL</div>
  <h1>VIB Abdo Company</h1>
  <p>الخادم المحلي يعمل عبر اتصال HTTPS داخل الشبكة الخاصة.</p>
  <div class="status"><span class="dot"></span><strong>الخدمة جاهزة</strong></div>
  <p>إصدار API: <code>${API_VERSION}</code> · إصدار المخطط: <code>${SCHEMA_VERSION}</code></p>
  <p class="note">هذه واجهة حالة للمرحلة التأسيسية. واجهات ERP وAbdo Cash الكاملة ما زالت قيد التنفيذ، ولا ينبغي إدخال بيانات حقيقية قبل اكتمال اختبارات القبول.</p>
</main></body></html>`;
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    response.end(html);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/health') {
    const row = database.prepare('SELECT 1 AS ready').get() as { ready: number };
    return sendJson(response, 200, {
      ok: true,
      data: {
        status: Number(row.ready) === 1 ? 'ready' : 'unavailable',
        apiVersion: API_VERSION,
        schemaVersion: SCHEMA_VERSION,
        uiVersion: UI_VERSION,
        build: BUILD_INFO,
        time: nowIso(),
      },
    });
  }

  if (await routePublicAccount({
    database, config, request, response, url, method, correlationId,
  })) return;

  const user = requireUser(database, request);

  if (MUTATING_METHODS.has(method)) requireMutationSafety(request, user);

  if (await routeAuthenticatedAccount({
    database, config, request, response, url, method, correlationId, user,
  })) return;

  if (user.mustChangePassword) {
    throw new HttpError(
      403,
      'PASSWORD_CHANGE_REQUIRED',
      'يجب تغيير كلمة المرور المؤقتة قبل استخدام المنظومة.',
    );
  }

  if (method === 'GET' && ['/api/operations/database-activity/live','/api/operations/database-activity/daily'].includes(url.pathname)) {
    requireBackupOwner(database, user);
    const activity = databaseActivity(database);
    if (!activity) throw new HttpError(503, 'ACTIVITY_UNAVAILABLE', 'قياس النشاط غير متاح.');
    if (url.pathname.endsWith('/live')) return sendJson(response, 200, { ok: true, data: activity.live() });
    const day = url.searchParams.get('day') ?? activityToday();
    if (!validActivityDay(day)) throw badRequest('INVALID_ACTIVITY_DAY', 'اختر يومًا من آخر 30 يومًا بتوقيت ليبيا.');
    return sendJson(response, 200, { ok: true, data: activity.daily(day) });
  }
  if (method === 'GET' && url.pathname === '/api/operations/database-monitor') {
    requireBackupOwner(database, user);
    return sendJson(response, 200, { ok: true, data: await databaseMonitor(database, config) });
  }
  if (await routeBrowserPush(database,config,user,request,response,url)) return;

  if (method === 'GET' && url.pathname === '/api/events') {
    if (
      user.role !== 'admin' &&
      !user.permissions.has('debts.read') &&
      !user.permissions.has('companies.read') &&
      !user.permissions.has('libyan_deposits.read') &&
      !user.permissions.has('egyptian_deposits.read') &&
      !user.permissions.has('collections.read') &&
      !user.permissions.has('masraweya.read') &&
      !user.permissions.has('purchases.read') &&
      !user.permissions.has('treasury.read')
      && !user.permissions.has('reports.read')
    ) {
      throw forbidden('events.read');
    }
    const after = eventCursor(url.searchParams.get('after'));
    if (!events.attach(response, after, { userId: user.id, sessionTokenHash: user.sessionTokenHash })) {
      throw unauthorized();
    }
    return;
  }

  if (method === 'GET' && url.pathname === '/api/event-changes') {
    if (
      user.role !== 'admin' &&
      !user.permissions.has('debts.read') &&
      !user.permissions.has('companies.read') &&
      !user.permissions.has('libyan_deposits.read') &&
      !user.permissions.has('egyptian_deposits.read') &&
      !user.permissions.has('collections.read') &&
      !user.permissions.has('masraweya.read') &&
      !user.permissions.has('purchases.read') &&
      !user.permissions.has('treasury.read')
      && !user.permissions.has('reports.read')
    ) {
      throw forbidden('events.read');
    }
    const after = eventCursor(url.searchParams.get('after'));
    const changes = events.changesAfter(after, { userId: user.id, sessionTokenHash: user.sessionTokenHash });
    if (!changes) throw unauthorized();
    return sendJson(response, 200, { ok: true, data: changes });
  }

  if (
    await routeCustomers({
      database,
      events,
      request,
      response,
      user,
      url,
      method,
      correlationId,
    })
  )
    return;

  if (
    await routeFinancialWork({
      database,
      events,
      request,
      response,
      user,
      url,
      method,
      correlationId,
    })
  )
    return;

  if (
    await routeReports({ database, request, response, user, url, method })
  ) return;

  if (
    await routeTreasury({
      database,
      events,
      request,
      response,
      user,
      url,
      method,
      correlationId,
    })
  )
    return;

  if (
    await routeCompanies({
      database,
      events,
      request,
      response,
      user,
      url,
      method,
      correlationId,
    })
  )
    return;

  if (
    await routeCollections({
      database,
      events,
      request,
      response,
      user,
      url,
      method,
      correlationId,
    })
  )
    return;

  if (
    await routeUserManagement({
      config,
      database,
      request,
      response,
      user,
      url,
      method,
      correlationId,
    })
  )
    return;

  if (
    await routeDeposits({
      database,
      events,
      request,
      response,
      user,
      url,
      method,
      correlationId,
    })
  )
    return;

  throw new HttpError(404, 'ROUTE_NOT_FOUND', 'المسار المطلوب غير موجود.');
}

export function createApp(
  database: AppDatabase,
  config: ServerConfig,
  options: { internetCheck?: () => Promise<boolean>; pushSend?: PushTransport } = {},
) {
  const activity = startDatabaseActivity(database);
  const events = new EventHub(database);
  const stopReports = startReportScheduler(database);
  const pushDispatcher = createPushDispatcher(database, config, options.pushSend);
  const internetGate = new InternetGate(config);
  const internetCheck = options.internetCheck ?? (() => internetGate.isAvailable());
  const server = createServer(async (request, response) => {
    const correlationId = randomUUID();
    try {
      if (!(await internetCheck())) {
        response.destroy();
        return;
      }
      applyBrowserSecurityHeaders(response);
      response.setHeader('X-Correlation-Id', correlationId);
      const monitoring = (request.url ?? '').split('?')[0];
      if (monitoring === '/api/operations/database-monitor' || monitoring.startsWith('/api/operations/database-activity/')) {
        await withoutDatabaseMeasurement(() => route(database, config, events, request, response, correlationId));
      } else await route(database, config, events, request, response, correlationId);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const known = error instanceof HttpError;
      const status = known ? error.status : 500;
      const code = known ? error.code : 'INTERNAL_ERROR';
      const message = known ? error.message : 'حدث خطأ داخلي ولم تُعتمد العملية.';
      if (!known) {
        console.error(`[${correlationId}]`, error);
        try {
          recordTechnicalError(database, request, correlationId, error, authenticate(database, request));
        } catch {
          // Logging must never replace the original API error response.
        }
      }
      sendJson(response, status, {
        ok: false,
        error: {
          code,
          message,
          details: known ? error.details : undefined,
          correlationId,
        },
      });
    }
  }) as Server & { closeRealtimeConnections: () => void };
  server.closeRealtimeConnections = () => {
    stopReports();
    pushDispatcher.stop();
    events.close();
    activity.stop();
  };
  server.on('close', server.closeRealtimeConnections);
  return server;
}

export async function listen(server: Server, host: string, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
