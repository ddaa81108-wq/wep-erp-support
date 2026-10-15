import type { AppDatabase } from '../db/database.ts';
import { inImmediateTransaction } from '../db/database.ts';
import type { AuthenticatedUser } from '../security/sessions.ts';
import {
  MERCHANTS,
  ensureMerchant,
  ensureOpenDay,
  integer,
  mapDay,
  mapEntry,
  merchantKey,
} from './purchaseSupport.ts';

export function listPurchases(
  db: AppDatabase,
  actor: AuthenticatedUser,
  keyValue: unknown,
  beforeValue: unknown,
  limitValue: unknown,
) {
  const key = merchantKey(keyValue);
  let merchant = db
    .prepare('SELECT * FROM purchase_merchants WHERE organization_id=? AND merchant_key=?')
    .get(actor.organizationId, key) as Record<string, unknown> | undefined;
  let day = merchant
    ? (db
        .prepare("SELECT * FROM purchase_days WHERE organization_id=? AND merchant_id=? AND status='draft'")
        .get(actor.organizationId, String(merchant.id)) as Record<string, unknown> | undefined)
    : undefined;
  // الفتح المعتاد قراءة فقط؛ لا نأخذ قفل كتابة مع كل تحديث خلفي.
  if (!merchant || !day) {
    ({ merchant, day } = inImmediateTransaction(db, () => {
      const readyMerchant = ensureMerchant(db, actor.organizationId, key, actor.id);
      return {
        merchant: readyMerchant,
        day: ensureOpenDay(db, actor.organizationId, readyMerchant, actor.id),
      };
    }));
  }
  const limit = Math.min(200, Math.max(20, Number(limitValue ?? 100) || 100));
  const before =
    beforeValue === undefined || beforeValue === null || beforeValue === ''
      ? Number.MAX_SAFE_INTEGER
      : integer(beforeValue, 'مؤشر السجل');
  const rows = db
    .prepare(
      `SELECT e.*,d.day_number,d.business_date,d.status day_status,d.version day_version,d.correction_open,d.total_debt_units day_closing_debt_units,u.display_name actor_name,u.is_owner actor_is_owner
      FROM purchase_entries e JOIN purchase_days d ON d.id=e.day_id JOIN users u ON u.id=e.actor_user_id
      WHERE e.organization_id=? AND e.merchant_id=? AND e.deleted_at IS NULL AND e.sequence<?
      ORDER BY e.sequence DESC LIMIT ?`,
    )
    .all(actor.organizationId, String(merchant!.id), before, limit + 1) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const oldestSequence = page.length ? Math.min(...page.map((row) => Number(row.sequence))) : null;
  const lifetime = db.prepare(`
    SELECT
      COALESCE(SUM(e.result_units),0) AS result_units,
      COALESCE(SUM(e.paid_units),0) AS paid_units,
      COALESCE(SUM(e.vodafone_consumed_units),0) AS vodafone_consumed_units
    FROM purchase_entries e
    WHERE e.organization_id=? AND e.merchant_id=? AND e.deleted_at IS NULL
  `).get(actor.organizationId, String(merchant!.id)) as Record<string, unknown>;
  return {
    merchant: { key, name: MERCHANTS[key] },
    day: mapDay(day!),
    entries: page.reverse().map(mapEntry),
    nextBefore: hasMore ? oldestSequence : null,
    registerTotals: {
      resultUnits: Number(lifetime.result_units),
      paidUnits: Number(lifetime.paid_units),
      remainingUnits: Number(day!.total_debt_units),
      vodafoneConsumedUnits: Number(lifetime.vodafone_consumed_units),
      vodafoneRemainingUnits: Number(day!.vodafone_remaining_units),
    },
  };
}
