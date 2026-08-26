-- Student official-result correction requests; HOD approval publishes changes.
CREATE TABLE IF NOT EXISTS result_edit_requests (
  id BIGSERIAL PRIMARY KEY,
  result_id BIGINT NOT NULL,
  reg_no TEXT NOT NULL,
  proposed JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  requested_by_name TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_name TEXT,
  reviewed_by_role TEXT,
  reviewed_at TIMESTAMPTZ,
  review_stamp JSONB,
  remarks TEXT
);

CREATE INDEX IF NOT EXISTS idx_result_edit_requests_status
  ON result_edit_requests(status, requested_at DESC);