-- =============================================================
-- GPT Hubli Management System — Seed Data (production)
-- Run AFTER 001_schema.sql:  psql "$DATABASE_URL" -f scripts/002_seed.sql
-- Seeds the root admin, a single student demo account, and committees.
--
-- Root admin login (any of these identifiers):
--   email:       akshay@gpthubli.ac.in
--   username:    akshay
--   display name: Akshay
--   password:    Zaq1Zaq2$123
--
-- Password hashes below are bcrypt (compatible with bcryptjs in the app).
-- Do NOT use pgcrypto crypt() here — the Node app verifies with bcryptjs.
-- =============================================================

-- ---------- Committees ----------
INSERT INTO committees (name, icon, color) VALUES
  ('SC/ST Committee','⚖️','primary'),
  ('Internal Quality Assurance Cell','🏅','purple'),
  ('Women/Girl Students Grievance Cell','👩','green'),
  ('Anti-Ragging Squad','🚫','red'),
  ('Grievance Redressal','📋','accent'),
  ('Anti-Ragging Committee','🛡️','teal'),
  ('Institute Industry Cell','🏭','orange'),
  ('Internal Complaint Committee','📝','primary'),
  ('Media Cell','📢','purple')
ON CONFLICT (name) DO NOTHING;

-- ---------- Root admin ----------
-- bcryptjs hash of: Zaq1Zaq2$123  (cost 10)
INSERT INTO users (email, password_hash, role, display_name, status, force_password_change, is_demo)
VALUES (
  'akshay@gpthubli.ac.in',
  '$2b$10$rb17317Fge5rt.2baaiMguKgALg1tmcFrs2n7b64l5Fou8pCtRSSW',
  'admin',
  'Akshay',
  'approved',
  FALSE,
  FALSE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  force_password_change = EXCLUDED.force_password_change,
  is_demo = EXCLUDED.is_demo;

-- ---------- Demo student only (module testing) ----------
-- Password: demo1234  (bcryptjs cost 10)
-- Login: demo.student@gpthubli.ac.in  /  DEMOSTUDENT  /  GP2023CSE041
-- Remove every other is_demo account on re-seed.
DELETE FROM sessions
 WHERE user_id IN (
   SELECT id FROM users
    WHERE is_demo = TRUE
      AND lower(email) <> lower('demo.student@gpthubli.ac.in')
 );
DELETE FROM users
 WHERE is_demo = TRUE
   AND lower(email) <> lower('demo.student@gpthubli.ac.in');
-- Also drop legacy multi-role demo emails if somehow not flagged is_demo
DELETE FROM sessions
 WHERE user_id IN (
   SELECT id FROM users
    WHERE email ~* '^demo\.(admin|faculty|principal|hod|registrar|acm|exam|est|library|placement|nss|yrc|alumni|sports|welfare|cash|accounts|stores|sa)@'
 );
DELETE FROM users
 WHERE email ~* '^demo\.(admin|faculty|principal|hod|registrar|acm|exam|est|library|placement|nss|yrc|alumni|sports|welfare|cash|accounts|stores|sa)@';

INSERT INTO students (reg_no, name, dept, year, cgpa, att, father, extra, current_study_year, academic_status)
VALUES
  (
    'GP2023CSE041',
    'Demo Student',
    'Computer Science Engineering',
    '2nd Year',
    NULL,
    NULL,
    NULL,
    '{}'::jsonb,
    2,
    'active'
  )
ON CONFLICT (reg_no) DO UPDATE SET
  name = EXCLUDED.name,
  dept = EXCLUDED.dept,
  year = EXCLUDED.year,
  current_study_year = COALESCE(students.current_study_year, EXCLUDED.current_study_year),
  academic_status = COALESCE(students.academic_status, EXCLUDED.academic_status);
-- Note: cgpa/att are intentionally not overwritten on re-seed so real entered values are preserved.

INSERT INTO users (email, password_hash, role, display_name, reg_no, branch, status, force_password_change, is_demo)
VALUES (
  'demo.student@gpthubli.ac.in',
  '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK',
  'student',
  'Demo Student',
  'GP2023CSE041',
  'computer',
  'approved',
  FALSE,
  TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  reg_no = EXCLUDED.reg_no,
  branch = EXCLUDED.branch,
  status = EXCLUDED.status,
  force_password_change = EXCLUDED.force_password_change,
  is_demo = EXCLUDED.is_demo,
  deleted_at = NULL,
  prev_status = NULL;
