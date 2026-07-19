-- =============================================================
-- GPT Hubli Management System — Database Schema
-- Portable: runs on Neon (dev) and vanilla PostgreSQL 16 (prod).
-- Run:  psql "$DATABASE_URL" -f scripts/001_schema.sql
-- =============================================================

-- Needed for bcrypt password hashing in the seed script.
-- On Ubuntu install: sudo apt install postgresql-contrib
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Auth ----------
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL, -- admin | student | principal | hod | faculty | registrar | acm | exam | est | library | placement | nss | yrc | alumni | sports | welfare | cash | accounts | stores | studentassoc
  display_name  TEXT NOT NULL,
  reg_no        TEXT,          -- linked student registration number (students.reg_no)
  staff_id      BIGINT,        -- linked staff record
  branch        TEXT,          -- diploma branch chosen at student registration
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | deleted
  force_password_change BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at    TIMESTAMPTZ,   -- soft-delete timestamp (trash / undo)
  prev_status   TEXT,          -- status before soft-delete (for restore)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------- Students ----------
CREATE TABLE IF NOT EXISTS students (
  reg_no     TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  dept       TEXT NOT NULL,
  year       TEXT,
  cgpa       TEXT,
  att        TEXT,
  father     TEXT,
  extra      JSONB NOT NULL DEFAULT '{}'::jsonb, -- dynamic profile sections from admin builder
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Results ----------
CREATE TABLE IF NOT EXISTS results (
  id         BIGSERIAL PRIMARY KEY,
  reg_no     TEXT NOT NULL,
  name       TEXT NOT NULL,
  branch     TEXT NOT NULL,
  sem        INT  NOT NULL,
  session    TEXT NOT NULL,
  sgpa       NUMERIC(4,2),
  result     TEXT NOT NULL DEFAULT 'Pass',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reg_no, sem, session)
);

CREATE TABLE IF NOT EXISTS result_subjects (
  id        BIGSERIAL PRIMARY KEY,
  result_id BIGINT NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  code      TEXT NOT NULL,
  internal  INT NOT NULL DEFAULT 0,
  external  INT NOT NULL DEFAULT 0,
  credits   INT NOT NULL DEFAULT 0,
  grade     TEXT NOT NULL,
  ord       INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_result_subjects_result ON result_subjects(result_id);

-- ---------- Grievances ----------
CREATE TABLE IF NOT EXISTS grievances (
  id           BIGSERIAL PRIMARY KEY,
  student_reg  TEXT,
  subject      TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  expectation  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'Pending', -- Pending | In Progress | Resolved
  resolution   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);

-- ---------- Gallery ----------
CREATE TABLE IF NOT EXISTS gallery_items (
  id         BIGSERIAL PRIMARY KEY,
  src        TEXT NOT NULL, -- data URL (base64) or /path
  caption    TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT 'General',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Staff (EST) ----------
CREATE TABLE IF NOT EXISTS staff (
  id          BIGSERIAL PRIMARY KEY,
  staff_type  TEXT NOT NULL CHECK (staff_type IN ('TH','NT','AD','GF','GD')), -- Teaching | Non-Teaching | Admin | Guest Faculty | Guard
  name        TEXT NOT NULL,
  extra       JSONB NOT NULL DEFAULT '{}'::jsonb, -- all type-specific fields (instCode, ddo, kgid, branch, designation, ...)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_type ON staff(staff_type);

-- ---------- Committees ----------
CREATE TABLE IF NOT EXISTS committees (
  id    BIGSERIAL PRIMARY KEY,
  name  TEXT UNIQUE NOT NULL,
  icon  TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'primary'
);

CREATE TABLE IF NOT EXISTS committee_members (
  id           BIGSERIAL PRIMARY KEY,
  committee_id BIGINT NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'Member',
  dept         TEXT NOT NULL DEFAULT '',
  designation  TEXT NOT NULL DEFAULT '',
  mobile       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_committee_members_cm ON committee_members(committee_id);

-- ---------- Forms (Google-Forms-style builder) ----------
CREATE TABLE IF NOT EXISTS forms (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'open', -- open | closed
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS form_responses (
  id           BIGSERIAL PRIMARY KEY,
  form_id      BIGINT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  answers      JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_responses_form ON form_responses(form_id);

-- ---------- Notices ----------
CREATE TABLE IF NOT EXISTS notices (
  id         BIGSERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  priority   TEXT NOT NULL DEFAULT 'normal', -- normal | important | emergency
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Certificate requests (TC / Study / Studying / NOC / PDC) ----------
CREATE TABLE IF NOT EXISTS cert_requests (
  id           BIGSERIAL PRIMARY KEY,
  req_code     TEXT NOT NULL UNIQUE,           -- e.g. CERT/2026/123
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_name TEXT NOT NULL DEFAULT '',
  reg_no       TEXT NOT NULL DEFAULT '',
  branch       TEXT NOT NULL DEFAULT '',
  cert_type    TEXT NOT NULL,                  -- PDC, TC, Study Certificate, ...
  routed_to    TEXT NOT NULL DEFAULT 'ACM Section', -- 'Exam Cell' | 'ACM Section'
  status       TEXT NOT NULL DEFAULT 'pending',     -- pending | ready | rejected | collected
  remarks      TEXT NOT NULL DEFAULT 'Request received. Processing in progress.',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cert_requests_user ON cert_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_cert_requests_routed ON cert_requests(routed_to, status);

-- ---------- Attendance ----------
CREATE TABLE IF NOT EXISTS attendance (
  id        BIGSERIAL PRIMARY KEY,
  class_id  TEXT NOT NULL,
  att_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  entries   JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{reg, name, present}]
  marked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, att_date)
);
