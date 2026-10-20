import type { AppDatabase } from '../db/database.ts';
import { badRequest, notFound } from '../http/errors.ts';
import { partyProfile, type DebtPartyKind } from './customerProfiles.ts';

export type CustomerAccount = {
  id: string;
  name: string;
  phone: string | null;
  version: number;
  cycleId: string;
  isPinned: boolean;
  inactiveSince: string | null;
  currentBalanceUnits: number;
  debtStartedAt: string | null;
  systemLinkKey: string | null;
};

export function customerAccount(
  database: AppDatabase,
  customerId: string,
  organizationId: string,
  kind: DebtPartyKind = 'customer',
): CustomerAccount {
  const profile = partyProfile(kind);
  const row = database.prepare(`
    SELECT c.id, c.name, c.phone, c.version, c.is_pinned, c.inactive_since,c.system_link_key,
      c.current_balance_units, c.debt_started_at,
      cy.id AS cycle_id
    FROM customers c
    JOIN customer_cycles cy ON cy.customer_id = c.id AND cy.status = 'active'
    WHERE c.id = ? AND c.organization_id = ? AND c.section_key = ? AND c.deleted_at IS NULL
  `).get(customerId, organizationId, profile.sectionKey) as Record<string, unknown> | undefined;
  if (!row) throw notFound(profile.missing);
  return {
    id: String(row.id),
    name: String(row.name),
    phone: row.phone ? String(row.phone) : null,
    version: Number(row.version),
    cycleId: String(row.cycle_id),
    isPinned: Number(row.is_pinned) === 1,
    inactiveSince: row.inactive_since ? String(row.inactive_since) : null,
    currentBalanceUnits: Number(row.current_balance_units),
    debtStartedAt: row.debt_started_at ? String(row.debt_started_at) : null,
    systemLinkKey: row.system_link_key ? String(row.system_link_key) : null,
  };
}

export function customerBalance(database: AppDatabase, cycleId: string) {
  const initial = database.prepare('SELECT initial_balance_units FROM customer_cycles WHERE id=?').get(cycleId);
  if (!initial) return 0;
  let balance = BigInt(initial.initial_balance_units as number);
  const entries = database.prepare(`SELECT entry_type,amount_units,conversion_rate_micros FROM debt_transactions
    WHERE cycle_id=? AND deleted_at IS NULL AND transaction_status='posted'`);
  entries.setReadBigInts(true);
  for (const row of entries.iterate(cycleId)) {
    const amount = (row.amount_units as bigint) * (row.conversion_rate_micros as bigint) / 1_000_000n;
    balance += row.entry_type === 'debt' ? amount : -amount;
  }
  if (balance > BigInt(Number.MAX_SAFE_INTEGER) || balance < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw badRequest('BALANCE_OUT_OF_RANGE', 'إجمالي الرصيد تجاوز نطاق الحساب المالي الآمن.');
  }
  return Number(balance);
}
