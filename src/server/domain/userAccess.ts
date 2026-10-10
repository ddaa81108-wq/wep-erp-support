import type { AppDatabase } from '../db/database.ts';
import { badRequest } from '../http/errors.ts';
import {
  ASSIGNABLE_PERMISSIONS,
  type SectionAccessLevel,
} from '../../shared/sections.ts';

export type ResolvedUserAccess = {
  assigned: string[];
  customerDebts: SectionAccessLevel;
  companyDebts: SectionAccessLevel;
  libyanDeposits: SectionAccessLevel;
  egyptianDeposits: SectionAccessLevel;
  masraweya: SectionAccessLevel;
  purchases: SectionAccessLevel;
  treasury: SectionAccessLevel;
  reports: SectionAccessLevel;
};

function permissions(value: unknown) {
  if (!Array.isArray(value)) throw badRequest('INVALID_PERMISSIONS', 'قائمة الصلاحيات غير صالحة.');
  const unique = [...new Set(value.map(String))];
  if (unique.some((permission) =>
    !ASSIGNABLE_PERMISSIONS.includes(permission as (typeof ASSIGNABLE_PERMISSIONS)[number]))) {
    throw badRequest('INVALID_PERMISSIONS', 'تحتوي القائمة على صلاحية غير قابلة للتعيين.');
  }
  if (unique.includes('debts.write') && !unique.includes('debts.read')) unique.push('debts.read');
  return unique.sort();
}

function requestedAccess(
  input: Record<string, unknown>,
  field: string,
  assigned: string[],
  readPermission: string,
  writePermission: string,
  message: string,
): SectionAccessLevel {
  const requested = input[field];
  if (requested !== undefined && requested !== 'none' && requested !== 'read' && requested !== 'manage') {
    throw badRequest('INVALID_SECTION_ACCESS', message);
  }
  if (requested === 'manage' || assigned.includes(writePermission)) return 'manage';
  if (requested === 'read' || assigned.includes(readPermission)) return 'read';
  return 'none';
}

function permissionsFor(level: SectionAccessLevel, read: string, write: string) {
  if (level === 'manage') return [read, write];
  if (level === 'read') return [read];
  return [];
}

export function resolveUserAccess(input: Record<string, unknown>): ResolvedUserAccess {
  const requested = permissions(input.permissions ?? []);
  const customerDebts = requestedAccess(input, 'customerDebtsAccess', requested, 'debts.read', 'debts.write', 'صلاحية قسم ديون العملاء غير صالحة.');
  const companyDebts = requestedAccess(input, 'companyDebtsAccess', requested, 'companies.read', 'companies.write', 'صلاحية قسم ديون الشركات غير صالحة.');
  const libyanDeposits = requestedAccess(input, 'libyanDepositsAccess', requested, 'libyan_deposits.read', 'libyan_deposits.write', 'صلاحية قسم الأمانات غير صالحة.');
  const egyptianDeposits = requestedAccess(input, 'egyptianDepositsAccess', requested, 'egyptian_deposits.read', 'egyptian_deposits.write', 'صلاحية قسم الأمانات غير صالحة.');
  const masraweya = requestedAccess(input, 'masraweyaAccess', requested, 'masraweya.read', 'masraweya.write', 'صلاحية قسم المصراوية غير صالحة.');
  const purchases = requestedAccess(input, 'purchasesAccess', requested, 'purchases.read', 'purchases.write', 'صلاحية قسم المشتريات غير صالحة.');
  const treasury = requestedAccess(input, 'treasuryAccess', requested, 'treasury.read', 'treasury.write', 'صلاحية قسم الخزينة غير صالحة.');
  const reports = requestedAccess(input, 'reportsAccess', requested, 'reports.read', 'reports.read', 'صلاحية قسم التقارير غير صالحة.');
  const collectionPermissions = requested.filter((permission) => permission.startsWith('collections.'));
  if (collectionPermissions.includes('collections.write') && !collectionPermissions.includes('collections.read')) {
    collectionPermissions.push('collections.read');
  }
  return {
    assigned: [
      ...permissionsFor(customerDebts, 'debts.read', 'debts.write'),
      ...permissionsFor(companyDebts, 'companies.read', 'companies.write'),
      ...permissionsFor(libyanDeposits, 'libyan_deposits.read', 'libyan_deposits.write'),
      ...permissionsFor(egyptianDeposits, 'egyptian_deposits.read', 'egyptian_deposits.write'),
      ...collectionPermissions,
      ...permissionsFor(masraweya, 'masraweya.read', 'masraweya.write'),
      ...permissionsFor(purchases, 'purchases.read', 'purchases.write'),
      ...permissionsFor(treasury, 'treasury.read', 'treasury.write'),
      ...(reports === 'none' ? [] : ['reports.read']),
    ].sort(),
    customerDebts,
    companyDebts,
    libyanDeposits,
    egyptianDeposits,
    masraweya,
    purchases,
    treasury,
    reports,
  };
}

export function persistUserAccess(
  database: AppDatabase,
  userId: string,
  access: ResolvedUserAccess,
  updatedAt: string,
) {
  const insertPermission = database.prepare(
    'INSERT INTO user_permissions(user_id, permission, allowed, updated_at) VALUES (?, ?, 1, ?)',
  );
  for (const permission of access.assigned) insertPermission.run(userId, permission, updatedAt);
  const insertSection = database.prepare(
    'INSERT INTO user_section_access(user_id, section_key, access_level, updated_at) VALUES (?, ?, ?, ?)',
  );
  const sections = [
    ['customer_debts', access.customerDebts],
    ['company_debts', access.companyDebts],
    ['libyan_deposits', access.libyanDeposits],
    ['egyptian_deposits', access.egyptianDeposits],
    ['masraweya', access.masraweya],
    ['purchases', access.purchases],
    ['treasury', access.treasury],
    ['reports', access.reports],
  ] as const;
  for (const [sectionKey, level] of sections) {
    if (level !== 'none') insertSection.run(userId, sectionKey, level, updatedAt);
  }
}
