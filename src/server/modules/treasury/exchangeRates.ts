import type { AppDatabase } from '../../db/database.ts';
import { inImmediateTransaction, nowIso } from '../../db/database.ts';
import { badRequest } from '../../http/errors.ts';
import type { AuthenticatedUser } from '../../security/sessions.ts';

const SECTION = 'egyptian_deposits';

export function getEgyptianDepositRate(database: AppDatabase, organizationId: string) {
  const row = database
    .prepare(
      `
    SELECT source_units_per_target_micros, updated_at
    FROM section_exchange_rates WHERE organization_id = ? AND section_key = ?
  `,
    )
    .get(organizationId, SECTION) as Record<string, unknown> | undefined;
  return {
    sourceCurrency: 'EGP',
    targetCurrency: 'LYD',
    egpPerLyd: row ? Number(row.source_units_per_target_micros) / 1_000_000 : null,
    updatedAt: row ? String(row.updated_at) : null,
    activeForTreasury: true,
  };
}

export function setEgyptianDepositRate(database: AppDatabase, actor: AuthenticatedUser, value: unknown) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000)
    throw badRequest('INVALID_EXCHANGE_RATE', 'سعر التحويل يجب أن يكون رقمًا موجبًا.');
  const micros = Math.round(rate * 1_000_000);
  return inImmediateTransaction(database, () => {
    const updatedAt = nowIso();
    database
      .prepare(
        `
    INSERT INTO section_exchange_rates(organization_id, section_key, source_currency, target_currency, source_units_per_target_micros, updated_by_user_id, updated_at)
    VALUES (?, ?, 'EGP', 'LYD', ?, ?, ?)
    ON CONFLICT(organization_id, section_key) DO UPDATE SET source_units_per_target_micros = excluded.source_units_per_target_micros,
      updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at
  `,
      )
      .run(actor.organizationId, SECTION, micros, actor.id, updatedAt);
    return {
      sourceCurrency: 'EGP',
      targetCurrency: 'LYD',
      egpPerLyd: micros / 1_000_000,
      updatedAt,
      activeForTreasury: true,
    };
  });
}
