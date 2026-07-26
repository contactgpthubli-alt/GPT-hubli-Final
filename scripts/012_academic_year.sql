-- Academic year / study-year progression (DTE Karnataka diploma model)
-- Run via app ensureAcademicSchema() or: psql "$DATABASE_URL" -f scripts/012_academic_year.sql

CREATE TABLE IF NOT EXISTS institute_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS admission_academic_year TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'regular';
ALTER TABLE students ADD COLUMN IF NOT EXISTS entry_study_year INT DEFAULT 1;
ALTER TABLE students ADD COLUMN IF NOT EXISTS current_study_year INT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_status TEXT DEFAULT 'active';
ALTER TABLE students ADD COLUMN IF NOT EXISTS progress_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS pass_out_academic_year TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS needs_admission_year_review BOOLEAN DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS academic_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS student_academic_events (
  id BIGSERIAL PRIMARY KEY,
  reg_no TEXT NOT NULL,
  event_type TEXT NOT NULL,
  from_year INT,
  to_year INT,
  from_status TEXT,
  to_status TEXT,
  academic_year TEXT,
  reason TEXT,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_academic_events_reg
  ON student_academic_events (reg_no, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_students_academic_status
  ON students (academic_status, current_study_year);
