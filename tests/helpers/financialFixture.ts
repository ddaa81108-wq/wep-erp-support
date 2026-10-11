import type { AppDatabase } from '../../src/server/db/database.ts';
import type { AuthenticatedUser } from '../../src/server/security/sessions.ts';

export function fixtureAdmin(database: AppDatabase): AuthenticatedUser {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,
    organization_id,home_branch_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'fixture-admin',
      'fixture-admin',
      'Test Admin',
      'test-only',
      'admin',
      'org-default',
      'branch-main',
      now,
      now,
    );
  return {
    id: 'fixture-admin',
    username: 'fixture-admin',
    displayName: 'Test Admin',
    role: 'admin',
    organizationId: 'org-default',
    homeBranchId: 'branch-main',
    mustChangePassword: false,
    permissions: new Set(),
    sessionTokenHash: 'test',
    csrfHash: 'test',
  };
}
