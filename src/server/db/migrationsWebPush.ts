import type { Migration } from './migrationTypes.ts';
export const webPushMigrations: Migration[] = [
  {
    version: 47,
    name: 'browser-push-subscriptions-and-outbox',
    sql: `
  CREATE TABLE browser_push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_token_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    last_test_at INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  CREATE INDEX idx_browser_push_user ON browser_push_subscriptions(user_id);
  CREATE TABLE browser_push_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT NOT NULL REFERENCES browser_push_subscriptions(id) ON DELETE CASCADE,
    notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
    UNIQUE(subscription_id,notification_id)
  ) STRICT;
  CREATE INDEX idx_browser_push_due ON browser_push_outbox(next_attempt_at,id);
  CREATE TRIGGER trg_notification_browser_push AFTER INSERT ON notifications BEGIN
    INSERT INTO browser_push_outbox(subscription_id,notification_id)
      SELECT id,NEW.id FROM browser_push_subscriptions
      WHERE user_id=NEW.recipient_user_id AND organization_id=NEW.organization_id;
  END;
`,
  },
  {
    version: 48,
    name: 'persistent-browser-push-subscriptions',
    sql: `
  DROP TRIGGER IF EXISTS trg_notification_browser_push;
  ALTER TABLE browser_push_subscriptions RENAME TO browser_push_subscriptions_old;
  ALTER TABLE browser_push_outbox RENAME TO browser_push_outbox_old;
  DROP INDEX IF EXISTS idx_browser_push_user;
  DROP INDEX IF EXISTS idx_browser_push_due;
  CREATE TABLE browser_push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_token_hash TEXT,
    created_at TEXT NOT NULL,
    last_test_at INTEGER NOT NULL DEFAULT 0
  ) STRICT;
  INSERT INTO browser_push_subscriptions
    (id,endpoint,p256dh,auth,user_id,organization_id,session_token_hash,created_at,last_test_at)
    SELECT id,endpoint,p256dh,auth,user_id,organization_id,session_token_hash,created_at,last_test_at
    FROM browser_push_subscriptions_old;
  CREATE INDEX idx_browser_push_user ON browser_push_subscriptions(user_id);
  CREATE TABLE browser_push_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT NOT NULL REFERENCES browser_push_subscriptions(id) ON DELETE CASCADE,
    notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
    UNIQUE(subscription_id,notification_id)
  ) STRICT;
  INSERT INTO browser_push_outbox
    (id,subscription_id,notification_id,attempts,next_attempt_at,created_at)
    SELECT id,subscription_id,notification_id,attempts,next_attempt_at,created_at
    FROM browser_push_outbox_old;
  CREATE INDEX idx_browser_push_due ON browser_push_outbox(next_attempt_at,id);
  DROP TABLE browser_push_outbox_old;
  DROP TABLE browser_push_subscriptions_old;
  CREATE TRIGGER trg_notification_browser_push AFTER INSERT ON notifications BEGIN
    INSERT INTO browser_push_outbox(subscription_id,notification_id)
      SELECT id,NEW.id FROM browser_push_subscriptions
      WHERE user_id=NEW.recipient_user_id AND organization_id=NEW.organization_id;
  END;
`,
  },
];
