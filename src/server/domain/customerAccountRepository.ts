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
  const row = database.prepare(`
    SELECT c.initial_balance_units + COALESCE(SUM(
      CASE t.entry_type
        WHEN 'debt' THEN (t.amount_units * t.conversion_rate_micros) / 1000000
        WHEN 'payment' THEN -((t.amount_units * t.conversion_rate_micros) / 1000000)
      END
    ), 0) AS balance_units
    FROM customer_cycles c
    LEFT JOIN debt_transactions t ON t.cycle_id = c.id
      AND t.deleted_at IS NULL AND t.transaction_status = 'posted'
    WHERE c.id = ? GROUP BY c.id
  `).get(cycleId) as { balance_units: number } | undefined;
  if (!row) return 0;
  const balance = Number(row.balance_units);
  if (!Number.isSafeInteger(balance)) {
    throw badRequest('BALANCE_OUT_OF_RANGE', 'إجمالي الرصيد تجاوز نطاق الحساب المالي الآمن.');
  }
  return balance;
}
