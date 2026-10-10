import type { AppDatabase } from '../db/database.ts';
import { nowIso } from '../db/database.ts';

export type LinkedAccountKey = 'masraweya_remainder' | 'purchases_vodafone_remainder';

const definitions: Record<LinkedAccountKey, { idPrefix: string; name: string; normalized: string }> = {
  masraweya_remainder: {
    idPrefix: 'system-egp-masraweya',
    name: 'قسم المصراوية',
    normalized: '__system_egp_masraweya__',
  },
  purchases_vodafone_remainder: {
    idPrefix: 'system-egp-vodafone',
    name: 'فودافون قسم المشتريات',
    normalized: '__system_egp_vodafone__',
  },
};

function ensureLinkedAccount(
  database: AppDatabase,
  organizationId: string,
  key: LinkedAccountKey,
  timestamp: string,
) {
  const definition = definitions[key];
  const id = `${definition.idPrefix}:${organizationId}`;
  const cycleId = `${definition.idPrefix}-cycle:${organizationId}`;
  database.prepare(`
    INSERT INTO customers(
      id,name,normalized_name,phone,account_type,organization_id,is_pinned,inactive_since,
      ledger_next_sequence,section_key,current_balance_units,debt_started_at,financial_updated_at,
      version,created_at,updated_at,system_link_key
    ) VALUES(?,?,?,NULL,'customer',?,1,?,1,'egyptian_deposits',0,NULL,?,1,?,?,?)
    ON CONFLICT DO NOTHING
  `).run(
    id, definition.name, definition.normalized, organizationId, timestamp, timestamp,
    timestamp, timestamp, key,
  );
  const row = database.prepare(`
    SELECT id FROM customers WHERE organization_id=? AND system_link_key=?
  `).get(organizationId, key) as { id: string };
  database.prepare(`
    INSERT INTO customer_cycles(
      id,customer_id,status,start_date,initial_balance_units,currency,created_at,updated_at
    ) VALUES(?,?,'active',?,0,'EGP',?,?) ON CONFLICT(id) DO NOTHING
  `).run(cycleId, row.id, timestamp, timestamp, timestamp);
  return row.id;
}

function masraweyaRemainder(database: AppDatabase, organizationId: string) {
  const row = database.prepare(`
    SELECT d.previous_value_units + d.purchases_units - COALESCE((
      SELECT SUM(e.value_units + e.commission_units)
      FROM masraweya_entries e WHERE e.day_id=d.id
    ),0) AS value
    FROM masraweya_days d WHERE d.organization_id=?
    ORDER BY d.business_date DESC,d.updated_at DESC LIMIT 1
  `).get(organizationId) as { value: number } | undefined;
  return Number(row?.value ?? 0);
}

function purchasesVodafoneRemainder(database: AppDatabase, organizationId: string) {
  const row = database.prepare(`
    SELECT COALESCE(SUM(d.vodafone_remaining_units),0) AS value
    FROM purchase_days d
    WHERE d.organization_id=? AND d.day_number=(
      SELECT MAX(latest.day_number) FROM purchase_days latest
      WHERE latest.organization_id=d.organization_id AND latest.merchant_id=d.merchant_id
    )
  `).get(organizationId) as { value: number };
  return Number(row.value);
}

export function syncEgyptianLinkedAccounts(
  database: AppDatabase,
  organizationId: string,
  actorUserId: string,
) {
  const timestamp = nowIso();
  const balances: Record<LinkedAccountKey, number> = {
    masraweya_remainder: masraweyaRemainder(database, organizationId),
    purchases_vodafone_remainder: purchasesVodafoneRemainder(database, organizationId),
  };
  const eventSequences: number[] = [];
  for (const key of Object.keys(balances) as LinkedAccountKey[]) {
    const accountId = ensureLinkedAccount(database, organizationId, key, timestamp);
    const current = database.prepare(`
      SELECT current_balance_units FROM customers WHERE id=?
    `).get(accountId) as { current_balance_units: number };
    const balance = balances[key];
    if (!Number.isSafeInteger(balance)) throw new Error('Linked EGP balance exceeded the safe integer range.');
    if (Number(current.current_balance_units) === balance) continue;
    database.prepare(`
      UPDATE customers SET current_balance_units=?,version=version+1,
        financial_updated_at=?,updated_at=?,inactive_since=CASE WHEN ?=0 THEN ? ELSE NULL END
      WHERE id=? AND system_link_key=?
    `).run(balance, timestamp, timestamp, balance, timestamp, accountId, key);
    const result = database.prepare(`
      INSERT INTO event_log(topic,aggregate_id,actor_user_id,organization_id,payload_json,created_at)
      VALUES('egyptian-deposit.changed',?,?,?,?,?)
    `).run(accountId, actorUserId, organizationId, JSON.stringify({
      action: 'system-linked-balance',
      systemLinkKey: key,
      balanceUnits: balance,
    }), timestamp);
    eventSequences.push(Number(result.lastInsertRowid));
  }
  return { balances, eventSequences };
}

export function linkedAccountBalance(database: AppDatabase, organizationId: string, key: string) {
  if (key === 'masraweya_remainder') return masraweyaRemainder(database, organizationId);
  if (key === 'purchases_vodafone_remainder') return purchasesVodafoneRemainder(database, organizationId);
  return null;
}
