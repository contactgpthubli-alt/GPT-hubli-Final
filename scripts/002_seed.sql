-- =============================================================
-- GPT Hubli Management System — Seed Data (production)
-- Run AFTER 001_schema.sql:  psql "$DATABASE_URL" -f scripts/002_seed.sql
-- Seeds ONLY the root admin and the official committee list.
-- No demo students, results, notices, or test accounts.
-- Root admin:  Akshay (akshay@gpthubli.ac.in) / Zaq1Zaq2$123
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
-- Login with username "Akshay", email local-part, or the full email.
INSERT INTO users (email, password_hash, role, display_name, status, force_password_change, is_demo)
VALUES ('akshay@gpthubli.ac.in', crypt('Zaq1Zaq2$123', gen_salt('bf', 10)), 'admin', 'Akshay', 'approved', FALSE, FALSE)
ON CONFLICT (email) DO NOTHING;
