import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [username, databasePath, resultPath] = process.argv.slice(2);
if (!username || !databasePath) throw new Error('Usage: admin-reset-password.mjs <username> <database-path>');

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const random = randomBytes(14);
let temporaryPassword = 'Ab@';
for (let index = 0; index < random.length; index += 1) {
  temporaryPassword += alphabet[random[index] % alphabet.length];
}

const salt = randomBytes(16);
const passwordHash = [
  'scrypt', '32768', '8', '1', salt.toString('base64url'),
  scryptSync(temporaryPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url'),
].join('$');

const database = new DatabaseSync(databasePath, { timeout: 5_000 });
const changedAt = new Date().toISOString();
database.exec('BEGIN IMMEDIATE');
try {
  const user = database.prepare(
    'SELECT id, username, is_active FROM users WHERE lower(username) = lower(?)',
  ).get(username);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (Number(user.is_active) !== 1) throw new Error('USER_INACTIVE');

  database.prepare(`
    UPDATE users SET password_hash = ?, must_change_password = 1,
      version = version + 1, updated_at = ? WHERE id = ?
  `).run(passwordHash, changedAt, user.id);
  database.prepare(`
    UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL
  `).run(changedAt, user.id);
  database.prepare(`
    INSERT INTO audit_log(
      actor_user_id, action, entity_type, entity_id,
      correlation_id, outcome, details_json, created_at
    ) VALUES (?, 'user.password.admin_recovery', 'user', ?, ?, 'success', '{}', ?)
  `).run(user.id, user.id, randomUUID(), changedAt);

  database.exec('COMMIT');
  const result = JSON.stringify({
    ok: true,
    username: user.username,
    temporaryPassword,
    mustChangePassword: true,
  });
  if (resultPath) writeFileSync(resultPath, result, { encoding: 'utf8', mode: 0o600 });
  else console.log(result);
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}
