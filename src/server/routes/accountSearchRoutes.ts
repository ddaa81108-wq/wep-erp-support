import type { ServerResponse } from 'node:http';
import type { AppDatabase } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import { similarCustomers } from '../domain/customerQueries.ts';
import { sendJson } from '../http/io.ts';

/** Same search rules/order as the four section endpoints, with independent permissions. */
export function routeAccountSearch(
  database: AppDatabase,
  user: AuthenticatedUser,
  url: URL,
  response: ServerResponse,
) {
  const sections = [
    ['customers', 'customer', 'debts.read'],
    ['companies', 'company', 'companies.read'],
    ['libyan-deposits', 'depositLyd', 'libyan_deposits.read'],
    ['egyptian-deposits', 'depositEgp', 'egyptian_deposits.read'],
  ] as const;
  const items = sections
    .flatMap(([section, kind, permission]) => {
      if (user.role !== 'admin' && !user.permissions.has(permission)) return [];
      return similarCustomers(database, url, user.organizationId, kind).items.map((item) => ({
        ...item,
        section,
      }));
    })
    .slice(0, 12);
  sendJson(response, 200, { ok: true, data: { items } });
}
