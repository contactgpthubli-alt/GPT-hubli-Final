-- Student (and future staff) dynamic profile form schemas — Admin builder
CREATE TABLE IF NOT EXISTS profile_schemas (
  key         TEXT PRIMARY KEY,              -- e.g. 'student'
  schema_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_schemas_updated ON profile_schemas(updated_at DESC);
