-- =============================================================
-- GPT Hubli Management System — Seed Data (production)
-- Run AFTER 001_schema.sql:  psql "$DATABASE_URL" -f scripts/002_seed.sql
-- Seeds the root admin, optional demo accounts, and committees.
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

-- ---------- Demo accounts (quick-login bar; password: demo1234) ----------
-- bcryptjs hash of: demo1234  (cost 10)
-- Enabled only when NEXT_PUBLIC_ENABLE_DEMO_LOGIN=true
INSERT INTO users (email, password_hash, role, display_name, reg_no, status, force_password_change, is_demo)
VALUES
  ('demo.admin@gpthubli.ac.in',     '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'admin',      'Demo Admin',      NULL,           'approved', FALSE, TRUE),
  ('demo.student@gpthubli.ac.in',   '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'student',    'Demo Student',    'GP2023CSE041', 'approved', FALSE, TRUE),
  ('demo.faculty@gpthubli.ac.in',   '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'faculty',    'Demo Faculty',    NULL,           'approved', FALSE, TRUE),
  ('demo.principal@gpthubli.ac.in', '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'principal',  'Demo Principal',  NULL,           'approved', FALSE, TRUE),
  ('demo.hod@gpthubli.ac.in',       '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'hod',        'Demo HOD',        NULL,           'approved', FALSE, TRUE),
  ('demo.registrar@gpthubli.ac.in', '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'registrar',  'Demo Registrar',  NULL,           'approved', FALSE, TRUE),
  ('demo.acm@gpthubli.ac.in',       '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'acm',        'Demo ACM',        NULL,           'approved', FALSE, TRUE),
  ('demo.exam@gpthubli.ac.in',      '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'exam',       'Demo Exam Cell',  NULL,           'approved', FALSE, TRUE),
  ('demo.est@gpthubli.ac.in',       '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'est',        'Demo EST',        NULL,           'approved', FALSE, TRUE),
  ('demo.library@gpthubli.ac.in',   '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'library',    'Demo Library',    NULL,           'approved', FALSE, TRUE),
  ('demo.placement@gpthubli.ac.in', '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'placement',  'Demo Placement',  NULL,           'approved', FALSE, TRUE),
  ('demo.nss@gpthubli.ac.in',       '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'nss',        'Demo NSS',        NULL,           'approved', FALSE, TRUE),
  ('demo.yrc@gpthubli.ac.in',       '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'yrc',        'Demo YRC',        NULL,           'approved', FALSE, TRUE),
  ('demo.alumni@gpthubli.ac.in',    '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'alumni',     'Demo Alumni',     NULL,           'approved', FALSE, TRUE),
  ('demo.sports@gpthubli.ac.in',    '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'sports',     'Demo Sports',     NULL,           'approved', FALSE, TRUE),
  ('demo.welfare@gpthubli.ac.in',   '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'welfare',    'Demo Welfare',    NULL,           'approved', FALSE, TRUE),
  ('demo.cash@gpthubli.ac.in',      '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'cash',       'Demo Cash',       NULL,           'approved', FALSE, TRUE),
  ('demo.accounts@gpthubli.ac.in',  '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'accounts',   'Demo Accounts',   NULL,           'approved', FALSE, TRUE),
  ('demo.stores@gpthubli.ac.in',    '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'stores',     'Demo Stores',     NULL,           'approved', FALSE, TRUE),
  ('demo.sa@gpthubli.ac.in',        '$2b$10$c9/vg8icepeN9BEWT0CjN.ZMM6wr55rSVro5ApBRcUyMW581eAixK', 'studentassoc','Demo Student Assoc.', NULL,       'approved', FALSE, TRUE)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  reg_no = EXCLUDED.reg_no,
  status = EXCLUDED.status,
  force_password_change = EXCLUDED.force_password_change,
  is_demo = EXCLUDED.is_demo;
