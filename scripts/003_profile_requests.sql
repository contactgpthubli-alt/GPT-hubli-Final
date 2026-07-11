-- =============================================================
-- Profile Edit Requests
-- Students/staff submit proposed changes to their profile; an
-- Admin or HOD reviews and approves/rejects. On approval, the
-- changes are merged into the target record's `extra` JSONB.
-- =============================================================

CREATE TABLE IF NOT EXISTS profile_requests (
  id            BIGSERIAL PRIMARY KEY,
  requester_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type   TEXT NOT NULL CHECK (target_type IN ('student','staff')),
  target_id     TEXT NOT NULL,        -- students.reg_no OR staff.id (as text)
  changes       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { field_label: new_value, ... }
  status        TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected
  remarks       TEXT,
  reviewed_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_requests_status ON profile_requests(status);
CREATE INDEX IF NOT EXISTS idx_profile_requests_requester ON profile_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_profile_requests_target ON profile_requests(target_type, target_id);
