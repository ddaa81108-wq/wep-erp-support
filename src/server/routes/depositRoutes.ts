import { depositKind, depositPermission, type DepositSection } from '../domain/deposits.ts';
import { requirePermission } from '../http/guards.ts';
import { readJson, sendJson } from '../http/io.ts';
import { getEgyptianDepositRate, setEgyptianDepositRate } from '../modules/treasury/exchangeRates.ts';
import { routePermanentAccounts, type PermanentAccountRouteContext } from './permanentAccountRoutes.ts';

export async function routeDeposits(context: PermanentAccountRouteContext) {
  const { database, request, response, user, url, method } = context;

  if (url.pathname === '/api/egyptian-deposits/exchange-rate' && method === 'GET') {
    requirePermission(user, 'egyptian_deposits.read');
    sendJson(response, 200, {
      ok: true,
      data: getEgyptianDepositRate(database, user.organizationId),
    });
    return true;
  }
  if (url.pathname === '/api/egyptian-deposits/exchange-rate' && method === 'PATCH') {
    requirePermission(user, 'egyptian_deposits.write');
    const input = await readJson(request);
    const { eventSequence, ...data } = setEgyptianDepositRate(database, user, input.egpPerLyd);
    context.events.publish(eventSequence);
    sendJson(response, 200, {
      ok: true,
      data,
    });
    return true;
  }

  const section = depositSection(url.pathname);
  if (!section) return false;
  return routePermanentAccounts(context, {
    basePath: `/api/${section}`,
    readPermission: depositPermission(section),
    writePermission: depositPermission(section, true),
    kind: depositKind(section),
  });
}

function depositSection(pathname: string): DepositSection | null {
  if (pathname === '/api/libyan-deposits' || pathname.startsWith('/api/libyan-deposits/')) {
    return 'libyan-deposits';
  }
  if (pathname === '/api/egyptian-deposits' || pathname.startsWith('/api/egyptian-deposits/')) {
    return 'egyptian-deposits';
  }
  return null;
}
