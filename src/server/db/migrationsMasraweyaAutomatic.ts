import type { Migration } from './migrationTypes.ts';

export const masraweyaAutomaticMigrations: Migration[] = [
  {
    version: 44,
    name: 'masraweya-automatic-carry-preserving-historical-openings',
    sql: `ALTER TABLE masraweya_days ADD COLUMN carry_adjustment_units INTEGER NOT NULL DEFAULT 0;`,
    after(database) {
      // Retain every historical opening and entry. Record old manual differences
      // as offsets so a later correction can propagate without erasing them.
      const previousByOrganization = new Map<string, bigint>();
      const update = database.prepare('UPDATE masraweya_days SET carry_adjustment_units=? WHERE id=?');
      const days = database
        .prepare(
          `SELECT d.id,d.organization_id,d.previous_value_units,d.purchases_units,
      COALESCE((SELECT SUM(value_units+commission_units) FROM masraweya_entries WHERE day_id=d.id),0) AS work
      FROM masraweya_days d ORDER BY organization_id,business_date`,
        )
        .all();
      for (const day of days) {
        const organization = String(day.organization_id);
        const opening = BigInt(String(day.previous_value_units));
        const adjustment = opening - (previousByOrganization.get(organization) ?? 0n);
        if (adjustment > BigInt(Number.MAX_SAFE_INTEGER) || adjustment < BigInt(Number.MIN_SAFE_INTEGER)) {
          throw new Error(
            'Historical Masraweya opening difference exceeds the safe range; manual review required.',
          );
        }
        update.run(Number(adjustment), String(day.id));
        previousByOrganization.set(
          organization,
          opening + BigInt(String(day.purchases_units)) - BigInt(String(day.work)),
        );
      }
    },
  },
];
