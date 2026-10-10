import type { AppDatabase } from '../db/database.ts';
import {
  ASSIGNABLE_PERMISSIONS,
  type SectionAccessLevel,
} from '../../shared/sections.ts';

const accessKey = (userId: unknown, sectionKey: unknown) => `${String(userId)}:${String(sectionKey)}`;

export function mapUser(
  row: Record<string, unknown>,
  userPermissions: string[],
  customerDebts: SectionAccessLevel = 'none',
  companyDebts: SectionAccessLevel = 'none',
  libyanDeposits: SectionAccessLevel = 'none',
  egyptianDeposits: SectionAccessLevel = 'none',
  masraweya: SectionAccessLevel = 'none',
  purchases: SectionAccessLevel = 'none',
  treasury: SectionAccessLevel = 'none',
  reports: SectionAccessLevel = 'none',
) {
  const id = String(row.id);
  const access = (level: SectionAccessLevel): SectionAccessLevel =>
    String(row.role) === 'admin' ? 'manage' : level;
  return {
    id,
    username: String(row.username),
    displayName: String(row.display_name),
    role: String(row.role),
    isOwner: Number(row.is_owner) === 1,
    isActive: Number(row.is_active) === 1,
    version: Number(row.version),
    email: row.email ? String(row.email) : null,
    mustChangePassword: Number(row.must_change_password) === 1,
    permissions: userPermissions,
    sectionAccess: {
      customerDebts: access(customerDebts),
      companyDebts: access(companyDebts),
      libyanDeposits: access(libyanDeposits),
      egyptianDeposits: access(egyptianDeposits),
      masraweya: access(masraweya),
      purchases: access(purchases),
      treasury: access(treasury),
      reports: access(reports),
    },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listUsers(database: AppDatabase, organizationId: string) {
  const rows = database.prepare(`
    SELECT * FROM users WHERE organization_id = ?
    ORDER BY role ASC, display_name COLLATE NOCASE ASC
  `).all(organizationId) as Record<string, unknown>[];
  const permissionRows = database.prepare(`
    SELECT p.user_id, p.permission FROM user_permissions p
    JOIN users u ON u.id = p.user_id
    WHERE p.allowed = 1 AND u.organization_id = ? ORDER BY p.permission
  `).all(organizationId) as Record<string, unknown>[];
  const byUser = new Map<string, string[]>();
  for (const permission of permissionRows) {
    const id = String(permission.user_id);
    byUser.set(id, [...(byUser.get(id) ?? []), String(permission.permission)]);
  }
  const sectionRows = database.prepare(`
    SELECT a.user_id, a.section_key, a.access_level
    FROM user_section_access a
    JOIN users u ON u.id = a.user_id
    WHERE u.organization_id = ?
  `).all(organizationId) as Record<string, unknown>[];
  const sectionByUser = new Map<string, SectionAccessLevel>(
    sectionRows.map((row) => [
      accessKey(row.user_id, row.section_key),
      String(row.access_level) as SectionAccessLevel,
    ]),
  );
  return {
    items: rows.map((row) => {
      const id = String(row.id);
      const level = (sectionKey: string) => sectionByUser.get(accessKey(id, sectionKey)) ?? 'none';
      return mapUser(
        row,
        byUser.get(id) ?? [],
        level('customer_debts'),
        level('company_debts'),
        level('libyan_deposits'),
        level('egyptian_deposits'),
        level('masraweya'),
        level('purchases'),
        level('treasury'),
        level('reports'),
      );
    }),
    assignablePermissions: ASSIGNABLE_PERMISSIONS,
  };
}
