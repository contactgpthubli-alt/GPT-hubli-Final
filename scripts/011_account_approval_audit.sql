-- Account approval audit trail + per-user in-app notifications
-- Who approved/rejected a registration is kept on users for permanent records.
-- user_notifications delivers "your account is approved" to the student app.

ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_by_role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'info',
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user
  ON user_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
  ON user_notifications (user_id)
  WHERE read_at IS NULL;
