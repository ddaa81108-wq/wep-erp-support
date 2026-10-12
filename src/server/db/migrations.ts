import type { Migration } from './migrationTypes.ts';
import { foundationMigrations } from './migrationsFoundation.ts';
import { organizationMigrations } from './migrationsOrganization.ts';
import { financialMigrations } from './migrationsFinancial.ts';
import { reportMigrations } from './migrationsReports.ts';
import { settingsMigrations } from './migrationsSettings.ts';
import { payrollMigrations } from './migrationsPayroll.ts';
import { masraweyaCorrectionMigrations } from './migrationsMasraweyaCorrection.ts';

import { reliabilityMigrations } from './migrationsReliability.ts';
import { masraweyaAutomaticMigrations } from './migrationsMasraweyaAutomatic.ts';
import { collectionRejectionMigrations } from './migrationsCollectionRejection.ts';
import { zeroReviewMigrations } from './migrationsZeroReview.ts';

export type { Migration } from './migrationTypes.ts';

export const migrations: Migration[] = [
  ...foundationMigrations,
  ...organizationMigrations,
  ...financialMigrations,
  ...reportMigrations,
  ...settingsMigrations,
  ...payrollMigrations,
  ...masraweyaCorrectionMigrations,
  ...reliabilityMigrations,
  ...masraweyaAutomaticMigrations,
  ...zeroReviewMigrations,
  ...collectionRejectionMigrations,
];
