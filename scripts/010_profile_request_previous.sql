-- Snapshot of field values before a student/staff profile update request.
-- Used so Admin/ACM can review highlighted before → after diffs.
ALTER TABLE profile_requests
  ADD COLUMN IF NOT EXISTS previous JSONB NOT NULL DEFAULT '{}'::jsonb;
