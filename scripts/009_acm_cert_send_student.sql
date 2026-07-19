-- Allow ACM to release Study/Studying certificates to the student for self-print
ALTER TABLE acm_cert_register
  ADD COLUMN IF NOT EXISTS sent_to_student BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE acm_cert_register
  ADD COLUMN IF NOT EXISTS sent_to_student_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_acm_cert_sent_student
  ON acm_cert_register (reg_no, sent_to_student)
  WHERE sent_to_student = true;
