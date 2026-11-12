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
  const ids=items.filter(item=>item.section==='customers'||item.section==='companies').map(item=>item.id);
  const assignments=ids.length ? database.prepare(`SELECT a.id,a.customer_id,u.display_name
    FROM debt_assignments a JOIN customers c ON c.id=a.customer_id JOIN users u ON u.id=a.assignee_user_id
    WHERE a.status='active' AND c.organization_id=? AND u.organization_id=?
      AND a.customer_id IN (${ids.map(()=>'?').join(',')})`).all(user.organizationId,user.organizationId,...ids) : [];
  const assigned=new Map(assignments.map(row=>[String(row.customer_id),row]));
  sendJson(response, 200, { ok: true, data: { items:items.map(item=>({...item,
    activeAssignmentId:assigned.has(item.id)?String(assigned.get(item.id)!.id):null,
    activeAssigneeName:assigned.has(item.id)?String(assigned.get(item.id)!.display_name):null,
  })) } });
}
