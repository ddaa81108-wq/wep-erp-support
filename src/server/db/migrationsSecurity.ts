import type { Migration } from './migrationTypes.ts';

export const securityMigrations: Migration[] = [{ version: 50, name: 'account-two-factor-authentication', sql: `
CREATE TABLE user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT,
  pending_secret TEXT,
  pending_session TEXT,
  pending_expires_at TEXT,
  last_step INTEGER NOT NULL DEFAULT -1,
  recovery_hashes TEXT NOT NULL DEFAULT '[]'
) STRICT;
CREATE TABLE mfa_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX idx_mfa_challenge_user ON mfa_challenges(user_id);
` }];
